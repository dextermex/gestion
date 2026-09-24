// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Modal, useLatest } from "@/components/pro/ui";
import { StepCard, WizardFooter } from "@/components/gestion/WizardChrome";
import { fr } from "@/lib/i18n/fr";
import { useEffect, useState } from "react";

/**
 * A field must keep the caret while the person types. Two things in this
 * codebase used to take it away after one character, and both are pinned
 * here: a dialog whose focus effect re-ran on every render because the
 * parent's inline `onClose` was one of its dependencies, and a wrapper
 * component declared inside the screen that rendered it (a new component
 * on every render, so React remounted the field). The test types the way a
 * browser does, one input event per key, with a parent that re-renders on
 * each of them.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
};

/** Focus a field and type into it key by key, re-rendering the owner on each key like a controlled input does. */
async function typeInto(field: HTMLInputElement, text: string) {
  await act(async () => field.focus());
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  for (let i = 1; i <= text.length; i++) {
    await act(async () => {
      setter.call(field, text.slice(0, i));
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

function DialogForm() {
  const [title, setTitle] = useState("");
  // The inline handler every screen writes: a new function on each render.
  return (
    <Modal open onClose={() => {}} title="Nouvelle demande">
      <input aria-label="Titre" value={title} onChange={(e) => setTitle(e.target.value)} />
      <p data-testid="echo">{title}</p>
    </Modal>
  );
}

function WizardStep() {
  const [name, setName] = useState("");
  return (
    <StepCard>
      <input aria-label="Nom" value={name} onChange={(e) => setName(e.target.value)} />
      <WizardFooter d={fr} backHref="/app" onBack={() => {}} busy={false} leaving={false} onSaveLater={() => {}} onNext={() => {}} />
    </StepCard>
  );
}

describe("a field keeps the caret while the person types", () => {
  it("inside a dialog whose owner re-renders with a new onClose on every key", async () => {
    await render(<DialogForm />);
    // The dialog is portalled to the end of <body>, above every floating card: look for it in the document.
    const field = document.querySelector<HTMLInputElement>('input[aria-label="Titre"]')!;
    await typeInto(field, "Fuite");
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("Fuite");
    expect(document.querySelector('[data-testid="echo"]')!.textContent).toBe("Fuite");
  });

  it("inside a wizard step card, with the footer beside it", async () => {
    await render(<WizardStep />);
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Nom"]')!;
    await typeInto(field, "Salon");
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("Salon");
  });

  it("the dialog still closes on Escape through the latest handler", async () => {
    let closed = 0;
    function Owner() {
      const [n, setN] = useState(0);
      return (
        <Modal open onClose={() => { closed = n; }} title="t">
          <input aria-label="f" value={String(n)} onChange={(e) => setN(Number(e.target.value) || 0)} />
        </Modal>
      );
    }
    await render(<Owner />);
    const field = document.querySelector<HTMLInputElement>('input[aria-label="f"]')!;
    await typeInto(field, "7");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(closed).toBe(7);
  });
});

describe("useLatest", () => {
  it("hands an effect the newest value without being one of its dependencies", async () => {
    const runs: number[] = [];
    let seen = -1;
    function Probe({ value }: { value: number }) {
      const latest = useLatest(value);
      useEffect(() => {
        runs.push(1);
        const read = () => { seen = latest.current; };
        window.addEventListener("focus", read);
        return () => window.removeEventListener("focus", read);
      }, [latest]);
      return null;
    }
    await render(<Probe value={1} />);
    await render(<Probe value={2} />);
    await render(<Probe value={3} />);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(runs).toHaveLength(1);
    expect(seen).toBe(3);
  });
});

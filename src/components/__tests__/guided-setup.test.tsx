// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import GettingStarted from "@/components/gestion/GettingStarted";
import SetupTour from "@/components/gestion/onboarding/SetupTour";
import { TOUR_COUNT_KEY, TOUR_SEEN_KEY, type SetupFacts, type ShellSetup } from "@/lib/gestion/setup";

const push = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }), usePathname: () => "/app", useSearchParams: () => search }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const k = fr.onboarding;
const HREFS = { property: "/app/biens/nouveau", lease: "/app/biens/locataire?lot=u-1", bank: "/app/banque", invite: "/app/baux/l-1#espace-locataire" };
const NONE: SetupFacts = { property: false, lease: false, bank: false, invite: false };
const setup = (facts: Partial<SetupFacts> = {}, over: Partial<ShellSetup> = {}): ShellSetup => ({ facts: { ...NONE, ...facts }, hrefs: HREFS, tourSeen: false, guide: true, ...over });

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn(async () => new Response("{}"));
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  push.mockClear();
  search = new URLSearchParams();
  localStorage.clear();
  host = document.createElement("div");
  host.className = "crm-shell";
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const row = (step: string) => host.querySelector(`[data-setup-step="${step}"]`);
const next = () => host.querySelector<HTMLAnchorElement>("[data-setup-next]");

describe("the setup card", () => {
  it("starts at one of five with the property as its button, the lease and the invitation waiting", async () => {
    await act(async () => root.render(<GettingStarted d={fr} locale="fr" setup={setup()} placement="home" />));
    expect(host.textContent).toContain(k.title);
    expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("1 sur 5");
    expect(next()?.getAttribute("href")).toBe("/app/biens/nouveau");
    expect(next()?.textContent).toBe(`Continuer : ${k.steps.property}`);
    expect(row("account")?.getAttribute("data-state")).toBe("done");
    for (const s of ["lease", "invite"] as const) {
      expect(row(s)?.getAttribute("data-state")).toBe("waiting");
      expect(row(s)?.textContent).toContain(k.stepsNeeds[s]);
      expect(row(s)?.querySelector("a")).toBeNull();
    }
    // The bank stands alone: it can be done at once.
    expect(row("bank")?.querySelector("a")?.getAttribute("href")).toBe("/app/banque");
    expect(host.querySelector("[data-setup-card]")?.classList.contains("setup-glow")).toBe(true);
  });

  it("names the lease once a property exists, and leads it to the lot's own flow", async () => {
    await act(async () => root.render(<GettingStarted d={fr} locale="fr" setup={setup({ property: true })} placement="home" />));
    expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("2 sur 5");
    expect(next()?.getAttribute("href")).toBe(HREFS.lease);
    expect(next()?.textContent).toContain(k.steps.lease);
    expect(row("lease")?.querySelector("a")?.getAttribute("href")).toBe(HREFS.lease);
    expect(row("invite")?.getAttribute("data-state")).toBe("waiting");
    expect(host.textContent).toContain("Encore 3 étapes");
  });

  it("says once on Accueil that all is done, can be hidden for good, and is not repeated elsewhere", async () => {
    const all = setup({ property: true, lease: true, bank: true, invite: true });
    await act(async () => root.render(<GettingStarted d={fr} locale="fr" setup={all} placement="home" />));
    expect(host.textContent).toContain(k.done);
    expect(host.querySelector("[data-setup-card]")?.classList.contains("setup-glow")).toBe(false);
    const hide = [...host.querySelectorAll("button")].find((b) => b.textContent === k.hide)!;
    await act(async () => hide.click());
    expect(host.querySelector("[data-setup-card]")).toBeNull();
    await act(async () => root.render(<GettingStarted key="again" d={fr} locale="fr" setup={all} placement="home" />));
    expect(host.querySelector("[data-setup-card]")).toBeNull();
    await act(async () => root.render(<GettingStarted d={fr} locale="fr" setup={all} placement="float" />));
    expect(host.textContent).toBe("");
  });

  it("floats folded on the other pages until opened, with no way to dismiss an unfinished setup", async () => {
    await act(async () => root.render(<GettingStarted d={fr} locale="fr" setup={setup({ property: true })} placement="float" />));
    const pill = host.querySelector("button")!;
    expect(pill.textContent).toContain(k.title);
    expect(next()).toBeNull();
    await act(async () => pill.click());
    // The pill leaves before the card comes in.
    await act(async () => new Promise((r) => setTimeout(r, 700)));
    expect(next()?.getAttribute("href")).toBe(HREFS.lease);
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(k.hide);
  });
});

/** Accueil as the tour meets it: the card, the tour, and a control that had the focus. */
async function accueil(s: ShellSetup) {
  await act(async () =>
    root.render(
      <>
        <button type="button" data-before>
          before
        </button>
        <GettingStarted d={fr} locale="fr" setup={s} placement="home" />
        <SetupTour d={fr} setup={s} />
      </>,
    ),
  );
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const headline = () => dialog()?.querySelector("p")?.textContent;
const escape = () => act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

describe("the first-run tour", () => {
  it("plays once: the arrival, the stop on the first property, the card, then never again", async () => {
    vi.useFakeTimers();
    search = new URLSearchParams("tour=1");
    await accueil(setup());
    expect(document.documentElement.hasAttribute("data-setup-arrival")).toBe(true);
    expect(dialog()).toBeNull();
    host.querySelector<HTMLButtonElement>("[data-before]")!.focus();
    await act(async () => vi.advanceTimersByTime(1300));
    expect(document.documentElement.hasAttribute("data-setup-arrival")).toBe(false);
    // A modal dialog over an inert page, its focus on the step it points at.
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    expect(headline()).toBe(k.tour.property);
    expect(host.inert).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(k.steps.property);
    // Escape moves on to the card, then closes; focus comes back.
    await escape();
    expect(dialog()?.getAttribute("data-setup-tour")).toBe("card");
    expect(headline()).toBe(k.coachTitle);
    await escape();
    expect(dialog()).toBeNull();
    expect(host.inert).toBe(false);
    expect(document.activeElement?.hasAttribute("data-before")).toBe(true);
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe("1");
    expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/tour", expect.objectContaining({ method: "POST" }));
    // Coming back to Accueil: nothing shows a second time.
    await act(async () => root.render(<></>));
    search = new URLSearchParams("tour=1");
    await accueil(setup());
    await act(async () => vi.advanceTimersByTime(2000));
    expect(dialog()).toBeNull();
  });

  it("opens the step when its target is clicked, and Passer ends the tour", async () => {
    vi.useFakeTimers();
    await accueil(setup());
    await act(async () => vi.advanceTimersByTime(400));
    expect(headline()).toBe(k.tour.property);
    await act(async () => dialog()!.querySelector<HTMLButtonElement>(".setup-tour-target")!.click());
    expect(push).toHaveBeenCalledWith("/app/biens/nouveau");
    expect(dialog()).toBeNull();

    await act(async () => root.render(<></>));
    localStorage.clear();
    await accueil(setup());
    await act(async () => vi.advanceTimersByTime(400));
    const skip = [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === k.tour.skip)!;
    await act(async () => skip.click());
    expect(dialog()).toBeNull();
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe("1");
  });

  it("is not shown to an account that saw it, nor where it may not play", async () => {
    vi.useFakeTimers();
    await accueil(setup({}, { tourSeen: true }));
    await act(async () => vi.advanceTimersByTime(2000));
    expect(dialog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    // Counting starts from where the space stands.
    expect(localStorage.getItem(TOUR_COUNT_KEY)).toBe("1");
    await act(async () => root.render(<></>));
    localStorage.clear();
    await accueil(setup({}, { guide: false }));
    await act(async () => vi.advanceTimersByTime(2000));
    expect(dialog()).toBeNull();
    await act(async () => root.render(<></>));
    await accueil(setup({ property: true, lease: true, bank: true, invite: true }));
    await act(async () => vi.advanceTimersByTime(2000));
    expect(dialog()).toBeNull();
  });

  it("points the card out again, once, when a return finds one more step done", async () => {
    vi.useFakeTimers();
    localStorage.setItem(TOUR_SEEN_KEY, "1");
    localStorage.setItem(TOUR_COUNT_KEY, "1");
    await accueil(setup({ property: true }, { tourSeen: true }));
    await act(async () => vi.advanceTimersByTime(400));
    expect(dialog()?.getAttribute("data-setup-tour")).toBe("card");
    expect(headline()).toBe(k.steps.lease);
    // A click beside the card closes it; the account is not written again.
    await act(async () => dialog()!.querySelector<HTMLElement>(".setup-tour-backdrop")!.click());
    expect(dialog()).toBeNull();
    expect(localStorage.getItem(TOUR_COUNT_KEY)).toBe("2");
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => root.render(<></>));
    await accueil(setup({ property: true }, { tourSeen: true }));
    await act(async () => vi.advanceTimersByTime(2000));
    expect(dialog()).toBeNull();
  });
});

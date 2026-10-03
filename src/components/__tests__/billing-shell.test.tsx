// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { BillingBanner, Paywall, TrialChip, type ShellBilling } from "@/components/gestion/BillingShell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const NOW = Math.floor(Date.now() / 1000);
const billing = (over: Partial<ShellBilling> = {}): ShellBilling => ({
  phase: "trial", daysLeft: 18, nudge: "quiet", trialEnd: NOW + 18 * 86_400, canManage: true, canExtend: false, lots: 12, leases: 9, ...over,
});

it("counts the trial's days in the bar, louder in its last week, and says nothing once a subscription runs", async () => {
  await act(async () => root.render(<TrialChip billing={billing()} d={fr} />));
  expect(host.textContent).toBe("Essai gratuit · 18 jours");
  expect(host.querySelector("a")?.className).toContain("bg-brand-100");
  await act(async () => root.render(<TrialChip billing={billing({ daysLeft: 5, nudge: "soon" })} d={fr} />));
  expect(host.querySelector("a")?.className).toContain("bg-amber-100");
  await act(async () => root.render(<TrialChip billing={billing({ daysLeft: 1, nudge: "urgent" })} d={fr} />));
  expect(host.textContent).toBe("Essai · dernier jour");
  await act(async () => root.render(<TrialChip billing={billing({ phase: "active", nudge: "none" })} d={fr} />));
  expect(host.textContent).toBe("");
});

it("keeps the banner for the last week and after, and tells a member who cannot pay whom to ask", async () => {
  await act(async () => root.render(<BillingBanner billing={billing()} d={fr} locale="fr" />));
  expect(host.textContent).toBe("");
  await act(async () => root.render(<BillingBanner billing={billing({ daysLeft: 5, nudge: "soon" })} d={fr} locale="fr" />));
  expect(host.textContent).toContain("Votre essai se termine dans 5 jours.");
  expect(host.querySelector('a[href="/app/abonnement"]')?.textContent).toBe("Choisir ma formule");
  await act(async () => root.render(<BillingBanner billing={billing({ phase: "expired", daysLeft: 0, nudge: "locked", canManage: false })} d={fr} locale="fr" />));
  expect(host.textContent).toContain("Votre essai est terminé.");
  expect(host.textContent).toContain("Le propriétaire du compte peut l'activer depuis Abonnement.");
  expect(host.querySelector("a")).toBeNull();
});

it("opens the paywall when the server refuses a change for the subscription, and only then", async () => {
  const answers: Response[] = [
    new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }),
    new Response(JSON.stringify({ error: "subscription_required" }), { status: 402, headers: { "Content-Type": "application/json" } }),
  ];
  vi.stubGlobal("fetch", vi.fn(async () => answers.shift()!));
  await act(async () => root.render(<Paywall billing={billing({ phase: "expired", daysLeft: 0, nudge: "locked", canExtend: true })} d={fr} locale="fr" />));
  expect(document.querySelector("[data-paywall]")).toBeNull();
  const first = await act(async () => window.fetch("/api/biens/create", { method: "POST" }));
  expect(first.status).toBe(404);
  expect(document.querySelector("[data-paywall]")).toBeNull();
  // The refused write still reaches its caller untouched.
  const refused = await act(async () => window.fetch("/api/biens/create", { method: "POST" }));
  expect(refused.status).toBe(402);
  expect(await refused.json()).toEqual({ error: "subscription_required" });
  const dialog = document.querySelector("[data-paywall]");
  expect(dialog?.textContent).toContain("Vos 12 lots et 9 baux sont conservés.");
  expect(dialog?.textContent).toContain("Prolonger l'essai de 7 jours");
});

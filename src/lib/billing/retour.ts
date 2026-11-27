import type { CheckoutReturn } from "./service";

/**
 * What the return from Checkout records and where it goes
 * (src/app/api/abonnement/retour/route.ts). `morada_mobile` keeps its other
 * keys (the quiz, the dashboard, the tour): Auth replaces a metadata key
 * whole, so the object is merged here.
 */
export function returnMetadata(previous: unknown, done: CheckoutReturn, now: Date): Record<string, unknown> {
  const mobile = previous && typeof previous === "object" && !Array.isArray(previous) ? (previous as Record<string, unknown>) : {};
  return {
    ...mobile,
    ...(done.offer ? { offer: done.offer } : {}),
    ...(done.trialing ? { trial_started_at: now.toISOString() } : {}),
  };
}

/** A sign-up goes on to "Bienvenue", the locked screen's "resume" to the space, anything else to the subscription page. */
export function returnPath(done: CheckoutReturn | null): string {
  if (done?.source === "signup") return "/inscription?etape=bienvenue";
  if (done?.source === "resume") return "/app";
  return done ? "/app/abonnement?confirme=1" : "/app/abonnement";
}


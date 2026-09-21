/**
 * Ecosystem URLs. Morada Gestion is the third space of the Morada ecosystem,
 * alongside the portal and Morada Pro. The space gateway lives on the main
 * site, so every link out is configurable for preview deployments.
 */
export const MORADA_URL = process.env.NEXT_PUBLIC_MORADA_URL ?? "https://morada.lu";

/** The gateway that lets one account pick between the three spaces. */
export const WELCOME_URL = `${MORADA_URL}/welcome`;

/** Morada Pro, the workspace for agencies and real-estate professionals. */
export const PRO_URL = `${MORADA_URL}/pro`;

/**
 * Where this application answers. Links that leave the app (the invitation
 * e-mail, the link handed to a tenant) are built on it, never on a request's
 * Host header: what a browser or a proxy says it asked for is not where a
 * tenant should be sent. Preview deployments and local runs set it.
 */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://app.morada.lu")).replace(/\/+$/, "");

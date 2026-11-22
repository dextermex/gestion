/**
 * The product's name, the same in every language, as a phone shows it once
 * the app is on the home screen: in full in the app switcher and the
 * install prompt, short under the icon (an iPhone cuts a label past about
 * twelve characters).
 */
export const APP_NAME = "Morada Gestion";
export const APP_SHORT_NAME = "Morada";

/**
 * The public site: the product's presentation, its legal pages and its
 * calculators. Configurable for preview deployments. Only addresses the
 * public site serves are linked: its home, `/<locale>/legal` and
 * `/<locale>/calculators/<slug>`.
 */
export const MORADA_URL = process.env.NEXT_PUBLIC_MORADA_URL ?? "https://morada.lu";

/**
 * Where this application answers. Links that leave the app (the invitation
 * e-mail, the link handed to a tenant) are built on it, never on a request's
 * Host header: what a browser or a proxy says it asked for is not where a
 * tenant should be sent. Preview deployments and local runs set it.
 */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://app.morada.lu")).replace(/\/+$/, "");

/** Where the team answers: a portfolio beyond the published terms, an agency's own terms, a member to add to a workspace (the public site's contact address). */
export const TEAM_EMAIL = "bonjour@morada.lu";

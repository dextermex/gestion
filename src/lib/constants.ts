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

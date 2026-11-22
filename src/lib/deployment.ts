/**
 * Two switches exist for development and demonstration only:
 *
 *   MORADA_PREVIEW_EMPTY=1   renders the management space without a session,
 *                            on empty collections (the harness that walks
 *                            every screen in its empty state);
 *   MORADA_SAMPLE_DATA=1     lets the `morada_dataset` cookie swap an
 *                            account's own data for a sample cabinet.
 *
 * Neither may ever act where customers work. Rather than rely on nobody
 * setting them there, the deployment that serves customers ignores both,
 * and says so once in its log.
 */
type Env = Record<string, string | undefined>;

const PRODUCT_URL = "https://app.morada.lu";

/**
 * The deployment customers use: the platform's production environment,
 * answering at the product's own address (the default when none is
 * configured). A demonstration deployment is its own project with its own
 * address, and keeps its sample cabinets.
 */
export function servesCustomers(env: Env = process.env): boolean {
  if (env.VERCEL_ENV !== "production") return false;
  return (env.NEXT_PUBLIC_APP_URL ?? PRODUCT_URL).trim().replace(/\/+$/, "") === PRODUCT_URL;
}

const said = new Set<string>();
function ignored(name: string): false {
  if (!said.has(name)) {
    said.add(name);
    console.error(`${name} is set on a production deployment and is ignored: it is a development switch.`);
  }
  return false;
}

/** The empty-state harness: never on any production environment. */
export function previewEmpty(env: Env = process.env): boolean {
  if (env.MORADA_PREVIEW_EMPTY !== "1") return false;
  return env.VERCEL_ENV === "production" ? ignored("MORADA_PREVIEW_EMPTY") : true;
}

/** Sample cabinets: never on the deployment that serves customers. */
export function sampleDataAllowed(env: Env = process.env): boolean {
  if (env.MORADA_SAMPLE_DATA !== "1") return false;
  return servesCustomers(env) ? ignored("MORADA_SAMPLE_DATA") : true;
}

/**
 * Dataset selection for the demo. Two full datasets exist — the French-speaking
 * Cabinet Reuter (`data.ts`, the reference) and the Lëtzebuergesch-speaking
 * Cabinet Majerus (`data-lu.ts`, a string-level overlay with identical
 * figures). The active one is chosen per request from the `morada_dataset`
 * cookie, exactly like the locale — so pages read all demo data through
 * `getDemo()` and never import a dataset module directly.
 */

import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import * as frData from "./data";
import * as luData from "./data-lu";
import { buildEmptyData, orgFromWorkspace } from "./data-empty";
import { getIdentity } from "@/lib/workspace";

/**
 * Which data a signed-in account is looking at. `real` is its own, and is the
 * default; the other two are sample cabinets, chosen deliberately from the
 * sidebar and announced by a banner on every screen.
 *
 * Sample data lives in this repository and is only ever rendered. It is never
 * written to Supabase, and it is never a fallback: an account with nothing to
 * show gets an empty screen, not a borrowed one.
 */
export type DatasetId = "real" | "fr" | "lu";
type SampleId = "fr" | "lu";
// `TODAY` is widened: the demo pins a date so its figures stay stable, while a
// real account is simply "today". Everything else keeps its exact shape, so
// the structural-parity check below still catches a missing collection.
export type DemoData = Omit<typeof frData, "TODAY"> & { TODAY: string };

export const DATASET_COOKIE = "morada_dataset";

// `satisfies` enforces structural parity: a missing or mistyped export in the
// LU overlay is a compile error, mirroring the `Dict = typeof fr` i18n rule.
const DATASETS = { fr: frData, lu: luData } satisfies Record<SampleId, DemoData>;

export async function getDatasetId(): Promise<DatasetId> {
  const jar = await cookies();
  const raw = jar.get(DATASET_COOKIE)?.value;
  return raw === "fr" || raw === "lu" ? raw : "real";
}

/**
 * The data every page reads.
 *
 * By default it is the account's own: the workspace comes from `agencies` and
 * `crm_members`, and every collection starts empty because no gestion data
 * exists yet. Each domain that gets connected fills its own collection here,
 * and the pages need no change — they were always reading through this seam.
 *
 * Picking a sample cabinet from the sidebar swaps that for one of the two
 * demonstration datasets. It takes a deliberate click, every screen then wears
 * a banner saying so, and nothing about it ever reaches the database.
 */
export const getDemo = cache(async (): Promise<DemoData> => {
  // Development harness. A brand-new account sees empty collections, and that
  // state is impossible to render locally without a live Supabase session, so
  // ten screens shipped crashing on it. `npm run check:empty` sets this to
  // walk every route in exactly that state.
  //
  // NEVER set MORADA_PREVIEW_EMPTY in a deployed environment: it would hide
  // real data behind empty screens.
  const dataset = await getDatasetId();
  if (dataset !== "real") return DATASETS[dataset];

  if (process.env.MORADA_PREVIEW_EMPTY === "1") {
    return buildEmptyData(orgFromWorkspace({ id: "preview", name: "Espace de test", kind: "manager" }));
  }

  const identity = await getIdentity();
  if (identity) {
    return buildEmptyData(
      orgFromWorkspace(identity.active ?? { id: "", name: "", kind: "manager" }),
    );
  }
  // Signed out, only the tenant portal is reachable, and it has nothing of its
  // own to show: the French sample cabinet stands in.
  return DATASETS.fr;
});

/** True when a sample cabinet is on screen instead of the account's own data. */
export async function isSampleData(): Promise<boolean> {
  return (await getDatasetId()) !== "real";
}

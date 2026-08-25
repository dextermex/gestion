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

export type DatasetId = "fr" | "lu";
// `TODAY` is widened: the demo pins a date so its figures stay stable, while a
// real account is simply "today". Everything else keeps its exact shape, so
// the structural-parity check below still catches a missing collection.
export type DemoData = Omit<typeof frData, "TODAY"> & { TODAY: string };

export const DATASET_COOKIE = "morada_dataset";

// `satisfies` enforces structural parity: a missing or mistyped export in the
// LU overlay is a compile error, mirroring the `Dict = typeof fr` i18n rule.
const DATASETS = { fr: frData, lu: luData } satisfies Record<DatasetId, DemoData>;

export async function getDatasetId(): Promise<DatasetId> {
  const jar = await cookies();
  return jar.get(DATASET_COOKIE)?.value === "lu" ? "lu" : "fr";
}

/**
 * The data every page reads.
 *
 * Signed in, it is the real account: the workspace comes from `agencies` and
 * `crm_members`, and every collection starts empty because no gestion data
 * exists yet. Each domain that gets connected fills its own collection here,
 * and the pages need no change — they were always reading through this seam.
 *
 * Signed out, it is the demonstration. A demo dataset can therefore never be
 * served to a real account: the two branches are exclusive, and the signed-in
 * one is checked first.
 */
export const getDemo = cache(async (): Promise<DemoData> => {
  // Development harness. A brand-new account sees empty collections, and that
  // state is impossible to render locally without a live Supabase session, so
  // ten screens shipped crashing on it. `npm run check:empty` sets this to
  // walk every route in exactly that state.
  //
  // NEVER set MORADA_PREVIEW_EMPTY in a deployed environment: it would hide
  // real data behind empty screens.
  if (process.env.MORADA_PREVIEW_EMPTY === "1") {
    return buildEmptyData(orgFromWorkspace({ id: "preview", name: "Espace de test", kind: "manager" }));
  }
  const identity = await getIdentity();
  if (identity) {
    return buildEmptyData(
      orgFromWorkspace(identity.active ?? { id: "", name: "", kind: "manager" }),
    );
  }
  return DATASETS[await getDatasetId()];
});

/** True when the demonstration is what is on screen. */
export async function isDemo(): Promise<boolean> {
  return (await getIdentity()) === null;
}

/**
 * Dataset selection for the demo. Two full datasets exist — the French-speaking
 * Cabinet Reuter (`data.ts`, the reference) and the Lëtzebuergesch-speaking
 * Cabinet Majerus (`data-lu.ts`, a string-level overlay with identical
 * figures). The active one is chosen per request from the `morada_dataset`
 * cookie, exactly like the locale — so pages read all demo data through
 * `getDemo()` and never import a dataset module directly.
 */

import { cookies } from "next/headers";
import * as frData from "./data";
import * as luData from "./data-lu";

export type DatasetId = "fr" | "lu";
export type DemoData = typeof frData;

export const DATASET_COOKIE = "morada_dataset";

// `satisfies` enforces structural parity: a missing or mistyped export in the
// LU overlay is a compile error, mirroring the `Dict = typeof fr` i18n rule.
const DATASETS = { fr: frData, lu: luData } satisfies Record<DatasetId, DemoData>;

export async function getDatasetId(): Promise<DatasetId> {
  const jar = await cookies();
  return jar.get(DATASET_COOKIE)?.value === "lu" ? "lu" : "fr";
}

export async function getDemo(): Promise<DemoData> {
  return DATASETS[await getDatasetId()];
}

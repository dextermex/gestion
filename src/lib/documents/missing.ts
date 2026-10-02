import type { MissingItem } from "./contract-parties";

/**
 * What a contract still lacks, said in one sentence the person can act on:
 * each party or the dwelling by name, the fields it lacks, and where they
 * are filled in. The route answers codes; this turns them into words, the
 * same way on the document control and in the signature dialog.
 */
export interface MissingLabels {
  intro: string;
  fields: Record<string, string>;
  where: { lessor: string; tenant: string; property: string };
  join: string;
}

export function describeMissing(missing: MissingItem[], labels: MissingLabels): string {
  const parts = missing.map((m) => `${m.name} (${m.fields.map((f) => labels.fields[f] ?? f).join(", ")}) ${labels.where[m.subject]}`);
  return `${labels.intro} ${parts.join(labels.join)}.`;
}

/** The missing list as the route sent it, or nothing when the payload is not one. */
export function missingOf(payload: Record<string, unknown>): MissingItem[] {
  if (!Array.isArray(payload.missing)) return [];
  return (payload.missing as unknown[]).filter((m): m is MissingItem => {
    const x = m as Partial<MissingItem>;
    return typeof x?.name === "string" && Array.isArray(x.fields) && (x.subject === "lessor" || x.subject === "tenant" || x.subject === "property");
  });
}

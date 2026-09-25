import Link from "next/link";
import { PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import SettingsForm from "@/components/gestion/SettingsForm";
import TemplatesPanel, { type TemplateRow } from "@/components/gestion/TemplatesPanel";
import { getDemo, isSampleData } from "@/lib/demo";
import { getIdentity } from "@/lib/workspace";
import { formatDate, formatDateTime } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { LOCALE_LABELS, fmt } from "@/lib/i18n/config";
import { paramsInForce } from "@/domain/legal/params";
import { availableLanguages, templateFor } from "@/lib/documents/wording";

/**
 * Réglages: the workspace itself, and the registries every calculation
 * relies on. The cabinet rows (autorisation, RC insurance, VAT) render only
 * when the dataset carries them — a real account that has not filled its
 * profile simply shows fewer rows, never placeholders. The paper trail
 * starts here too: what the documents print as their sender, the templates
 * the workspace validated, and the journal the base keeps of every write.
 */
export default async function ReglagesPage() {
  const { locale, d } = await getI18n();
  const { AUDIT, LESSOR, ORG, TEMPLATES, TODAY } = await getDemo({ audit: true });
  const identity = await getIdentity();
  const sample = await isSampleData();
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: ORG.shortName }) : null;

  // The legal-parameters registry moved here from Conformité: it governs
  // the calculations of the whole workspace, so it lives with the workspace.
  const params = paramsInForce(TODAY);
  const uncertain = params.filter((p) => p.status === "uncertain");

  const rows: Array<{ label: string; value: string }> = [
    { label: d.reglages.workspaceName, value: ORG.name },
    {
      label: d.reglages.workspaceKind,
      value: ORG.kind === "owner" ? d.reglages.kindOwner : d.reglages.kindCabinet,
    },
  ];
  if (identity) {
    rows.push({
      label: d.reglages.signedInAs,
      value: `${identity.displayName} · ${identity.email}`,
    });
  }
  if (ORG.autorisationNumber) {
    rows.push({
      label: d.reglages.autorisation,
      value: fmt(d.reglages.autorisationValue, {
        num: ORG.autorisationNumber,
        date: formatDate(ORG.autorisationExpiry, locale),
      }),
    });
  }
  if (ORG.piInsuranceProvider) {
    rows.push({
      label: d.reglages.piInsurance,
      value: fmt(d.reglages.piInsuranceValue, {
        provider: ORG.piInsuranceProvider,
        date: formatDate(ORG.piInsuranceExpiry, locale),
      }),
    });
  }
  if (ORG.vatNumber) rows.push({ label: d.reglages.vat, value: ORG.vatNumber });

  const registries = [{ href: "/app/banque", title: d.reglages.bankLink, body: d.reglages.bankBody }];

  // The languages a document can be produced in are the ones a template
  // exists in: the form offers nothing the registry cannot honour.
  const languages = (["fr", "en", "de", "lu"] as const)
    .filter((lang) => availableLanguages("rent_notice").includes(lang))
    .map((lang) => ({ value: lang, label: LOCALE_LABELS[lang] }));
  const kindLabels = d.documents.kindLabels as Record<string, string>;
  const templateRows: TemplateRow[] = TEMPLATES.map((t) => {
    const tpl = templateFor(t.kind, t.lang);
    return {
      ...t,
      label: kindLabels[t.kind] ?? t.kind,
      languageLabel: LOCALE_LABELS[t.lang],
      statusLabel:
        t.current && t.validatedOn
          ? fmt(d.reglages.tplValidated, { date: formatDate(t.validatedOn, locale) })
          : t.validatedOn
            ? d.reglages.tplOutdated
            : d.reglages.tplPending,
      notes: tpl?.notes ?? "",
      params: tpl?.legalParams ?? [],
    };
  });
  const verbs: Record<string, string> = { insert: d.reglages.journalVerbInsert, update: d.reglages.journalVerbUpdate, delete: d.reglages.journalVerbDelete };
  const objects = d.reglages.journalObjects as Record<string, string>;
  const actorLabel = (actor: string | null): string => {
    if (!actor) return d.common.none;
    if (identity && actor === identity.userId) return identity.displayName;
    return actor.slice(0, 8);
  };

  return (
    <div>
      <PageHeader title={d.reglages.title} subtitle={d.reglages.subtitle} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Panel title={d.reglages.lessorTitle}>
            <p className="mb-4 text-sm leading-relaxed text-ink-soft">{d.reglages.lessorBody}</p>
            {!LESSOR.complete && !sample && (
              <p role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" data-settings-incomplete>
                {d.reglages.lessorIncomplete}
              </p>
            )}
            <SettingsForm
              initial={LESSOR}
              languages={languages}
              writable={!sample}
              sampleNote={sampleNote}
              labels={{
                fieldLegalName: d.reglages.fieldLegalName,
                fieldSignatory: d.reglages.fieldSignatory,
                fieldStreet: d.reglages.fieldStreet,
                fieldNumber: d.reglages.fieldNumber,
                fieldPostalCode: d.reglages.fieldPostalCode,
                fieldCity: d.reglages.fieldCity,
                fieldCountry: d.reglages.fieldCountry,
                fieldEmail: d.reglages.fieldEmail,
                fieldPhone: d.reglages.fieldPhone,
                fieldIban: d.reglages.fieldIban,
                fieldBic: d.reglages.fieldBic,
                fieldHolder: d.reglages.fieldHolder,
                fieldDocLang: d.reglages.fieldDocLang,
                save: d.reglages.lessorSave,
                saved: d.reglages.lessorSaved,
                invalidName: d.reglages.lessorInvalidName,
                invalidIban: d.reglages.lessorInvalidIban,
                invalidBic: d.reglages.lessorInvalidBic,
                invalidEmail: d.reglages.lessorInvalidEmail,
                failed: d.reglages.lessorFailed,
              }}
            />
          </Panel>

          <Panel title={d.reglages.templatesTitle}>
            <p className="mb-3 text-sm leading-relaxed text-ink-soft">{d.reglages.templatesBody}</p>
            <TemplatesPanel
              rows={templateRows}
              writable={!sample}
              sampleNote={sampleNote}
              labels={{
                colTemplate: d.reglages.colTemplate,
                colLanguage: d.reglages.colLanguage,
                colVersion: d.reglages.colVersion,
                colStatus: d.reglages.colStatus,
                preview: d.reglages.tplPreview,
                validate: d.reglages.tplValidate,
                unvalidate: d.reglages.tplUnvalidate,
                validatedNote: d.reglages.tplValidatedNote,
                withdrawnNote: d.reglages.tplWithdrawnNote,
                failed: d.reglages.tplFailed,
                notesLabel: d.reglages.tplNotesLabel,
                paramsLabel: d.reglages.tplParamsLabel,
              }}
            />
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title={d.reglages.workspaceTitle}>
            <dl className="divide-y divide-sand-100">
              {rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-sm text-ink-soft">{r.label}</dt>
                  <dd className="min-w-0 text-right text-sm font-semibold text-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
            {ORG.autorisationNumber !== "" && <LegalNote>{d.conformite.orgLegal}</LegalNote>}
          </Panel>

          <Panel title={fmt(d.conformite.paramsTitle, { n: params.length })}>
            <p className="text-sm leading-relaxed text-ink-soft">{d.conformite.paramsBody}</p>
            <div className="mt-3 rounded-xl bg-sand-50 p-3.5">
              <p className="text-xs font-semibold text-ink">
                {fmt(d.conformite.paramsUncertain, { n: uncertain.length })}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{d.conformite.paramsFoot}</p>
            </div>
          </Panel>

          <Panel title={d.reglages.registriesTitle}>
            <div className="space-y-3">
              {registries.map((r) => (
                <Link
                  key={r.href}
                  href={r.href}
                  className="tactile block rounded-xl border border-sand-200 p-4 transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-brand-200 hover:bg-sand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  <p className="text-sm font-semibold text-brand-700">{r.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">{r.body}</p>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title={d.reglages.journalTitle}>
            <p className="mb-3 text-sm leading-relaxed text-ink-soft">{d.reglages.journalBody}</p>
            {AUDIT.length === 0 ? (
              <p className="text-sm text-ink-soft" data-journal-empty>
                {d.reglages.journalNone}
              </p>
            ) : (
              <ul className="divide-y divide-sand-100 text-sm" data-journal>
                {AUDIT.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-3 py-2" data-journal-entry={a.objectType}>
                    <p className="min-w-0 truncate text-ink">
                      <span className="font-semibold">{objects[a.objectType] ?? a.objectType}</span> · {verbs[a.verb] ?? a.verb}
                      <span className="text-ink-soft"> · {actorLabel(a.actor)}</span>
                    </p>
                    <p className="shrink-0 text-xs tabular-nums text-ink-soft">{formatDateTime(a.at, locale)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

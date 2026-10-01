import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { CollapsiblePanel, LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { DemoAction } from "@/components/gestion/DemoAction";
import { getDemo, isSampleData } from "@/lib/demo";
import type { DemoLease } from "@/lib/demo/data";
import { DOCUMENT_KINDS } from "@/lib/documents/kinds";
import { availableLanguages } from "@/lib/documents/wording";
import { signatureProvider, signatureProviderLabel } from "@/lib/signature/provider";
import { euros, formatDate, leaseStatusMeta, leaseTypeMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { LOCALE_LABELS, fmt, plural } from "@/lib/i18n/config";
import { leaseIssueText } from "@/lib/i18n/engine";
import { RESIDENTIAL_MANDATORY_MENTIONS, validateLeaseDraft } from "@/domain/lease/rules";
import { getParamValue } from "@/domain/legal/params";
import { cents } from "@/domain/money";

const STATUS_ORDER: Record<DemoLease["status"], number> = { draft: 0, notice: 1, active: 2, ended: 3 };

/**
 * Modèles & contrats. The contracts lead with their signature funnel (a
 * dossier until the lease is activated, a contract produced and sealed
 * here, signed once the lease runs on it), the validated templates and the
 * contracts missing from the vault beside them, then the register. The
 * signature itself is a seam: a real account is told which provider is
 * connected, a sample cabinet plays the sending. The compliance gate and
 * the generator's rules are reference, folded.
 */
export default async function ContratsPage() {
  const { locale, d } = await getI18n();
  const { LEASES, TEMPLATES, TODAY, generatedFor, leaseTenantNames, leaseUnitLabel } = await getDemo();
  const sample = await isSampleData();
  const signature = signatureProvider();
  const statusMeta = leaseStatusMeta(d);
  const typeMeta = leaseTypeMeta(d);
  const kindLabels = d.documents.kindLabels as Record<string, string>;

  const contractOf = (l: DemoLease) => generatedFor("lease_contract", l.id);
  const drafts = LEASES.filter((l) => l.status === "draft");
  const running = LEASES.filter((l) => l.status === "active" || l.status === "notice");
  const produced = LEASES.filter((l) => contractOf(l) !== null);
  const toSign = drafts.filter((l) => contractOf(l) !== null);
  const signed = produced.filter((l) => l.status !== "draft");
  const missing = running.filter((l) => contractOf(l) === null);
  const rows = [...LEASES].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.startDate < b.startDate ? 1 : -1));

  // Each template a document can be produced from, with the validation it carries.
  const templates = DOCUMENT_KINDS.map((kind) => ({
    kind,
    label: kindLabels[kind] ?? kind,
    langs: availableLanguages(kind).map((lang) => {
      const t = TEMPLATES.find((x) => x.kind === kind && x.lang === lang);
      const state: "validated" | "outdated" | "pending" = t?.current ? "validated" : t?.validatedOn ? "outdated" : "pending";
      return { lang, label: LOCALE_LABELS[lang], state, validatedOn: t?.validatedOn ?? null };
    }),
  }));
  const slots = templates.reduce((n, t) => n + t.langs.length, 0);
  const validated = templates.reduce((n, t) => n + t.langs.filter((l) => l.state === "validated").length, 0);
  const languages = new Set(templates.flatMap((t) => t.langs.map((l) => l.lang))).size;

  const mentionLabels: Record<(typeof RESIDENTIAL_MANDATORY_MENTIONS)[number], string> = {
    parties_identity: d.contrats.mentionParties,
    property_designation: d.contrats.mentionDesignation,
    lease_start_date: d.contrats.mentionStart,
    duration_or_indefinite: d.contrats.mentionDuration,
    rent_amount: d.contrats.mentionRent,
    charges_regime: d.contrats.mentionCharges,
    deposit_terms: d.contrats.mentionDeposit,
    capital_investi_declaration: d.contrats.mentionCapital,
  };

  // A deliberately non-compliant draft: the generator refuses it, live.
  const badDraftMonths = 3;
  const badDraft = validateLeaseDraft(
    {
      type: "residential",
      startDate: "2026-10-01",
      endDate: null,
      monthlyRent: cents(2400),
      monthlyCharges: cents(300),
      depositMonths: badDraftMonths,
      depositForm: "cash",
      mentions: {
        parties_identity: "ok",
        property_designation: "ok",
        lease_start_date: "ok",
        duration_or_indefinite: "ok",
        rent_amount: "ok",
        charges_regime: "ok",
        deposit_terms: "ok",
        // capital_investi_declaration missing
      },
      hasCpiEscalationClause: true,
      furnished: false,
      colocation: false,
    },
    TODAY,
  );
  const issueVars = { months: badDraftMonths, max: getParamValue("residential.deposit_max_months", TODAY), date: d.common.none };

  const signatureNote = sample ? d.contrats.signatureDemo : signature.provider ? fmt(d.contrats.signatureOn, { provider: signatureProviderLabel(signature.provider) }) : d.contrats.signatureOff;
  const signatureOn = sample || signature.configured;
  const heroSub = [plural(locale, drafts.length, d.contrats.draftsOne, d.contrats.draftsMany), plural(locale, produced.length, d.contrats.producedOne, d.contrats.producedMany)].join(" · ");
  const tplState = (state: "validated" | "outdated" | "pending", validatedOn: string | null) =>
    state === "validated" && validatedOn ? fmt(d.contrats.tplValidated, { date: formatDate(validatedOn, locale) }) : state === "outdated" ? d.contrats.tplOutdated : d.contrats.tplPending;

  return (
    <div>
      <PageHeader title={d.contrats.title} subtitle={d.contrats.subtitle} />

      <section className="crm-lead" aria-label={d.contrats.heroTitle}>
        <Card className="crm-metric crm-lead-hero">
          <div className="crm-metric-top">
            <span>{d.contrats.heroTitle}</span>
            <span className="crm-symbol">
              <Icon name="contract" size={22} />
            </span>
          </div>
          <p className="crm-metric-value">{running.length}</p>
          <p className="crm-metric-sub">{heroSub}</p>
          <ol className="crm-funnel">
            <li>
              <span className="crm-funnel-count">{drafts.length}</span>
              <span className="crm-funnel-label">{d.contrats.stageDossier}</span>
            </li>
            <li>
              <span className="crm-funnel-count">{toSign.length}</span>
              <span className="crm-funnel-label">{d.contrats.stageToSign}</span>
            </li>
            <li>
              <span className="crm-funnel-count">{signed.length}</span>
              <span className="crm-funnel-label">{d.contrats.stageSigned}</span>
            </li>
          </ol>
          <p className={"crm-funnel-note" + (signatureOn ? " is-on" : "")} role="status">
            <Icon name={signatureOn ? "check" : "alert"} size={16} />
            <span>{signatureNote}</span>
          </p>
          <p className="crm-funnel-legal">{d.contrats.registryLegal}</p>
        </Card>

        <Card className="crm-metric">
          <div className="crm-metric-top">
            <span>{d.contrats.templatesTitle}</span>
            <span className="crm-symbol">
              <Icon name="documents" size={22} />
            </span>
          </div>
          <p className="crm-metric-value">{validated}</p>
          <p className="crm-metric-sub">{fmt(d.contrats.templatesSub, { total: slots, langs: languages })}</p>
          <div className="crm-metric-progress">
            <div className="crm-metric-track" aria-hidden>
              <span style={{ width: `${slots > 0 ? Math.round((validated / slots) * 100) : 0}%` }} />
            </div>
          </div>
          <Link href="/app/reglages" className="crm-metric-action">
            {d.contrats.templatesAction}
            <Icon name="chevron-right" size={15} />
          </Link>
        </Card>

        <Card className={"crm-metric" + (missing.length > 0 ? " crm-metric-attention" : "")}>
          <div className="crm-metric-top">
            <span>{d.contrats.missingTitle}</span>
            <span className="crm-symbol">
              <Icon name="lock" size={22} />
            </span>
          </div>
          <p className="crm-metric-value">{missing.length}</p>
          <p className="crm-metric-sub">{missing.length > 0 ? d.contrats.missingSub : d.contrats.missingNone}</p>
          {missing.length > 0 && (
            <Link href="/app/baux" className="crm-metric-action">
              {d.contrats.missingAction}
              <Icon name="chevron-right" size={15} />
            </Link>
          )}
        </Card>
      </section>

      <Panel title={d.contrats.registryTitle}>
        {rows.length === 0 ? (
          <EmptyState icon="contract" title={d.contrats.missingNone} />
        ) : (
          <div className="table-scroll crm-contract-table">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 text-left text-ink-soft">
                  <th className="px-4 py-2.5 font-semibold">{d.contrats.colLease}</th>
                  <th className="px-3 py-2.5 font-semibold max-md:hidden">{d.contrats.colType}</th>
                  <th className="px-3 py-2.5 font-semibold">{d.contrats.colStatus}</th>
                  <th className="px-3 py-2.5 font-semibold max-sm:hidden">{d.contrats.colContract}</th>
                  {sample && <th className="px-3 py-2.5" aria-hidden />}
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const contract = contractOf(l);
                  return (
                    <tr key={l.id} className="border-b border-sand-100 align-top last:border-0" data-contract={l.id}>
                      <td className="px-4 py-3">
                        <Link href={`/app/baux/${l.id}`} className="crm-contract-lease">
                          {leaseUnitLabel(l)}
                        </Link>
                        <p className="crm-contract-sub">
                          {leaseTenantNames(l).join(", ")} · {euros(l.rentCents, locale)}
                          {d.common.perMonth} · {formatDate(l.startDate, locale)}
                        </p>
                        <div className="mt-2 sm:hidden">
                          {contract ? (
                            <p className="crm-contract-state">{fmt(d.contrats.contractProduced, { date: formatDate(contract.generatedAt, locale) })}</p>
                          ) : (
                            <p className="crm-contract-state">{l.status === "draft" ? d.contrats.contractDraft : d.contrats.contractOutside}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 max-md:hidden">
                        <MetaBadge meta={typeMeta[l.type]} />
                      </td>
                      <td className="px-3 py-3">
                        <MetaBadge meta={statusMeta[l.status]} />
                      </td>
                      <td className="px-3 py-3 max-sm:hidden">
                        {contract ? (
                          <p className="crm-contract-state">
                            {fmt(d.contrats.contractProduced, { date: formatDate(contract.generatedAt, locale) })}
                            {!sample && (
                              <>
                                {" · "}
                                <a href={`/api/documents/${encodeURIComponent(contract.documentId)}/fichier`}>{d.contrats.openFile}</a>
                              </>
                            )}
                          </p>
                        ) : l.status === "draft" ? (
                          <p className="crm-contract-state">
                            {d.contrats.contractDraft}
                            {" · "}
                            <Link href={`/app/biens/locataire?bail=${encodeURIComponent(l.id)}`}>{d.contrats.resume}</Link>
                          </p>
                        ) : (
                          <p className="crm-contract-state">
                            {d.contrats.contractOutside}
                            {" · "}
                            <Link href={`/app/baux/${l.id}`}>{d.contrats.openLease}</Link>
                          </p>
                        )}
                      </td>
                      {sample && (
                        <td className="px-3 py-2 text-right">
                          {contract && l.status === "draft" && <DemoAction label={d.contrats.send} doneMessage={d.contrats.sentDemo} variant="secondary" />}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title={d.contrats.templatesListTitle}
        className="mt-5"
        action={
          <Link href="/app/reglages" className="crm-contract-link">
            {d.contrats.templatesAction}
          </Link>
        }
      >
        <ul className="crm-tpl">
          {templates.map((t) => (
            <li key={t.kind}>
              <span className="crm-tpl-name">{t.label}</span>
              <span className="crm-tpl-langs">
                {t.langs.map((l) => (
                  <span key={l.lang} className={"is-" + l.state} data-template={t.kind} data-template-lang={l.lang}>
                    {l.label} · {tplState(l.state, l.validatedOn)}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <CollapsiblePanel title={d.contrats.gateTitle} className="mt-5">
        <p className="text-sm leading-relaxed text-ink-soft">{d.contrats.gateIntro}</p>
        <ul className="crm-gate mt-3">
          {badDraft.map((i) => (
            <li key={i.code}>
              <Icon name="alert" size={16} />
              <span>{leaseIssueText(d, i.code, issueVars, i.message)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-soft">{d.contrats.mentionsTitle}</p>
        <div className="crm-mentions">
          {RESIDENTIAL_MANDATORY_MENTIONS.map((m) => (
            <span key={m}>{mentionLabels[m]}</span>
          ))}
        </div>
        <LegalNote>{d.contrats.gateLegal}</LegalNote>
      </CollapsiblePanel>

      <CollapsiblePanel title={d.contrats.enforcedTitle} className="mt-5">
        <dl className="crm-rules">
          {d.contrats.enforced.map(([title, body]) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd>{body}</dd>
            </div>
          ))}
        </dl>
      </CollapsiblePanel>
    </div>
  );
}

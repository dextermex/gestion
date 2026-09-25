import { fmt } from "@/lib/i18n/config";
import { euros, formatDate, formatMonth } from "@/lib/types";
import { getParam, type LegalParamKey } from "@/domain/legal/params";
import { epcPayload } from "./epc";
import type { DocumentKind } from "./kinds";
import type {
  ArrearsData, ChargesStatementData, ComposeInput, DepositSettlementData, DocumentModel, EdlReportData, HousingCertificateData,
  IndexationNoticeData, LeaseContractData, Lessor, RentNoticeData, RentReceiptData, Section, TableSpec,
} from "./model";
import { templateFor, wordingFor, type KindWording, type Wording } from "./wording";

/**
 * A validated template plus real rows make a document model. Every legal
 * figure printed here is read from the legal-parameter registry as of the
 * document's date, with its status, so the letters never carry a number of
 * their own. Pure: the tests read the model, the renderer only draws it.
 */
export type ComposeFailure = { error: "no_template" };

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function composeDocument<K extends DocumentKind>(input: ComposeInput<K>): DocumentModel | ComposeFailure {
  const w = wordingFor(input.lang);
  const t = templateFor(input.kind, input.lang);
  if (!w || !t) return { error: "no_template" };
  const lang = input.lang;
  const money = (cents: number) => euros(cents, lang);
  const date = (iso: string) => formatDate(iso, lang);
  const month = (iso: string) => formatMonth(iso.slice(0, 7), lang);
  const param = (key: LegalParamKey) => {
    const p = getParam(key, input.on);
    return { value: p.value, status: w.common.paramStatus[p.status as "verified" | "uncertain"] ?? p.status };
  };
  const tenants = input.tenants.join(w.common.tenantsJoin);
  const common = {
    lessor: input.lessor.legalName,
    signatory: input.lessor.signatoryName || input.lessor.legalName,
    tenants,
    unit: input.place.unitLabel,
    address: input.place.propertyAddress,
  };
  const fill = (template: string, vars: Record<string, string | number>) => fmt(template, { ...common, ...vars });

  const base = (extra: { title: string; subject?: string; sections: Section[]; closing?: string[]; signature?: DocumentModel["signature"]; subtitle?: string }): DocumentModel => ({
    kind: input.kind,
    lang,
    version: t.version,
    title: extra.title,
    subtitle: extra.subtitle,
    sender: senderParty(input.lessor),
    recipient: { name: tenants, lines: [input.place.unitLabel, input.place.propertyAddress].filter(Boolean) },
    dateLine: fill(w.common.dateLine, { city: input.lessor.city, date: date(input.on) }),
    reference: input.reference,
    subject: extra.subject,
    sections: extra.sections,
    closing: extra.closing ?? t.closing,
    signature: extra.signature ?? { label: t.signatureLabel, name: common.signatory },
    footer: fill(w.common.footer, { kind: input.kind, version: t.version, lang }),
    watermark: input.watermark,
  });

  switch (input.kind) {
    case "rent_notice":
      return rentNotice(input as ComposeInput<"rent_notice">, w, t, base, fill, money, date, month);
    case "rent_receipt":
      return rentReceipt(input as ComposeInput<"rent_receipt">, w, t, base, fill, money, date, month);
    case "arrears_formal":
    case "arrears_mise_en_demeure":
      return arrears(input as ComposeInput<"arrears_formal">, w, t, base, fill, money, date, month);
    case "indexation_notice":
      return indexation(input as ComposeInput<"indexation_notice">, t, base, fill, money, param);
    case "charges_statement":
      return charges(input as ComposeInput<"charges_statement">, w, t, base, fill, money, date);
    case "deposit_settlement":
      return settlement(input as ComposeInput<"deposit_settlement">, w, t, base, fill, money, date, param);
    case "lease_contract":
      return lease(input as ComposeInput<"lease_contract">, w, t, base, fill, money, date, param);
    case "housing_certificate":
      return certificate(input as ComposeInput<"housing_certificate">, t, base, fill, date, param);
    case "edl_report":
      return edlReport(input as ComposeInput<"edl_report">, w, t, base, fill, date);
  }
  return { error: "no_template" };
}

function senderParty(l: Lessor) {
  return { name: l.legalName, lines: [l.addressLine, l.email, l.phone].filter(Boolean) };
}

type Base = (extra: { title: string; subject?: string; sections: Section[]; closing?: string[]; signature?: DocumentModel["signature"]; subtitle?: string }) => DocumentModel;
type Fill = (template: string, vars: Record<string, string | number>) => string;
type Money = (cents: number) => string;
type Day = (iso: string) => string;
type Param = (key: LegalParamKey) => { value: number; status: string };

function paymentSection(w: Wording, lessor: Lessor, amountCents: number, reference: string | null, text: string): Section {
  const kv: Array<[string, string]> = [[w.common.paymentBlock.iban, lessor.iban], [w.common.paymentBlock.holder, lessor.holderName]];
  if (lessor.bic) kv.push([w.common.paymentBlock.bic, lessor.bic]);
  if (reference) kv.push([w.common.paymentBlock.reference, reference]);
  return {
    heading: w.common.paymentBlock.heading,
    keyValues: kv,
    qr: lessor.iban ? { payload: epcPayload({ holderName: lessor.holderName, iban: lessor.iban, bic: lessor.bic, amountCents, reference: reference ?? undefined, text }), caption: w.common.paymentBlock.qrCaption } : undefined,
  };
}

function openPeriodsTable(w: Wording, rows: ArrearsData["openPeriods"], money: Money, date: Day, month: Day): TableSpec {
  const c = w.common.amountColumns;
  return {
    columns: [{ label: c.period }, { label: c.dueDate }, { label: c.billed, align: "right" }, { label: c.open, align: "right" }],
    rows: rows.map((r) => [month(r.period), date(r.dueDate), money(r.totalCents), money(r.openCents)]),
    total: ["", "", "", money(rows.reduce((a, r) => a + r.openCents, 0))],
  };
}

function rentNotice(input: ComposeInput<"rent_notice">, w: Wording, t: KindWording, base: Base, fill: Fill, money: Money, date: Day, month: Day): DocumentModel {
  const d: RentNoticeData = input.data;
  const remaining = d.totalCents - d.allocatedCents;
  const kv: Array<[string, string]> = [[t.labels.rent, money(d.rentCents)]];
  if (d.chargesCents > 0) kv.push([t.labels.charges, money(d.chargesCents)]);
  if (d.otherCents !== 0) kv.push([d.otherLabel || t.labels.other, money(d.otherCents)]);
  if (d.vatCents > 0) kv.push([t.labels.vat, money(d.vatCents)]);
  kv.push([t.labels.total, money(d.totalCents)]);
  if (d.allocatedCents > 0) {
    kv.push([t.labels.paid, money(d.allocatedCents)]);
    kv.push([t.labels.remaining, money(Math.max(0, remaining))]);
  }
  // The same components, said in one line of prose; the amount already
  // received only when there is one, so the paragraph disappears otherwise.
  const items = kv
    .filter(([label]) => label !== t.labels.total && label !== t.labels.paid && label !== t.labels.remaining)
    .map(([label, amount]) => `${label.toLowerCase()} ${amount}`)
    .join(", ");
  const vars = {
    period: month(d.period),
    total: money(d.totalCents),
    dueDate: date(d.dueDate),
    breakdown: t.labels.breakdownLine ? fill(t.labels.breakdownLine, { items }) : "",
    paid: d.allocatedCents > 0 && t.labels.paidLine ? fill(t.labels.paidLine, { paid: money(d.allocatedCents), remaining: money(Math.max(0, remaining)) }) : "",
  };
  return base({
    title: t.title,
    subject: t.subject ? fill(t.subject, vars) : undefined,
    sections: [
      { paragraphs: t.paragraphs.map((p) => fill(p, vars)).filter((p) => p.trim() !== "") },
      { keyValues: kv },
      paymentSection(w, input.lessor, Math.max(0, remaining), d.rfReference, `${input.place.unitLabel} ${month(d.period)}`),
    ],
  });
}

function rentReceipt(input: ComposeInput<"rent_receipt">, w: Wording, t: KindWording, base: Base, fill: Fill, money: Money, date: Day, month: Day): DocumentModel {
  const d: RentReceiptData = input.data;
  const items = d.allocations.map((a) => (t.labels.paymentItem ? fill(t.labels.paymentItem, { amount: money(a.cents), date: date(a.on) }) : `${money(a.cents)} ${date(a.on)}`)).join(", ");
  const vars = { period: month(d.period), total: money(d.totalCents), payments: t.labels.paymentsLine && items ? fill(t.labels.paymentsLine, { items }) : "" };
  return base({
    title: t.title,
    subject: t.subject ? fill(t.subject, vars) : undefined,
    sections: [
      { paragraphs: t.paragraphs.map((p) => fill(p, vars)).filter((p) => p.trim() !== "") },
      {
        table: {
          columns: [{ label: t.labels.paidOn }, { label: t.labels.amount, align: "right" }],
          rows: d.allocations.map((a) => [date(a.on), money(a.cents)]),
          total: ["", money(d.allocations.reduce((s, a) => s + a.cents, 0))],
        },
      },
    ],
  });
}

function arrears(input: ComposeInput<"arrears_formal">, w: Wording, t: KindWording, base: Base, fill: Fill, money: Money, date: Day, month: Day): DocumentModel {
  const d: ArrearsData = input.data;
  const reminders =
    d.friendlyOn && d.formalOn && t.labels.remindersBoth
      ? fill(t.labels.remindersBoth, { friendly: date(d.friendlyOn), formal: date(d.formalOn) })
      : (d.formalOn ?? d.friendlyOn) && t.labels.remindersOne
        ? fill(t.labels.remindersOne, { date: date((d.formalOn ?? d.friendlyOn) as string) })
        : "";
  const vars = { period: month(d.period), total: money(d.totalCents), dueDate: date(d.dueDate), open: money(d.openCents), reminders };
  const paragraphs = t.paragraphs.map((p) => cap(fill(p, vars).trim())).filter((p) => p !== "");
  return base({
    title: t.title,
    subject: t.subject ? fill(t.subject, vars) : undefined,
    sections: [
      { paragraphs },
      { heading: t.labels.statement, table: openPeriodsTable(w, d.openPeriods, money, date, month) },
      paymentSection(w, input.lessor, d.openPeriods.reduce((a, r) => a + r.openCents, 0), d.rfReference, `${input.place.unitLabel} ${month(d.period)}`),
    ],
  });
}

function indexation(input: ComposeInput<"indexation_notice">, t: KindWording, base: Base, fill: Fill, money: Money, param: Param): DocumentModel {
  const d: IndexationNoticeData = input.data;
  const ceiling = param("residential.rent_ceiling_pct_of_capital");
  const step = param("residential.rent_adjustment_max_step_pct");
  const interval = param("residential.rent_adjustment_min_interval_months");
  const constraint = /ceil|cap|plafond/i.test(d.bindingConstraint) ? t.labels.constraintCeiling : /step|palier/i.test(d.bindingConstraint) ? t.labels.constraintStep : t.labels.constraintNone;
  const vars = {
    current: money(d.currentRentCents),
    proposed: money(d.proposedRentCents),
    ceilingPct: ceiling.value,
    ceilingStatus: ceiling.status,
    ceilingMonthly: money(d.ceilingMonthlyCents),
    stepPct: step.value,
    stepStatus: step.status,
    intervalMonths: interval.value,
    intervalStatus: interval.status,
    constraint,
  };
  return base({
    title: t.title,
    subject: t.subject ? fill(t.subject, vars) : undefined,
    sections: [{ paragraphs: t.paragraphs.map((p) => fill(p, vars).trim()) }],
  });
}

function charges(input: ComposeInput<"charges_statement">, w: Wording, t: KindWording, base: Base, fill: Fill, money: Money, date: Day): DocumentModel {
  const d: ChargesStatementData = input.data;
  const regime = w.common.regimes[d.regime] ?? d.regime;
  const due = d.dueOn ? fill(t.labels.dueOn, { date: date(d.dueOn) }) : "";
  const amounts = { actual: money(d.actualCents), advances: money(d.advancesCents), balance: money(Math.abs(d.balanceCents)), due };
  const balance = d.balanceCents > 0 ? fill(t.labels.balanceOwed, amounts) : d.balanceCents < 0 ? fill(t.labels.balanceRefund, amounts) : fill(t.labels.balanceZero, amounts);
  const blocked = d.blockedCents > 0 ? fill(t.labels.blockedNote, { amount: money(d.blockedCents) }) : "";
  const vars = { year: d.year, regime, blocked, balance };
  const table: TableSpec = {
    columns: [
      { label: t.labels.label },
      { label: t.labels.category },
      { label: t.labels.buildingTotal, align: "right" },
      { label: t.labels.tantiemes, align: "right" },
      { label: t.labels.lotShare, align: "right" },
      { label: t.labels.tenantShare, align: "right" },
    ],
    rows: d.lines.map((l) => [
      l.label,
      (w.common.chargeCategories[l.category] ?? l.category) + (l.blocked ? ` (${t.labels.blockedMark})` : ""),
      l.buildingTotalCents === null ? "" : money(l.buildingTotalCents),
      l.tantiemes !== null && l.tantiemesTotal ? `${l.tantiemes}/${l.tantiemesTotal}` : "",
      money(l.lotShareCents),
      money(l.tenantShareCents),
    ]),
    total: ["", "", "", "", "", money(d.actualCents)],
  };
  return base({
    title: fill(t.title, vars),
    subject: t.subject ? fill(t.subject, vars) : undefined,
    sections: [
      { paragraphs: [fill(t.paragraphs[0], vars)] },
      { table },
      { paragraphs: [blocked, balance].filter((p) => p !== "") },
      {
        keyValues: [
          [t.labels.actual, money(d.actualCents)],
          [t.labels.advances, money(d.advancesCents)],
          [t.labels.balance, money(d.balanceCents)],
        ],
      },
    ],
  });
}

function settlement(input: ComposeInput<"deposit_settlement">, w: Wording, t: KindWording, base: Base, fill: Fill, money: Money, date: Day, param: Param): DocumentModel {
  const d: DepositSettlementData = input.data;
  const first = param("residential.deposit_first_tranche_months_after_keys");
  const balance = param("residential.deposit_balance_months_after_decompte");
  const justification = param("residential.deposit_justification_window_months");
  const penalty = param("residential.deposit_penalty_pct_of_monthly_rent_per_month");
  const vars = {
    deposit: money(d.depositCents),
    form: w.common.depositForms[d.form] ?? d.form,
    received: d.receivedOn ? fill(t.labels.received, { date: date(d.receivedOn) }) : "",
    keys: date(d.keyHandoverOn),
    decompte: d.decompteIssuedOn ? fill(t.labels.decompteIssued, { date: date(d.decompteIssuedOn) }) : fill(t.labels.decomptePending, { months: balance.value, status: balance.status }),
    retentions: d.lines.length === 0 ? t.labels.noRetention : fill(t.labels.totalRetained, { amount: money(d.totalRetainedCents) }),
    firstTranche: money(d.firstTrancheCents),
    firstTrancheDue: date(d.firstTrancheDueOn),
    firstTrancheRule: fill(t.labels.firstTrancheRule, { months: first.value, status: first.status }),
    balance: money(d.balanceCents),
    balanceDue: d.balanceDueOn ? fill(t.labels.balanceDue, { date: date(d.balanceDueOn) }) : "",
    balanceRule: fill(t.labels.balanceRule, { months: balance.value, status: balance.status }),
    released: money(d.releasedFirstTrancheCents + d.releasedBalanceCents),
    outstanding: money(d.outstandingCents),
    penalty: d.penaltyMonths > 0 ? fill(t.labels.penalty, { months: d.penaltyMonths, pct: penalty.value, amount: money(d.penaltyCents), status: penalty.status }) : "",
  };
  const table: TableSpec = {
    columns: [
      { label: t.labels.kind },
      { label: t.labels.label },
      { label: t.labels.amount, align: "right" },
      { label: t.labels.status },
      { label: t.labels.deadline },
      { label: t.labels.retained, align: "right" },
    ],
    rows: d.lines.map((l) => [
      w.common.deductionKinds[l.kind] ?? l.kind,
      l.label,
      money(l.amountCents),
      w.common.deductionStatuses[l.status] ?? l.status,
      l.deadline ? date(l.deadline) : "",
      money(l.retainedCents),
    ]),
    total: ["", "", "", "", "", money(d.totalRetainedCents)],
  };
  const sections: Section[] = [{ paragraphs: t.paragraphs.map((p) => fill(p, vars).trim()).filter((p) => p !== "") }];
  if (d.lines.length > 0) sections.push({ table, note: fill(t.labels.justificationRule, { months: justification.value, status: justification.status }) });
  return base({ title: t.title, subject: t.subject ? fill(t.subject, vars) : undefined, sections });
}

function lease(input: ComposeInput<"lease_contract">, w: Wording, t: KindWording, base: Base, fill: Fill, money: Money, date: Day, param: Param): DocumentModel {
  const d: LeaseContractData = input.data;
  const max = param(d.leaseType === "commercial" ? "commercial.deposit_max_months" : "residential.deposit_max_months");
  const details = [
    d.unit.floor && d.unit.floor !== "—" ? fill(t.labels.floor, { floor: d.unit.floor }) : "",
    d.unit.areaSqm > 0 ? fill(t.labels.area, { area: d.unit.areaSqm }) : "",
    d.unit.rooms > 0 ? fill(t.labels.rooms, { rooms: d.unit.rooms }) : "",
    d.unit.bedrooms ? fill(t.labels.bedrooms, { bedrooms: d.unit.bedrooms }) : "",
    d.furnished ? t.labels.furnished : "",
    d.energyClass ? fill(t.labels.energy, { energy: d.energyClass }) : "",
    d.cadastral ? fill(t.labels.cadastral, { cadastral: d.cadastral }) : "",
  ].filter(Boolean);
  const charges =
    d.chargesRegime === "advances" && d.chargesCents > 0
      ? fill(t.labels.chargesAdvances, { charges: money(d.chargesCents) })
      : d.chargesRegime === "forfait" && d.chargesCents > 0
        ? fill(t.labels.chargesForfait, { charges: money(d.chargesCents) })
        : d.chargesCents > 0
          ? fill(t.labels.chargesAdvances, { charges: money(d.chargesCents) })
          : t.labels.chargesNone;
  const vars = {
    designation: fill(t.labels.designation, { details: details.length ? `, ${details.join(", ")}` : "" }),
    duration: d.endDate ? fill(t.labels.durationFixed, { start: date(d.startDate), end: date(d.endDate) }) : fill(t.labels.durationOpen, { start: date(d.startDate) }),
    rent: fill(t.labels.rent, {
      rent: money(d.rentCents),
      charges,
      supplement: d.furnitureSupplementCents > 0 ? fill(t.labels.supplement, { supplement: money(d.furnitureSupplementCents) }) : "",
      day: d.paymentDay,
      reference: d.rfReference ? fill(t.labels.reference, { rf: d.rfReference }) : "",
      account: input.lessor.iban ? fill(t.labels.account, { iban: input.lessor.iban, holder: input.lessor.holderName }) : "",
    }),
    deposit: fill(t.labels.deposit, { months: d.depositMonths, amount: money(d.depositCents), form: w.common.depositForms[d.depositForm] ?? d.depositForm, max: max.value, status: max.status }),
    capital:
      d.capitalComponents.length > 0
        ? fill(t.labels.capitalList, {
            list: d.capitalComponents.map((c) => fill(t.labels.capitalItem, { kind: w.common.capitalKinds[c.kind] ?? c.kind, year: c.year, amount: money(c.cents) })).join(", "),
            total: money(d.capitalComponents.reduce((a, c) => a + c.cents, 0)),
          })
        : t.labels.capitalNone,
    colocation: d.colocation ? t.labels.colocation : "",
    leaseType: w.common.leaseTypes[d.leaseType] ?? d.leaseType,
  };
  return base({
    title: fill(t.title, vars),
    sections: [{ paragraphs: t.paragraphs.map((p) => fill(p, vars).trim()).filter((p) => p !== "") }],
    signature: { label: t.signatureLabel, name: input.lessor.signatoryName || input.lessor.legalName, second: { label: t.labels.tenantSignature, name: input.tenants.join(w.common.tenantsJoin) } },
  });
}

function certificate(input: ComposeInput<"housing_certificate">, t: KindWording, base: Base, fill: Fill, date: Day, param: Param): DocumentModel {
  const d: HousingCertificateData = input.data;
  const commune = param("compliance.commune_arrival_declaration_days");
  const vars = {
    start: date(d.startDate),
    end: d.endDate ? fill(t.labels.end, { end: date(d.endDate) }) : "",
    communeDays: commune.value,
    communeStatus: commune.status,
  };
  return base({ title: t.title, sections: [{ paragraphs: t.paragraphs.map((p) => fill(p, vars)) }] });
}

function edlReport(input: ComposeInput<"edl_report">, w: Wording, t: KindWording, base: Base, fill: Fill, date: Day): DocumentModel {
  const d: EdlReportData = input.data;
  const keys = d.keyHandoverAt ? fill(d.kind === "exit" ? t.labels.keysExit : t.labels.keysEntry, { date: date(d.keyHandoverAt) }) : t.labels.keysNone;
  const items = d.rooms.reduce((a, r) => a + r.items.length, 0);
  const vars = {
    edlKind: w.common.edlKinds[d.kind] ?? d.kind,
    date: d.completedAt ? date(d.completedAt) : date(input.on),
    keys,
    signed: d.signed ? t.labels.signed : t.labels.unsigned,
    summary: fill(t.labels.summary, { items, rooms: d.rooms.length, photos: d.photos.length, readings: d.readings.length }),
    manifest: d.manifestSha256,
  };
  const sections: Section[] = [{ paragraphs: t.paragraphs.map((p) => fill(p, vars)) }];
  for (const room of d.rooms) {
    sections.push({
      heading: room.room,
      table: {
        columns: [{ label: t.labels.category }, { label: t.labels.condition }, { label: t.labels.notes }, { label: t.labels.photos, align: "right" }],
        rows: room.items.map((i) => [w.common.edlCategories[i.category] ?? i.category, w.common.edlConditions[i.condition] ?? i.condition, i.notes, String(i.photos)]),
      },
    });
  }
  if (d.readings.length > 0) {
    sections.push({
      heading: t.labels.readingsHeading,
      table: { columns: [{ label: t.labels.meter }, { label: t.labels.value, align: "right" }, { label: t.labels.readOn }], rows: d.readings.map((r) => [r.meter, r.value, date(r.readOn)]) },
    });
  }
  if (d.photos.length > 0) {
    sections.push({
      heading: t.labels.photosHeading,
      table: {
        columns: [{ label: t.labels.photoRoom }, { label: t.labels.category }, { label: t.labels.capturedAt }, { label: t.labels.sha256 }],
        rows: d.photos.map((p) => [p.room, w.common.edlCategories[p.category] ?? p.category, date(p.capturedAt.slice(0, 10)), p.sha256]),
      },
    });
  }
  return base({
    title: fill(t.title, vars),
    subject: t.subject ? fill(t.subject, vars) : undefined,
    sections,
    closing: t.closing.map((c) => fill(c, vars)),
    signature: { label: t.signatureLabel, name: input.lessor.signatoryName || input.lessor.legalName, second: { label: w.common.recipientLabel, name: input.tenants.join(w.common.tenantsJoin) } },
  });
}

/** Whether a composed model still carries an unfilled placeholder: the guard the tests and the preview run. */
export function unfilledPlaceholders(model: DocumentModel): string[] {
  const texts: string[] = [model.title, model.subtitle ?? "", model.subject ?? "", model.dateLine, model.footer, ...(model.closing ?? [])];
  for (const s of model.sections) {
    texts.push(s.heading ?? "", s.note ?? "", ...(s.paragraphs ?? []));
    for (const [k, v] of s.keyValues ?? []) texts.push(k, v);
    if (s.table) {
      texts.push(...s.table.columns.map((c) => c.label), ...s.table.rows.flat(), ...(s.table.total ?? []));
    }
  }
  return texts.flatMap((t) => t.match(/\{[a-zA-Z]+\}/g) ?? []);
}

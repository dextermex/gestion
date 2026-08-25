"use client";

/**
 * Tenant portal client app: invitation landing, onboarding wizard (identity,
 * contact details, address, account, review) and the portal itself (my rental,
 * contracts & documents, rent & payments, requests, profile).
 *
 * Demo persistence: the tenant account and their locally created requests live
 * in localStorage; the manager's lease page reads the same keys to show the
 * invitation status. No server state.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Dict } from "@/lib/i18n/fr";
import type { Locale } from "@/lib/i18n/config";
import { fmt } from "@/lib/i18n/config";
import { euros, formatDate, formatMonth } from "@/lib/types";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/pro/ui";

const ACCOUNT_KEY = "morada_portal_account_v1";
const INVITES_KEY = "morada_portal_invites_v1";
const REQUESTS_KEY = "morada_portal_requests_v1";

type PortalStrings = Dict["portal"];

export interface PortalBundle {
  leaseId: string;
  tenantName: string;
  unitLabel: string;
  propertyName: string;
  address: string;
  rentCents: number;
  chargesCents: number;
  chargesRegimeLabel: string;
  depositMonths: number;
  depositFormLabel: string;
  startDate: string;
  rfRef: string;
  periods: Array<{
    period: string;
    dueDate: string;
    totalCents: number;
    status: string;
    statusLabel: string;
    statusColor: string;
  }>;
  requests: Array<{ id: string; ref: string; title: string; createdAt: string; statusLabel: string; statusColor: string }>;
  documents: Array<{ name: string; sizeKb: number; createdAt: string }>;
}

export interface PortalOrg {
  name: string;
  managerName: string;
  email: string;
}

interface TenantAccount {
  leaseId: string;
  firstName: string;
  lastName: string;
  docType: "passport" | "id_card";
  docNumber: string;
  email: string;
  mobile: string;
  landline: string;
  otherContact: string;
  street: string;
  number: string;
  postal: string;
  city: string;
  country: string;
  createdAt: string;
}

interface StoredRequest {
  id: string;
  leaseId: string;
  kind: "tech" | "admin";
  category: string;
  urgency: string;
  description: string;
  createdAt: string;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the session keeps working in memory */
  }
}

type Tab = "home" | "docs" | "payments" | "requests" | "profile";

export function PortalApp({
  locale,
  strings: s,
  demoLabel,
  bundles,
  org,
  defaultLeaseId,
}: {
  locale: Locale;
  strings: PortalStrings;
  demoLabel: string;
  bundles: PortalBundle[];
  org: PortalOrg;
  defaultLeaseId: string;
}) {
  const [account, setAccount] = useState<TenantAccount | null>(null);
  const [wizardLease, setWizardLease] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = readJson<TenantAccount | null>(ACCOUNT_KEY, null);
    if (stored && bundles.some((b) => b.leaseId === stored.leaseId)) {
      setAccount(stored);
    } else {
      const invite = new URLSearchParams(window.location.search).get("invite");
      if (invite && bundles.some((b) => b.leaseId === invite)) setWizardLease(invite);
    }
    setMounted(true);
  }, [bundles]);

  const bundle = useMemo(() => {
    const id = account?.leaseId ?? wizardLease;
    return bundles.find((b) => b.leaseId === id) ?? null;
  }, [account, wizardLease, bundles]);

  if (!mounted) return <PortalFrame demoLabel={demoLabel} strings={s} />;

  if (account && bundle) {
    return (
      <PortalHome
        locale={locale}
        strings={s}
        demoLabel={demoLabel}
        account={account}
        bundle={bundle}
        org={org}
        onSignOut={() => {
          try {
            localStorage.removeItem(ACCOUNT_KEY);
          } catch {
            /* ignore */
          }
          setAccount(null);
          setWizardLease(null);
        }}
      />
    );
  }

  if (wizardLease && bundle) {
    return (
      <PortalFrame demoLabel={demoLabel} strings={s}>
        <OnboardingWizard
          strings={s}
          bundle={bundle}
          onDone={(acct) => {
            writeJson(ACCOUNT_KEY, acct);
            const invites = readJson<Record<string, { invitedAt: string }>>(INVITES_KEY, {});
            invites[acct.leaseId] = invites[acct.leaseId] ?? { invitedAt: acct.createdAt };
            writeJson(INVITES_KEY, invites);
            setAccount(acct);
          }}
        />
      </PortalFrame>
    );
  }

  return (
    <PortalFrame demoLabel={demoLabel} strings={s}>
      <Card className="mx-auto mt-10 max-w-xl p-8 text-center">
        <h1 className="font-display text-2xl font-bold text-ink">{s.landingTitle}</h1>
        <p className="mt-2 text-sm text-ink-soft">{s.landingBody}</p>
        <p className="mt-4 rounded-xl bg-sand-100 px-4 py-3 text-sm text-ink-soft">{s.landingNeedInvite}</p>
        <Button className="mt-5" onClick={() => setWizardLease(defaultLeaseId)}>
          {s.landingDemo}
        </Button>
        <p className="mt-5 text-sm">
          <Link href="/" className="font-semibold text-brand-700 hover:underline">
            {s.backToSite}
          </Link>
        </p>
      </Card>
    </PortalFrame>
  );
}

/* ─── Shared frame (logo header, sand background) ─────────────────────────── */

function PortalFrame({
  demoLabel,
  strings: s,
  children,
}: {
  demoLabel: string;
  strings: PortalStrings;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-sand-50 pb-16">
      <header className="border-b border-sand-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4">
          <p className="font-display text-lg font-bold tracking-tight text-ink">
            Morada <span className="text-brand-600">Gestion</span>
          </p>
          <div className="flex items-center gap-2">
            <Badge className="bg-sand-100 text-ink-soft">{s.landingTitle}</Badge>
            <Badge className="bg-accent-100 text-accent-800">{demoLabel}</Badge>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4">{children}</main>
    </div>
  );
}

/* ─── Onboarding wizard ───────────────────────────────────────────────────── */

const STEPS = ["identity", "contact", "address", "account", "review"] as const;
type Step = (typeof STEPS)[number];

interface WizardForm {
  firstName: string;
  lastName: string;
  docType: "passport" | "id_card";
  docNumber: string;
  email: string;
  emailConfirm: string;
  mobile: string;
  landline: string;
  otherContact: string;
  street: string;
  number: string;
  postal: string;
  city: string;
  country: string;
  password: string;
  passwordConfirm: string;
  consent: boolean;
}

const EMPTY_FORM: WizardForm = {
  firstName: "",
  lastName: "",
  docType: "id_card",
  docNumber: "",
  email: "",
  emailConfirm: "",
  mobile: "",
  landline: "",
  otherContact: "",
  street: "",
  number: "",
  postal: "",
  city: "",
  country: "Luxembourg",
  password: "",
  passwordConfirm: "",
  consent: false,
};

function OnboardingWizard({
  strings: s,
  bundle,
  onDone,
}: {
  strings: PortalStrings;
  bundle: PortalBundle;
  onDone: (acct: TenantAccount) => void;
}) {
  const [step, setStep] = useState<Step>("identity");
  const [form, setForm] = useState<WizardForm>(() => {
    const [first, ...rest] = bundle.tenantName.split(" ");
    return { ...EMPTY_FORM, firstName: first ?? "", lastName: rest.join(" ") };
  });
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.indexOf(step);
  const stepTitles: Record<Step, string> = {
    identity: s.obStepIdentity,
    contact: s.obStepContact,
    address: s.obStepAddress,
    account: s.obStepAccount,
    review: s.obStepReview,
  };

  const set = <K extends keyof WizardForm>(key: K, value: WizardForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (step === "identity") {
      if (!form.firstName.trim() || !form.lastName.trim() || !form.docNumber.trim()) return s.requiredHint;
    }
    if (step === "contact") {
      if (!form.email.trim() || !form.mobile.trim()) return s.requiredHint;
      if (form.email.trim().toLowerCase() !== form.emailConfirm.trim().toLowerCase()) return s.emailMismatch;
    }
    if (step === "address") {
      if (!form.street.trim() || !form.number.trim() || !form.postal.trim() || !form.city.trim() || !form.country.trim())
        return s.requiredHint;
    }
    if (step === "account") {
      if (form.password.length < 8) return s.requiredHint;
      if (form.password !== form.passwordConfirm) return s.passwordMismatch;
      if (!form.consent) return s.requiredHint;
    }
    return null;
  };

  const next = () => {
    const err = validate();
    setError(err);
    if (err) return;
    if (step === "review") {
      onDone({
        leaseId: bundle.leaseId,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        docType: form.docType,
        docNumber: form.docNumber.trim(),
        email: form.email.trim(),
        mobile: form.mobile.trim(),
        landline: form.landline.trim(),
        otherContact: form.otherContact.trim(),
        street: form.street.trim(),
        number: form.number.trim(),
        postal: form.postal.trim(),
        city: form.city.trim(),
        country: form.country.trim(),
        createdAt: new Date().toISOString().slice(0, 10),
      });
      return;
    }
    setStep(STEPS[stepIndex + 1]);
  };

  const docTypeLabel = form.docType === "passport" ? s.docTypePassport : s.docTypeId;

  return (
    <Card className="mx-auto mt-8 max-w-xl p-6 sm:p-8">
      <h1 className="font-display text-2xl font-bold text-ink">{s.obTitle}</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        {fmt(s.obIntro, { unit: `${bundle.unitLabel} · ${bundle.propertyName}` })}
      </p>

      <div className="mt-5 flex items-center gap-2">
        {STEPS.map((st, i) => (
          <div
            key={st}
            className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? "bg-brand-500" : "bg-sand-100"}`}
            aria-hidden
          />
        ))}
      </div>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {fmt(s.obStep, { n: stepIndex + 1, total: STEPS.length })} · {stepTitles[step]}
      </p>

      <div className="mt-5 space-y-4">
        {step === "identity" && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={s.firstName}>
                <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoFocus />
              </Field>
              <Field label={s.lastName}>
                <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={s.docType}>
                <Select value={form.docType} onChange={(e) => set("docType", e.target.value as WizardForm["docType"])}>
                  <option value="id_card">{s.docTypeId}</option>
                  <option value="passport">{s.docTypePassport}</option>
                </Select>
              </Field>
              <Field label={s.docNumber}>
                <Input value={form.docNumber} onChange={(e) => set("docNumber", e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-ink-soft">{s.docPrivacy}</p>
          </>
        )}

        {step === "contact" && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={s.email}>
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} autoFocus />
              </Field>
              <Field label={s.emailConfirm}>
                <Input type="email" value={form.emailConfirm} onChange={(e) => set("emailConfirm", e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={s.mobile}>
                <Input type="tel" value={form.mobile} onChange={(e) => set("mobile", e.target.value)} placeholder="+352 621 000 000" />
              </Field>
              <Field label={s.landline}>
                <Input type="tel" value={form.landline} onChange={(e) => set("landline", e.target.value)} />
              </Field>
            </div>
            <Field label={s.otherContact}>
              <Input value={form.otherContact} onChange={(e) => set("otherContact", e.target.value)} />
            </Field>
          </>
        )}

        {step === "address" && (
          <>
            <div className="grid grid-cols-[1fr_5.5rem] gap-4">
              <Field label={s.street}>
                <Input value={form.street} onChange={(e) => set("street", e.target.value)} autoFocus />
              </Field>
              <Field label={s.number}>
                <Input value={form.number} onChange={(e) => set("number", e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-[7rem_1fr] gap-4">
              <Field label={s.postal}>
                <Input value={form.postal} onChange={(e) => set("postal", e.target.value)} />
              </Field>
              <Field label={s.city}>
                <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
            </div>
            <Field label={s.country}>
              <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
            </Field>
          </>
        )}

        {step === "account" && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={s.password}>
                <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} autoFocus />
              </Field>
              <Field label={s.passwordConfirm}>
                <Input type="password" value={form.passwordConfirm} onChange={(e) => set("passwordConfirm", e.target.value)} />
              </Field>
            </div>
            <label className="flex items-start gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.consent}
                onChange={(e) => set("consent", e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>{s.consent}</span>
            </label>
          </>
        )}

        {step === "review" && (
          <div className="space-y-3 text-sm">
            <p className="text-ink-soft">{s.reviewIntro}</p>
            <ReviewBlock title={s.obStepIdentity}>
              {form.firstName} {form.lastName} · {docTypeLabel} {form.docNumber}
            </ReviewBlock>
            <ReviewBlock title={s.obStepContact}>
              {form.email} · {form.mobile}
              {form.landline && ` · ${form.landline}`}
              {form.otherContact && ` · ${form.otherContact}`}
            </ReviewBlock>
            <ReviewBlock title={s.obStepAddress}>
              {form.number}, {form.street}, {form.postal} {form.city}, {form.country}
            </ReviewBlock>
          </div>
        )}
      </div>

      {error && <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">{error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)])}
          disabled={stepIndex === 0}
        >
          {s.back}
        </Button>
        <Button onClick={next}>{step === "review" ? s.submit : s.next}</Button>
      </div>
    </Card>
  );
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</p>
      <p className="mt-0.5 font-medium text-ink">{children}</p>
    </div>
  );
}

/* ─── The portal itself ───────────────────────────────────────────────────── */

function PortalHome({
  locale,
  strings: s,
  demoLabel,
  account,
  bundle,
  org,
  onSignOut,
}: {
  locale: Locale;
  strings: PortalStrings;
  demoLabel: string;
  account: TenantAccount;
  bundle: PortalBundle;
  org: PortalOrg;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("home");
  const [notice, setNotice] = useState<string | null>(null);

  const toast = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 4500);
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "home", label: s.tabHome },
    { id: "docs", label: s.tabDocs },
    { id: "payments", label: s.tabPayments },
    { id: "requests", label: s.tabRequests },
    { id: "profile", label: s.tabProfile },
  ];

  return (
    <div className="min-h-dvh bg-sand-50 pb-16">
      <header className="border-b border-sand-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-lg font-bold tracking-tight text-ink">
              Morada <span className="text-brand-600">Gestion</span>
            </p>
            <div className="flex items-center gap-3">
              <Badge className="bg-accent-100 text-accent-800">{demoLabel}</Badge>
              <button
                type="button"
                onClick={onSignOut}
                className="text-sm font-semibold text-ink-soft hover:text-ink hover:underline"
              >
                {s.signOut}
              </button>
            </div>
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-ink">
            {fmt(s.hello, { name: account.firstName })}
          </h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            {fmt(s.yourUnit, { unit: `${bundle.unitLabel} · ${bundle.propertyName}` })}
          </p>
          <nav className="mt-4 flex gap-1 overflow-x-auto" aria-label={s.landingTitle}>
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={
                  "whitespace-nowrap rounded-t-xl px-3.5 py-2 text-sm font-semibold transition " +
                  (tab === t.id
                    ? "border-b-2 border-brand-600 text-brand-700"
                    : "text-ink-soft hover:text-ink")
                }
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pt-5">
        {notice && (
          <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</p>
        )}

        {tab === "home" && <HomeTab locale={locale} s={s} bundle={bundle} org={org} />}
        {tab === "docs" && <DocsTab locale={locale} s={s} bundle={bundle} onDemo={() => toast(s.docsDemo)} />}
        {tab === "payments" && <PaymentsTab locale={locale} s={s} bundle={bundle} toast={toast} />}
        {tab === "requests" && <RequestsTab locale={locale} s={s} bundle={bundle} toast={toast} />}
        {tab === "profile" && <ProfileTab locale={locale} s={s} account={account} />}
      </main>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

function HomeTab({ locale, s, bundle, org }: { locale: Locale; s: PortalStrings; bundle: PortalBundle; org: PortalOrg }) {
  const total = bundle.rentCents + bundle.chargesCents;
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <SectionCard title={s.homeLease}>
        <ul className="space-y-2.5 text-sm">
          <li className="flex justify-between gap-3">
            <span className="text-ink-soft">{s.homeRent}</span>
            <span className="font-semibold tabular-nums text-ink">{euros(bundle.rentCents, locale)}</span>
          </li>
          <li className="flex justify-between gap-3">
            <span className="text-ink-soft">{fmt(s.homeCharges, { regime: bundle.chargesRegimeLabel })}</span>
            <span className="font-semibold tabular-nums text-ink">{euros(bundle.chargesCents, locale)}</span>
          </li>
          <li className="flex justify-between gap-3 border-t border-sand-100 pt-2.5">
            <span className="font-semibold text-ink">{s.homeTotal}</span>
            <span className="font-display font-bold tabular-nums text-ink">{euros(total, locale)}</span>
          </li>
          <li className="flex justify-between gap-3">
            <span className="text-ink-soft">{s.homeDeposit}</span>
            <span className="font-semibold text-ink">
              {fmt(s.homeDepositValue, { months: bundle.depositMonths, form: bundle.depositFormLabel })}
            </span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-ink-soft">{fmt(s.homeSince, { date: formatDate(bundle.startDate, locale) })}</p>
      </SectionCard>

      <div className="flex flex-col gap-5">
        <SectionCard title={s.homeAddressTitle}>
          <p className="text-sm font-semibold text-ink">{bundle.propertyName}</p>
          <p className="text-sm text-ink-soft">{bundle.address}</p>
        </SectionCard>

        <SectionCard title={s.homeManager}>
          <p className="text-sm font-semibold text-ink">{org.managerName}</p>
          <p className="text-sm text-ink-soft">{org.name}</p>
          <a href={`mailto:${org.email}`} className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline">
            {s.homeManagerWrite}
          </a>
        </SectionCard>

        <SectionCard title={s.homeEmergency}>
          <p className="text-sm text-ink-soft">{s.homeEmergencyBody}</p>
        </SectionCard>
      </div>
    </div>
  );
}

function DocsTab({
  locale,
  s,
  bundle,
  onDemo,
}: {
  locale: Locale;
  s: PortalStrings;
  bundle: PortalBundle;
  onDemo: () => void;
}) {
  return (
    <SectionCard title={s.docsTitle}>
      <p className="-mt-1 mb-3 text-sm text-ink-soft">{s.docsSub}</p>
      <ul className="divide-y divide-sand-100">
        {bundle.documents.map((doc) => (
          <li key={doc.name} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{doc.name}</p>
              <p className="text-xs text-ink-soft">
                {formatDate(doc.createdAt, locale)} · {Math.round(doc.sizeKb)} kB
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={onDemo}>
              {s.docsDownload}
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function PaymentsTab({
  locale,
  s,
  bundle,
  toast,
}: {
  locale: Locale;
  s: PortalStrings;
  bundle: PortalBundle;
  toast: (text: string) => void;
}) {
  // An open balance (late/partial/pending) outranks the next future instalment.
  const next =
    bundle.periods.find((p) => p.status === "late" || p.status === "partial" || p.status === "pending") ??
    bundle.periods.find((p) => p.status === "upcoming");
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <h2 className="font-display text-lg font-bold text-ink">{s.payTitle}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm">
            <thead>
              <tr className="border-b border-sand-200 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                <th className="py-2 pr-3">{s.payColMonth}</th>
                <th className="py-2 pr-3">{s.payColDue}</th>
                <th className="py-2 pr-3 text-right">{s.payColAmount}</th>
                <th className="py-2 pr-3">{s.payColStatus}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {[...bundle.periods].reverse().map((p) => (
                <tr key={p.period} className="border-b border-sand-100 last:border-b-0">
                  <td className="py-2.5 pr-3 font-semibold text-ink">{formatMonth(p.period, locale)}</td>
                  <td className="py-2.5 pr-3 text-ink-soft">{formatDate(p.dueDate, locale)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums font-semibold text-ink">
                    {euros(p.totalCents, locale)}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge className={p.statusColor}>{p.statusLabel}</Badge>
                  </td>
                  <td className="py-2.5 text-right">
                    {p.status === "paid" && (
                      <button
                        type="button"
                        onClick={() => toast(fmt(s.payReceiptDemo, { month: formatMonth(p.period, locale) }))}
                        className="text-xs font-semibold text-brand-700 hover:underline"
                      >
                        {s.payReceipt}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex flex-col gap-5">
        {next && (
          <SectionCard title={s.payNextDue}>
            <p className="font-display text-2xl font-bold tabular-nums text-ink">{euros(next.totalCents, locale)}</p>
            <p className="mt-0.5 text-sm text-ink-soft">
              {formatMonth(next.period, locale)} · {formatDate(next.dueDate, locale)}
            </p>
          </SectionCard>
        )}
        <SectionCard title={s.payRef}>
          <code className="block rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-sm font-semibold text-ink">
            {bundle.rfRef}
          </code>
          <p className="mt-2 text-xs text-ink-soft">{s.payRefNote}</p>
        </SectionCard>
      </div>
    </div>
  );
}

function RequestsTab({
  locale,
  s,
  bundle,
  toast,
}: {
  locale: Locale;
  s: PortalStrings;
  bundle: PortalBundle;
  toast: (text: string) => void;
}) {
  const [stored, setStored] = useState<StoredRequest[]>([]);
  const [draftKind, setDraftKind] = useState<"tech" | "admin" | null>(null);
  const [category, setCategory] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [description, setDescription] = useState("");

  useEffect(() => {
    setStored(readJson<StoredRequest[]>(REQUESTS_KEY, []).filter((r) => r.leaseId === bundle.leaseId));
  }, [bundle.leaseId]);

  const techCategories = [
    ["plumbing", s.catPlumbing],
    ["heating", s.catHeating],
    ["electric", s.catElectric],
    ["locks", s.catLocks],
    ["appliance", s.catAppliance],
    ["other_tech", s.catOtherTech],
  ] as const;
  const adminCategories = [
    ["certificate", s.catCertificate],
    ["lease_copy", s.catLeaseCopy],
    ["charges", s.catCharges],
    ["insurance", s.catInsurance],
    ["other_admin", s.catOtherAdmin],
  ] as const;
  const categories = draftKind === "tech" ? techCategories : adminCategories;
  const categoryLabel = (r: StoredRequest) =>
    [...techCategories, ...adminCategories].find(([key]) => key === r.category)?.[1] ?? r.category;

  const openDraft = (kind: "tech" | "admin") => {
    setDraftKind(kind);
    setCategory(kind === "tech" ? "plumbing" : "certificate");
    setUrgency("normal");
    setDescription("");
  };

  const submit = () => {
    if (!draftKind || !description.trim()) return;
    const all = readJson<StoredRequest[]>(REQUESTS_KEY, []);
    const req: StoredRequest = {
      id: `req-${Date.now()}`,
      leaseId: bundle.leaseId,
      kind: draftKind,
      category,
      urgency: draftKind === "tech" ? urgency : "",
      description: description.trim(),
      createdAt: new Date().toISOString().slice(0, 10),
    };
    writeJson(REQUESTS_KEY, [req, ...all]);
    setStored((prev) => [req, ...prev]);
    toast(draftKind === "tech" ? s.reqSentTech : s.reqSentAdmin);
    setDraftKind(null);
  };

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <h2 className="font-display text-lg font-bold text-ink">{s.reqTitle}</h2>
        {stored.length === 0 && bundle.requests.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">{s.reqEmpty}</p>
        ) : (
          <ul className="mt-2 divide-y divide-sand-100">
            {stored.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">
                    {r.kind === "tech" ? s.reqNewTech : s.reqNewAdmin} · {categoryLabel(r)}
                  </p>
                  <Badge className="bg-amber-100 text-amber-800">{s.reqStatusSent}</Badge>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">{r.description}</p>
                <p className="mt-0.5 text-xs text-ink-soft">{formatDate(r.createdAt, locale)}</p>
              </li>
            ))}
            {bundle.requests.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">
                    {r.ref} · {r.title}
                  </p>
                  <Badge className={r.statusColor}>{r.statusLabel}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">{formatDate(r.createdAt, locale)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        {draftKind === null ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => openDraft("tech")}
              className="block w-full rounded-xl border border-sand-200 bg-white p-4 text-left transition hover:border-brand-300"
            >
              <p className="text-sm font-bold text-ink">{s.reqNewTech}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{s.reqNewTechSub}</p>
            </button>
            <button
              type="button"
              onClick={() => openDraft("admin")}
              className="block w-full rounded-xl border border-sand-200 bg-white p-4 text-left transition hover:border-brand-300"
            >
              <p className="text-sm font-bold text-ink">{s.reqNewAdmin}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{s.reqNewAdminSub}</p>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="font-display text-base font-bold text-ink">
              {draftKind === "tech" ? s.reqNewTech : s.reqNewAdmin}
            </h3>
            <Field label={s.reqCategory}>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            {draftKind === "tech" && (
              <Field label={s.reqUrgency}>
                <Select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                  <option value="low">{s.urgLow}</option>
                  <option value="normal">{s.urgNormal}</option>
                  <option value="high">{s.urgHigh}</option>
                </Select>
              </Field>
            )}
            <Field label={s.reqDescription}>
              <Textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={s.reqDescriptionHint}
              />
            </Field>
            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setDraftKind(null)}>
                {s.reqCancel}
              </Button>
              <Button onClick={submit} disabled={!description.trim()}>
                {s.reqSubmit}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function ProfileTab({ locale, s, account }: { locale: Locale; s: PortalStrings; account: TenantAccount }) {
  const docTypeLabel = account.docType === "passport" ? s.docTypePassport : s.docTypeId;
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <SectionCard title={s.profIdentity}>
        <p className="text-sm font-semibold text-ink">
          {account.firstName} {account.lastName}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {s.profDocLabel}: {docTypeLabel} · {account.docNumber}
        </p>
        <p className="mt-3 text-xs text-ink-soft">{fmt(s.profCreated, { date: formatDate(account.createdAt, locale) })}</p>
      </SectionCard>
      <SectionCard title={s.profContact}>
        <ul className="space-y-1.5 text-sm text-ink">
          <li className="font-semibold">{account.email}</li>
          <li>{account.mobile}</li>
          {account.landline && <li>{account.landline}</li>}
          {account.otherContact && <li className="text-ink-soft">{account.otherContact}</li>}
        </ul>
      </SectionCard>
      <SectionCard title={s.profAddress}>
        <p className="text-sm text-ink">
          {account.number}, {account.street}
          <br />
          {account.postal} {account.city}, {account.country}
        </p>
      </SectionCard>
    </div>
  );
}

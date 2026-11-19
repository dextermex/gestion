import { PageHeader } from "@/components/pro/ui";
import { Panel } from "@/components/gestion/bits";
import AccountDeletion from "@/components/gestion/AccountDeletion";
import TenantProfileForm from "@/components/gestion/TenantProfileForm";
import { TEAM_EMAIL } from "@/lib/constants";
import { getDemo, isSampleData } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { LOCALE_LABELS, fmt } from "@/lib/i18n/config";
import { authedClient, getSession } from "@/lib/supabase/server";
import { formatDate } from "@/lib/types";
import { getIdentity } from "@/lib/workspace";

/**
 * "Mon compte": the person behind the session, whatever space they work in.
 *
 * What they signed up with (name, e-mail, mobile), each changed the way
 * sign-up confirmed it; what the account system holds about the account
 * itself; and their rights over their data, the request to delete the
 * account among them. Everything is read under the person's own token.
 * The request to delete is recorded here and completed by the team: this
 * application holds no key that could erase an account.
 */
export default async function ComptePage() {
  const { locale, d } = await getI18n();
  const session = await getSession();
  if (!session) return null;
  const sample = await isSampleData();
  const identity = await getIdentity();
  const db = authedClient(session.accessToken);
  const [profile, auth] = await Promise.all([
    db.from("profiles").select("first_name,last_name").eq("id", session.userId).maybeSingle(),
    db.auth.getUser(session.accessToken),
  ]);
  const user = auth.data.user;
  const meta = session.metadata ?? {};
  const account = {
    firstName: String(profile.data?.first_name ?? meta.first_name ?? "").trim(),
    lastName: String(profile.data?.last_name ?? meta.last_name ?? "").trim(),
    email: user?.email ?? session.email,
    phone: user?.phone ? `+${user.phone.replace(/^\+/, "")}` : null,
  };
  const requestedAt = (meta.morada_account as { deletion_requested_at?: unknown } | undefined)?.deletion_requested_at;
  const requested = typeof requestedAt === "string" && requestedAt !== "";
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: (await getDemo()).ORG.shortName }) : null;
  const a = d.account;
  const [dataBefore = "", dataAfter = ""] = a.dataBody.split("{email}");
  const t = d.tenant;

  const rows: Array<[string, string]> = [
    ...(user?.created_at ? [[a.created, formatDate(user.created_at.slice(0, 10), locale)] as [string, string]] : []),
    [a.signIn, [account.email ? a.signInEmail : "", account.phone ? a.signInSms : ""].filter(Boolean).join(" · ") || d.common.none],
    [a.language, LOCALE_LABELS[locale]],
    ...(identity?.active?.name ? [[a.workspace, identity.active.name] as [string, string]] : []),
  ];

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title={a.title} subtitle={a.subtitle} />

      <Panel title={a.detailsTitle}>
        <TenantProfileForm
          account={account}
          canNotify={false}
          sampleNote={sampleNote}
          endpoint="/api/compte"
          labels={{
            firstName: t.firstName,
            lastName: t.lastName,
            nameRequired: t.nameRequired,
            save: t.save,
            saved: t.saved,
            saveFailed: t.saveFailed,
            notify: "",
            edit: t.edit,
            cancel: t.cancel,
            codeInvalid: t.codeInvalid,
            phoneLabel: t.phoneLabel,
            phoneHint: t.phoneHint,
            phoneNone: t.phoneNone,
            phoneNew: t.phoneNew,
            phoneSend: t.phoneSend,
            phoneCodeSent: t.phoneCodeSent,
            phoneCode: t.phoneCode,
            phoneVerify: t.phoneVerify,
            phoneInvalid: t.phoneInvalid,
            phoneFailed: t.phoneFailed,
            phoneCodeWrong: t.phoneCodeWrong,
            phoneChanged: t.phoneChanged,
            emailLabel: t.emailLabel,
            emailHint: t.emailHint,
            emailNew: t.emailNew,
            emailSend: t.emailSend,
            emailCodeSent: t.emailPending,
            emailCode: t.emailCode,
            emailInvalid: t.emailInvalid,
            emailExists: t.emailExists,
            emailRate: t.emailRate,
            emailFailed: t.emailFailed,
            emailChanged: t.emailChanged,
          }}
        />
      </Panel>

      <Panel title={a.aboutTitle}>
        <dl className="divide-y divide-sand-200/70">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <dt className="text-sm text-ink-soft">{label}</dt>
              <dd className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel title={a.dataTitle}>
        <p className="text-sm leading-relaxed text-ink-soft">
          {dataBefore}
          <a href={`mailto:${TEAM_EMAIL}`} className="font-semibold text-brand-700 hover:underline">{TEAM_EMAIL}</a>
          {dataAfter}
        </p>
      </Panel>

      <Panel title={a.deleteTitle}>
        <AccountDeletion
          requested={requested}
          labels={{
            body: a.deleteBody,
            action: a.deleteAction,
            confirmTitle: a.deleteConfirmTitle,
            confirmBody: a.deleteConfirmBody,
            confirm: a.deleteConfirm,
            cancel: d.common.cancel,
            pending: requested ? fmt(a.deletePending, { date: formatDate(String(requestedAt).slice(0, 10), locale) }) : "",
            restore: a.deleteRestore,
            failed: a.deleteFailed,
            sampleNote,
          }}
        />
      </Panel>
    </div>
  );
}

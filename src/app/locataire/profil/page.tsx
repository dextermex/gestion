import Link from "next/link";
import { Icon } from "@/components/pro/icons";
import { Badge, Card } from "@/components/pro/ui";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import TenantProfileForm from "@/components/gestion/TenantProfileForm";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { getTenantAccount } from "@/lib/portal/account";
import { getTenantView } from "@/lib/portal/space";
import { formatDate } from "@/lib/types";

/**
 * "Mon profil": two cards that must not be confused. The first is the
 * tenant's own (their name, the e-mail and mobile they sign in with), and
 * they may change it. The second is what the lease and the landlord's file
 * say (who is on the lease, the home, the dates, who manages it): read
 * only, drawn apart on a sand ground with a lock, with the way to ask for
 * a correction. Changing the first never rewrites the second.
 */
export default async function TenantProfilePage() {
  const { locale, d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const { space, sample } = view;
  const account = await getTenantAccount(space.me.name);
  if (!account) return <TenantEmpty d={d} manage={view.canManage} />;
  const lease = space.current ?? space.past[0] ?? null;
  const ended = space.current === null;
  const managers = space.managers.map((m) => m.name).filter(Boolean).join(" · ");
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: (await getDemo()).ORG.shortName }) : null;
  const t = d.tenant;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{t.profileTitle}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t.profileSub}</p>
        {/* On a phone the account row of "Plus" lands here: the settings are one tap further. */}
        <Link href="/locataire/parametres" className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-700 hover:underline lg:hidden">
          <Icon name="settings" size={18} className="shrink-0" />
          {t.navSettings}
        </Link>
      </div>

      <Card className="crm-panel p-5" data-profile-mine>
        <div className="crm-panel-heading mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-ink">{t.mineTitle}</h2>
          <Badge className="bg-brand-100 text-brand-800">{t.mineBadge}</Badge>
        </div>
        <TenantProfileForm
          account={account}
          canNotify={!ended && lease !== null}
          sampleNote={sampleNote}
          labels={{
            firstName: t.firstName,
            lastName: t.lastName,
            nameRequired: t.nameRequired,
            save: t.save,
            saved: t.saved,
            saveFailed: t.saveFailed,
            notify: fmt(t.notifyManager, { manager: managers || t.managerTitle }),
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
      </Card>

      {lease && (
        <Card className="crm-panel tenant-file-card p-5" data-profile-file>
          <div className="crm-panel-heading mb-2 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-ink">{t.fileTitle}</h2>
            <Badge className="bg-sand-100 text-ink-soft">
              <Icon name="lock" size={13} className="shrink-0" />
              {t.fileBadge}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-ink-soft">{managers ? fmt(t.fileIntro, { manager: managers }) : t.fileIntroNoManager}</p>
          <dl className="mt-3 divide-y divide-sand-200/70">
            {(
              [
                [lease.parties.filter((p) => p.name).length > 1 ? t.fileTenants : t.fileTenant, lease.parties.map((p) => p.name).filter(Boolean).join(", ") || d.common.none],
                [t.fileHome, [`${lease.unit.label} · ${lease.property.name}`, lease.property.address].filter(Boolean).join(", ")],
                [t.fileLease, `${fmt(t.fileLeaseSince, { from: formatDate(lease.startDate, locale) })} · ${lease.endDate ? fmt(t.until, { date: formatDate(lease.endDate, locale) }) : t.fileLeaseOpen}`],
                ...(space.managers.length > 0 ? [[t.fileManager, space.managers.map((m) => [m.name, m.email].filter(Boolean).join(" · ")).join(", ")] as [string, string]] : []),
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div key={label} className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
                <dt className="text-sm text-ink-soft">{label}</dt>
                <dd className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
          {!ended && (
            <Link
              href="/locataire/demandes?nouvelle=correction"
              className="tactile mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-sand-200 bg-white px-3.5 text-sm font-semibold text-brand-700 transition hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <Icon name="documents" size={18} className="shrink-0" />
              {t.askCorrection}
            </Link>
          )}
        </Card>
      )}
    </div>
  );
}

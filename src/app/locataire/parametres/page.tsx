import Link from "next/link";
import { Icon, type IconName } from "@/components/pro/icons";
import { Badge } from "@/components/pro/ui";
import { Panel } from "@/components/gestion/bits";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import { TenantLanguage, TenantSignOutAll } from "@/components/gestion/TenantSettings";
import { getI18n } from "@/lib/i18n";
import { getTenantAccount } from "@/lib/portal/account";
import { getTenantView } from "@/lib/portal/space";
import { getSession } from "@/lib/supabase/server";

/**
 * "Paramètres": the language of the space, how the account signs in (the
 * e-mail, the mobile for the SMS code; both are changed from the profile),
 * and ending the session on every device. No password is managed here: a
 * forgotten one is reset from the sign-in page, by the link it e-mails.
 * What does not exist yet (a copy of one's data, deleting the account) is
 * said plainly, with who to write to.
 */
export default async function TenantSettingsPage() {
  const { locale, d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const account = await getTenantAccount(view.space.me.name);
  if (!account) return <TenantEmpty d={d} manage={view.canManage} />;
  const session = await getSession();
  const t = d.tenant;

  const row = (icon: IconName, title: string, value: string, right: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 py-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-ink-soft [overflow-wrap:anywhere]">{value}</p>
      </div>
      {right}
    </div>
  );

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{t.settingsTitle}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t.settingsSub}</p>
      </div>

      <Panel title={t.langTitle}>
        <TenantLanguage locale={locale} label={t.langTitle} sample={view.sample} />
        <p className="mt-2 text-xs text-ink-soft">{t.langHint}</p>
      </Panel>

      <Panel title={t.signInTitle}>
        <div className="divide-y divide-sand-100">
          {row(
            "mail",
            t.signInEmail,
            account.email || t.signInNone,
            <Link href="/locataire/profil" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
              {t.edit}
            </Link>,
          )}
          {row("phone", t.signInSms, account.phone ?? t.signInNone, account.phone ? <Badge className="bg-emerald-100 text-emerald-800">{t.signInSmsOn}</Badge> : null)}
          {row("devices", t.devicesTitle, t.devicesBody, <TenantSignOutAll label={t.devicesAction} signedIn={Boolean(session)} sampleNotice={d.common.demoNotice} />)}
        </div>
      </Panel>

      <Panel title={t.dataTitle}>
        <p className="text-sm leading-relaxed text-ink-soft">{t.dataBody}</p>
      </Panel>
    </div>
  );
}

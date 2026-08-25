import TenantOnboarding from "@/components/gestion/TenantOnboarding";
import { getDemo } from "@/lib/demo";
import { tenantPersona } from "@/lib/demo/tenant";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import { getI18n } from "@/lib/i18n";

export default async function TenantOnboardingPage() {
  const { d } = await getI18n();
  const demo = await getDemo();
  const persona = tenantPersona(demo);
  if (!persona) return <TenantEmpty d={d} />;
  const { unitLabel } = persona;
  return <TenantOnboarding d={d} orgName={demo.ORG.shortName} unitLabel={unitLabel} />;
}

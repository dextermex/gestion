import TenantOnboarding from "@/components/gestion/TenantOnboarding";
import { getDemo } from "@/lib/demo";
import { tenantPersona } from "@/lib/demo/tenant";
import { getI18n } from "@/lib/i18n";

export default async function TenantOnboardingPage() {
  const { d } = await getI18n();
  const demo = await getDemo();
  const { unitLabel } = tenantPersona(demo);
  return <TenantOnboarding d={d} orgName={demo.ORG.shortName} unitLabel={unitLabel} />;
}

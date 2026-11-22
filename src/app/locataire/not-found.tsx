import RouteNotFound from "@/components/RouteNotFound";
import { getI18n } from "@/lib/i18n";

/** A request that no longer exists, or an address the tenant space does not have: said inside the space, with the way home. */
export default async function TenantNotFound() {
  const { d } = await getI18n();
  return (
    <RouteNotFound
      title={d.errors.notFoundTitle}
      body={d.errors.notFoundBody}
      links={[
        { href: "/locataire", label: d.errors.toTenantHome },
        { href: "/locataire/demandes", label: d.tenant.navRequests },
      ]}
    />
  );
}

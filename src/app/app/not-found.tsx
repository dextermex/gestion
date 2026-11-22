import RouteNotFound from "@/components/RouteNotFound";
import { getI18n } from "@/lib/i18n";

/**
 * A record that no longer exists (or belongs to another workspace), or an
 * address the management space does not have: said inside the shell, so the
 * rail stays and the way back is one click.
 */
export default async function AppNotFound() {
  const { d } = await getI18n();
  return (
    <RouteNotFound
      title={d.errors.notFoundTitle}
      body={d.errors.notFoundBody}
      links={[
        { href: "/app", label: d.errors.toHome },
        { href: "/app/biens", label: d.hubs.portfolio },
      ]}
    />
  );
}

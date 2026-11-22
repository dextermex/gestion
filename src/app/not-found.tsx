import RouteNotFound from "@/components/RouteNotFound";
import { getI18n } from "@/lib/i18n";

/**
 * An address nothing answers, outside the two spaces: said in the person's
 * language, with the two doors. "/" routes by session (the management space
 * when signed in, the sign-in screen otherwise).
 */
export default async function NotFound() {
  const { d } = await getI18n();
  return (
    <main className="px-safe-4 pb-12">
      <RouteNotFound
        standalone
        title={d.errors.notFoundTitle}
        body={d.errors.notFoundBody}
        links={[
          { href: "/", label: d.errors.toSpace },
          { href: "/connexion", label: d.errors.toSignIn },
        ]}
      />
    </main>
  );
}

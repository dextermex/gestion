import RouteNotFound from "@/components/RouteNotFound";
import { TEAM_EMAIL } from "@/lib/constants";
import { getI18n } from "@/lib/i18n";

/**
 * Where a link to a file lands when the file could not be handed over: the
 * piece is gone, the account may not read it, or the storage did not answer.
 * The handlers behind those links answer a script with a JSON error; a
 * person who clicked is sent here instead (src/lib/http/navigation.ts), so
 * the reason is said in the app, inside the shell, with the way back to the
 * screen the link was on.
 */
export default async function FileUnavailablePage({ searchParams }: { searchParams: Promise<{ raison?: string; retour?: string }> }) {
  const { raison, retour } = await searchParams;
  const { d } = await getI18n();
  const body = raison === "absent" ? d.errors.fileAbsent : raison === "refuse" ? d.errors.fileRefused : d.errors.fileFailed;
  // Only an internal address is honoured: a return address is a link, and a link that trusts a query string could lead anywhere.
  const back = retour && (retour === "/app" || retour.startsWith("/app/")) ? retour : null;
  return (
    <RouteNotFound
      title={d.errors.fileTitle}
      body={body}
      links={[
        ...(back ? [{ href: back, label: d.errors.fileBack }] : []),
        { href: "/app/documents", label: d.nav.documents },
        ...(raison === "absent" || raison === "refuse" ? [] : [{ href: `mailto:${TEAM_EMAIL}`, label: TEAM_EMAIL }]),
      ]}
    />
  );
}

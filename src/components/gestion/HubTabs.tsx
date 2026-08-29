import Link from "next/link";
import type { Dict } from "@/lib/i18n/fr";

/**
 * The hub map — the single description of which pages share a section.
 *
 * The sidebar names the main sections and nothing else; this row names the
 * sub-sections inside each one. URLs never changed, so every old bookmark
 * still lands, it just lands inside its section.
 */

export type HubId =
  | "patrimoine"
  | "relations"
  | "finances"
  | "locative"
  | "documents"
  | "conformite"
  | "reglages";

export interface HubTab {
  href: string;
  label: string;
}

export function hubTabs(d: Dict, workspaceKind?: string): Record<HubId, { label: string; tabs: HubTab[] }> {
  // AML/KYC is a cabinet obligation: on an owner-kind workspace the tab
  // simply does not exist — same product, two densities, zero configuration.
  const cabinet = workspaceKind !== "owner";
  return {
    patrimoine: {
      label: d.nav.patrimoine,
      tabs: [
        { href: "/app/biens", label: d.hubs.portfolio },
        { href: "/app/baux", label: d.hubs.leases },
        { href: "/app/compteurs", label: d.hubs.meters },
        { href: "/app/charges", label: d.hubs.statements },
      ],
    },
    relations: {
      label: d.nav.relations,
      tabs: [
        { href: "/app/contacts", label: d.hubs.people },
        { href: "/app/messages", label: d.hubs.messages },
      ],
    },
    finances: {
      label: d.nav.finances,
      tabs: [
        { href: "/app/loyers", label: d.hubs.collections },
        { href: "/app/banque", label: d.hubs.banking },
        { href: "/app/finance", label: d.hubs.expenses },
      ],
    },
    locative: {
      label: d.nav.locative,
      tabs: [
        { href: "/app/garanties", label: d.hubs.deposits },
        { href: "/app/indexation", label: d.hubs.indexation },
      ],
    },
    documents: {
      label: d.nav.documents,
      tabs: [
        { href: "/app/documents", label: d.hubs.library },
        { href: "/app/contrats", label: d.hubs.contracts },
      ],
    },
    conformite: {
      label: d.nav.compliance,
      tabs: [
        { href: "/app/conformite", label: d.hubs.calendar },
        ...(cabinet ? [{ href: "/app/aml", label: d.hubs.aml }] : []),
        { href: "/app/fiscalite", label: d.hubs.reports },
      ],
    },
    reglages: {
      label: d.nav.settings,
      tabs: [{ href: "/app/reglages", label: d.hubs.general }],
    },
  };
}

/** The section's tab row: underline tabs in the house style, scrollable on
 *  small screens. `active` is the page's own path — detail pages inside a
 *  section (a lease, a property) don't render the row at all. */
export default function HubTabs({
  d,
  hub,
  active,
  workspaceKind,
}: {
  d: Dict;
  hub: HubId;
  active: string;
  workspaceKind?: string;
}) {
  const { label, tabs } = hubTabs(d, workspaceKind)[hub];
  // A section with a single page needs no tab row.
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className="no-scrollbar mb-5 flex gap-0.5 overflow-x-auto border-b border-sand-200">
      {tabs.map((t) => {
        const current = t.href === active;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={
              "tactile -mb-px inline-flex items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 max-sm:min-h-11 " +
              (current
                ? "border-brand-600 font-semibold text-brand-800"
                : "border-transparent font-medium text-ink-soft hover:border-sand-300 hover:text-ink")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";

/**
 * How the register is narrowed: a shelf and the words of a search, both
 * carried by the address so a real account's page is filtered on the
 * server and a filtered view can be linked to. The search goes on Enter;
 * the shelf goes at once.
 */
export interface FilterLabels {
  search: string;
  group: string;
  all: string;
  reset: string;
  groups: Array<{ value: string; label: string }>;
}

export default function DocumentFilters({ group, q, purge, labels }: { group: string; q: string; purge: boolean; labels: FilterLabels }) {
  const router = useRouter();
  const [text, setText] = useState(q);

  const go = (next: { group?: string; q?: string }) => {
    const params = new URLSearchParams();
    const shelf = next.group ?? group;
    const words = (next.q ?? text).trim();
    if (shelf) params.set("groupe", shelf);
    if (words) params.set("q", words);
    if (purge) params.set("vue", "purge");
    const qs = params.toString();
    router.push(`/app/documents${qs ? `?${qs}` : ""}`);
  };
  const filtering = group !== "" || q !== "" || purge;

  return (
    <form
      className="crm-filters"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go({});
      }}
    >
      <div className="crm-filters-search">
        <Icon name="search" size={16} />
        <input
          type="search"
          name="q"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={labels.search}
          aria-label={labels.search}
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="ui-field crm-filter w-full rounded-full border border-sand-300 bg-white py-2 pl-10 pr-4 text-sm text-ink placeholder:text-ink-soft max-sm:min-h-11 max-sm:text-base focus:outline-none"
        />
      </div>
      <Select value={group} onChange={(e) => go({ group: e.target.value })} aria-label={labels.group} className="crm-filter crm-filters-select">
        <option value="">{labels.all}</option>
        {labels.groups.map((g) => (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ))}
      </Select>
      {filtering && (
        <button
          type="button"
          onClick={() => {
            setText("");
            router.push("/app/documents");
          }}
          className="inline-flex min-h-10 items-center text-sm font-semibold text-brand-700 hover:underline"
        >
          {labels.reset}
        </button>
      )}
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/pro/ui";

/**
 * A choice kept in the address: picking an option goes to that option's own
 * address, so the page is read again for it on the server and the view can
 * be linked to. The options carry their addresses; nothing is computed here.
 */
export default function QuerySelect({ label, value, options, className }: { label: string; value: string; options: Array<{ value: string; label: string; href: string }>; className?: string }) {
  const router = useRouter();
  return (
    <Select
      aria-label={label}
      value={value}
      className={"crm-filter crm-filters-select " + (className ?? "")}
      onChange={(e) => {
        const next = options.find((o) => o.value === e.target.value);
        if (next) router.push(next.href, { scroll: false });
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

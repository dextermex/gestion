"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select } from "@/components/pro/ui";

/**
 * Which owner and which exercise the screen prepares: the owner from a
 * select (the address follows), the exercise from a segmented row of
 * links, so a prepared year can be linked to.
 */
export default function FiscalControls({
  owners,
  ownerId,
  years,
  taxYear,
  runningFrom,
  labels,
}: {
  owners: Array<{ id: string; name: string }>;
  ownerId: string;
  years: number[];
  taxYear: number;
  /** Years from this one on are the running exercise, provisional. */
  runningFrom: number;
  labels: { owner: string; year: string; running: string };
}) {
  const router = useRouter();
  const href = (owner: string, year: number) => `/app/fiscalite?proprietaire=${encodeURIComponent(owner)}&exercice=${year}`;
  return (
    <div className="crm-fiscal-controls">
      <Select value={ownerId} onChange={(e) => router.push(href(e.target.value, taxYear))} aria-label={labels.owner} className="crm-filter crm-fiscal-owner">
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      <nav className="crm-fiscal-years" aria-label={labels.year}>
        {years.map((y) => (
          <Link key={y} href={href(ownerId, y)} aria-current={y === taxYear ? "page" : undefined}>
            {y >= runningFrom ? labels.running.replace("{year}", String(y)) : String(y)}
          </Link>
        ))}
      </nav>
    </div>
  );
}

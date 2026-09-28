"use client";
import { useState } from "react";
import Loans from "./Loans";
import Acquisitions from "./Acquisitions";
import type { FinanceProperty, LoanRecord } from "@/lib/investment/loans";
import type { AcquisitionRecord } from "@/lib/investment/acquisition";
import type { Locale } from "@/lib/i18n/config";

/** Development-only interaction harness. No browser storage or network writes. */
export default function InvestmentPreview({locale, properties, section = "all"}: {locale: Locale; properties: FinanceProperty[]; section?: "all" | "loans" | "acquisitions"}) {
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [projects, setProjects] = useState<AcquisitionRecord[]>([]);
  return <div className="investment-workspace"><p role="note">Local preview. Changes last only until this page is refreshed.</p>
    {section !== "acquisitions" && <Loans locale={locale} properties={properties} records={loans} onSave={async (draft, id) => {const now = new Date().toISOString(); const row = {...draft, id: id ?? crypto.randomUUID(), createdAt: now, updatedAt: now}; setLoans((rows) => [...rows.filter((r) => r.id !== row.id), row]);}}/>}
    {section !== "loans" && <Acquisitions locale={locale} records={projects} onSave={async (draft, id) => {const now = new Date().toISOString();const row = {...draft, id: id ?? crypto.randomUUID(), createdAt: now, updatedAt: now}; setProjects((rows) => [...rows.filter((r) => r.id !== row.id), row]);}}/>}
  </div>;
}

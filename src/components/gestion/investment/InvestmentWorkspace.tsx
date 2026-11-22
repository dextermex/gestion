"use client";
import {useCallback,useEffect,useState} from "react";
import {Button} from "@/components/pro/ui";
import {ApiProblemNote,useApiProblems} from "@/components/gestion/ApiErrors";
import {ApiRefusal,type ApiProblem} from "@/lib/api-errors";
import Loans from "./Loans"; import Acquisitions from "./Acquisitions";
import type {Locale} from "@/lib/i18n/config"; import type {FinanceProperty,LoanRecord,LoanDraft} from "@/lib/investment/loans"; import type {AcquisitionRecord,AcquisitionDraft} from "@/lib/investment/acquisition";
/** Sample-cabinet labels, one stable object per locale so the load effect runs once. */
const COPY = {
  fr: { loading: "Chargement…", loan: "Crédit principal", acq: "Résidence à étudier", next: "Organiser la seconde visite", note: "Dossier exemple" },
  en: { loading: "Loading…", loan: "Primary mortgage", acq: "Property to review", next: "Arrange second viewing", note: "Sample dossier" },
  de: { loading: "Laden…", loan: "Hauptdarlehen", acq: "Zu prüfendes Objekt", next: "Zweite Besichtigung organisieren", note: "Beispieldossier" },
  lu: { loading: "Luet…", loan: "Haaptkredit", acq: "Projet ze préiwen", next: "Zweet Visitt organiséieren", note: "Beispill Dossier" },
} as const;
export default function InvestmentWorkspace({ locale, properties, section, datasetId }: { locale: Locale; properties: FinanceProperty[]; section: "loans" | "acquisitions"; datasetId: "real" | "fr" | "lu" }) {
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [acqs, setAcqs] = useState<AcquisitionRecord[]>([]);
  const [loading, setLoading] = useState(datasetId === "real");
  // A book that could not be read is said to be unread: it never shows as an empty one.
  const [loadProblem, setLoadProblem] = useState<ApiProblem | null>(null);
  const problems = useApiProblems();
  const copy = COPY[locale];

  const load = useCallback(async () => {
    setLoading(true);
    setLoadProblem(null);
    try {
      const [l, a] = await Promise.all([fetch("/api/gestion/investment/loans"), fetch("/api/gestion/investment/acquisitions")]);
      const refused = !l.ok ? l : !a.ok ? a : null;
      if (refused) {
        setLoadProblem(await problems.read(refused, { returnTo: section === "loans" ? "/app/emprunts" : "/app/acquisitions" }));
        return;
      }
      const [loanBook, acqBook] = (await Promise.all([l.json(), a.json()])) as [{ records?: LoanRecord[] }, { records?: AcquisitionRecord[] }];
      setLoans(loanBook.records ?? []);
      setAcqs(acqBook.records ?? []);
    } catch {
      setLoadProblem(problems.network());
    } finally {
      setLoading(false);
    }
  }, [problems, section]);

  useEffect(() => {
    if (datasetId !== "real") {
      setLoans([{ id: "sample-loan-1", propertyId: properties[0]?.id ?? "", unitId: null, name: copy.loan, bankName: "Spuerkeess", originalCents: 42000000, balanceCents: 28100000, balanceDate: "2026-08-23", annualRatePct: 2.45, rateType: "fixed", remainingMonths: 198, insuranceCents: 4200, nextPaymentDate: "2026-10-05", fixedUntil: "2031-10-05", notes: copy.note, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2026-08-23T00:00:00Z" }]);
      setAcqs([{ id: "sample-acq-1", name: copy.acq, address: "Bertrange, Luxembourg", stage: "viewing", askingPriceCents: 68500000, expectedRentCents: 320000, bankName: "", financingStatus: "research", notaryName: "", nextAction: copy.next, nextActionDate: "2026-10-08", viewingDate: "2026-10-08", compromisDate: null, financeDeadline: null, notaryAppointmentDate: null, deedSignedDate: null, transferDate: null, handoverDate: null, notes: copy.note, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-23T00:00:00Z" }]);
      setLoading(false);
      return;
    }
    void load();
  }, [datasetId, properties, copy, load]);

  /** One save for both books. A refusal travels as its reason, for the editor to show; what was typed stays there. */
  const save = async <R extends { id: string; updatedAt: string }>(kind: "loans" | "acquisitions", draft: unknown, old: R | undefined, id: string | undefined): Promise<R> => {
    let res: Response;
    try {
      res = await fetch(`/api/gestion/investment/${kind}${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(id ? { draft, expectedUpdatedAt: old?.updatedAt } : draft),
      });
    } catch {
      throw new ApiRefusal(problems.network());
    }
    if (!res.ok) throw new ApiRefusal(await problems.read(res, { keepsInput: true }));
    return ((await res.json()) as { record: R }).record;
  };
  const saveLoan = async (d: LoanDraft, id?: string) => {
    const x = await save<LoanRecord>("loans", d, loans.find((q) => q.id === id), id);
    setLoans((v) => [...v.filter((q) => q.id !== x.id), x]);
  };
  const saveAcq = async (d: AcquisitionDraft, id?: string) => {
    const x = await save<AcquisitionRecord>("acquisitions", d, acqs.find((q) => q.id === id), id);
    setAcqs((v) => [...v.filter((q) => q.id !== x.id), x]);
  };

  if (loading) return <div className="investment-workspace"><section className="investment-panel">{copy.loading}</section></div>;
  if (loadProblem) {
    return (
      <div className="investment-workspace">
        <section className="investment-panel space-y-3" data-load-failed>
          <ApiProblemNote problem={loadProblem} />
          {problems.retry && (
            <Button variant="secondary" onClick={() => void load()}>
              {problems.retry}
            </Button>
          )}
        </section>
      </div>
    );
  }
  return (
    <div className="investment-workspace">
      {section === "loans" ? (
        <Loans locale={locale} properties={properties} records={loans} readOnly={datasetId !== "real"} onSave={saveLoan} />
      ) : (
        <Acquisitions locale={locale} records={acqs} readOnly={datasetId !== "real"} onSave={saveAcq} />
      )}
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { Button, Field, Input, Modal, Select, Spinner } from "@/components/pro/ui";
import type { Dict } from "@/lib/i18n/fr";

/**
 * Mercury-clean bill intake for the finance module: forward-by-email inbox,
 * a drag-and-drop zone, and a transaction form the demo OCR pre-fills from
 * the recognised invoice (the Krier/Kirsch boiler bill of the active
 * dataset). VAT rates are Luxembourg's: 17 / 14 / 8 / 3 / exonéré.
 */

export interface BillOcr {
  supplierId: string;
  subject: string;
  docNo: string;
  docDate: string; // yyyy-mm-dd for <input type=date>
  amountLabel: string;
  unitId: string;
}

export default function BillUpload({
  d,
  inbox,
  suppliers,
  unitOptions,
  ocr,
}: {
  d: Dict;
  inbox: string;
  suppliers: Array<{ id: string; name: string }>;
  unitOptions: Array<{ id: string; label: string }>;
  ocr: BillOcr;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0 4 4m-4-4-4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
        {d.finance.addBill}
      </Button>
      {open && (
        <BillModal
          d={d}
          inbox={inbox}
          suppliers={suppliers}
          unitOptions={unitOptions}
          ocr={ocr}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type ScanState = "idle" | "scanning" | "done";

function BillModal({
  d,
  inbox,
  suppliers,
  unitOptions,
  ocr,
  onClose,
}: {
  d: Dict;
  inbox: string;
  suppliers: Array<{ id: string; name: string }>;
  unitOptions: Array<{ id: string; label: string }>;
  ocr: BillOcr;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [scan, setScan] = useState<ScanState>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [direction, setDirection] = useState<"income" | "expense">("expense");
  const [supplier, setSupplier] = useState("");
  const [subject, setSubject] = useState("");
  const [docNo, setDocNo] = useState("");
  const [docDate, setDocDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paid, setPaid] = useState(false);
  const [cashflow, setCashflow] = useState(true);
  const [unitId, setUnitId] = useState(unitOptions[0]?.id ?? "");
  const [category, setCategory] = useState("repair");
  const [vat, setVat] = useState("17");
  const [amount, setAmount] = useState("");

  const fileInput = useRef<HTMLInputElement>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inbox);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable — the address stays selectable.
    }
  };

  const ingest = (name: string) => {
    setFileName(name);
    setScan("scanning");
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => {
      setScan("done");
      setDirection("expense");
      setSupplier(ocr.supplierId);
      setSubject(ocr.subject);
      setDocNo(ocr.docNo);
      setDocDate(ocr.docDate);
      setPaid(false);
      setCashflow(true);
      setUnitId(ocr.unitId);
      setCategory("repair");
      setVat("17");
      setAmount(ocr.amountLabel);
    }, 900);
  };

  const categories: Array<{ id: string; label: string }> = [
    { id: "repair", label: d.finance.billCatRepair },
    { id: "utilities", label: d.finance.billCatUtilities },
    { id: "insurance", label: d.finance.billCatInsurance },
    { id: "fees", label: d.finance.billCatFees },
    { id: "other", label: d.finance.billCatOther },
  ];

  return (
    <Modal open onClose={onClose} title={d.finance.addBill} wide closeLabel={d.common.close}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Intake — forward by email, or drop the file */}
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-sand-200 bg-sand-50/60 p-4">
            <p className="text-sm font-semibold text-ink">{d.finance.billForwardTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">{d.finance.billForwardBody}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-800">
                {inbox}
              </code>
              <button
                onClick={copy}
                className="tactile shrink-0 rounded-lg border border-sand-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand-300 hover:text-brand-700"
              >
                {copied ? d.finance.billCopied : d.finance.billCopy}
              </button>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label={d.finance.billDropTitle}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              ingest(e.dataTransfer.files[0]?.name ?? "facture.pdf");
            }}
            className={
              "flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors duration-150 " +
              (dragOver ? "border-brand-400 bg-brand-50/60" : "border-sand-300 bg-white hover:border-brand-300")
            }
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/*,.pdf,.csv,.xlsx"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && ingest(e.target.files[0].name)}
            />
            {scan === "scanning" ? (
              <>
                <Spinner size={24} />
                <p className="text-sm font-semibold text-ink">{d.finance.billScanning}</p>
                {fileName && <p className="text-xs text-ink-soft">{fileName}</p>}
              </>
            ) : scan === "done" ? (
              <>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-5 w-5" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                  </svg>
                </span>
                <p role="status" className="text-sm font-semibold text-ink">
                  {d.finance.billScanned}
                </p>
                {fileName && <p className="text-xs text-ink-soft">{fileName}</p>}
              </>
            ) : (
              <>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0 4 4m-4-4-4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                  </svg>
                </span>
                <p className="text-sm font-semibold text-ink">{d.finance.billDropTitle}</p>
                <p className="text-xs text-ink-soft">{d.finance.billDropBody}</p>
              </>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-ink-soft">{d.finance.billOcrNote}</p>
        </div>

        {/* Transaction form */}
        <form
          className="space-y-3.5 lg:col-span-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
        >
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1" role="radiogroup">
            {(["income", "expense"] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                role="radio"
                aria-checked={direction === dir}
                onClick={() => setDirection(dir)}
                className={
                  "rounded-lg px-3 py-1.5 text-sm font-semibold transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] " +
                  (direction === dir ? "bg-brand-600 text-white shadow-sm" : "text-ink-soft hover:text-ink")
                }
              >
                {dir === "income" ? d.finance.billIncome : d.finance.billExpense}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={d.finance.billSupplier}>
              <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">{d.finance.billSupplierNone}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={d.finance.billSubject}>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} />
            </Field>
            <Field label={d.finance.billDocNo}>
              <Input value={docNo} onChange={(e) => setDocNo(e.target.value)} maxLength={40} />
            </Field>
            <Field label={d.finance.billDocDate}>
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </Field>
            <Field label={d.finance.billDueDate}>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label={d.finance.billUnit}>
              <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {unitOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={d.finance.billCategory}>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={d.finance.billVat}>
                <Select value={vat} onChange={(e) => setVat(e.target.value)}>
                  <option value="17">17 %</option>
                  <option value="14">14 %</option>
                  <option value="8">8 %</option>
                  <option value="3">3 %</option>
                  <option value="0">{d.finance.billVatExempt}</option>
                </Select>
              </Field>
              <Field label={d.finance.billAmount}>
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  className="text-right tabular-nums"
                />
              </Field>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            <Toggle checked={paid} onChange={setPaid} label={d.finance.billPaid} />
            <Toggle checked={cashflow} onChange={setCashflow} label={d.finance.billCashflow} />
          </div>

          {submitted && (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              {d.common.demoCreateNotice}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-sand-100 pt-4">
            <p className="text-sm text-ink-soft">
              {d.finance.billTotal}{" "}
              <span className="font-display text-base font-bold tabular-nums text-ink">
                {amount.trim() ? `${amount} €` : "0,00 €"}
              </span>
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {d.common.cancel}
              </Button>
              <Button type="submit">{d.finance.billCreate}</Button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 text-sm font-medium text-ink"
    >
      <span
        className={
          "relative h-6 w-10 rounded-full transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " +
          (checked ? "bg-brand-600" : "bg-sand-200")
        }
        aria-hidden
      >
        <span
          className={
            "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " +
            (checked ? "translate-x-4" : "translate-x-0")
          }
        />
      </span>
      {label}
    </button>
  );
}

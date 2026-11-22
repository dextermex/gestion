"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Field, Input, Select } from "@/components/pro/ui";
import { ContactLink } from "@/components/gestion/ContactLink";
import { initials } from "@/lib/types";

/**
 * The people on a tenancy, with the days they came in and left, and what can
 * change while it runs: a co-tenant or a guarantor joins, someone leaves (the
 * last tenant leaves through the departure, never from here), and a person's
 * access to the tenant space is taken back. Every label and date arrives
 * worded from the server; the rules are the API's.
 */
export interface PartyRow {
  id: string;
  contactId: string;
  name: string;
  href: string;
  email: string | null;
  phone: string | null;
  roleLabel: string;
  /** "Depuis le …", "Du … au …". */
  datesLabel: string;
  /** Still on the tenancy: they can be dated out. */
  present: boolean;
  /** Their account opens the tenant space: it can be taken back. */
  portalLinked: boolean;
}

export interface PartyCandidate {
  id: string;
  label: string;
}

export interface PartiesLabels {
  linked: string;
  moveOut: string;
  moveOutOn: string;
  moveOutDo: string;
  keep: string;
  lastTenant: string;
  failed: string;
  access: string;
  accessBody: string;
  accessDo: string;
  add: string;
  addContact: string;
  addRole: string;
  roleTenant: string;
  roleGuarantor: string;
  addOn: string;
  addDo: string;
  pick: string;
  already: string;
  invalid: string;
  noCandidate: string;
}

type Open = { kind: "out" | "access"; id: string } | { kind: "add" } | null;

export default function LeaseParties({
  leaseId,
  rows,
  candidates,
  labels,
  writable,
  live,
  today,
}: {
  leaseId: string;
  rows: PartyRow[];
  candidates: PartyCandidate[];
  labels: PartiesLabels;
  /** A real account: the sample cabinet writes nothing. */
  writable: boolean;
  /** The tenancy is in force: people can join and leave. */
  live: boolean;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [date, setDate] = useState(today);
  const [contactId, setContactId] = useState("");
  const [role, setRole] = useState<"tenant" | "guarantor">("tenant");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = (next: Open) => {
    setOpen(next);
    setDate(today);
    setContactId("");
    setRole("tenant");
    setError(null);
  };

  async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) {
        const answer = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          answer.error === "last_tenant"
            ? labels.lastTenant
            : answer.error === "already_party"
              ? labels.already
              : answer.error === "invalid"
                ? labels.invalid
                : labels.failed,
        );
        return;
      }
      setOpen(null);
      router.refresh();
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error && (
    <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
      {error}
    </p>
  );

  return (
    <div data-lease-parties>
      <ul className="divide-y divide-sand-100">
        {rows.map((p) => (
          <li key={p.id} className="py-2.5" data-party={p.id}>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{initials(p.name)}</span>
              <div className="min-w-0 flex-1">
                <Link href={p.href} className={"block truncate text-sm font-semibold hover:text-brand-700 " + (p.present ? "text-ink" : "text-ink-soft")}>
                  {p.name}
                </Link>
                <p className="truncate text-xs text-ink-soft">
                  {p.datesLabel}
                  {(p.email || p.phone) && " · "}
                  <ContactLink email={p.email} phone={p.phone} none="" />
                </p>
              </div>
              <Badge className={p.present ? "bg-sky-100 text-sky-800" : "bg-sand-100 text-ink-soft"}>{p.roleLabel}</Badge>
            </div>
            {writable && (p.present || p.portalLinked) && (
              <div className="mt-1 flex flex-wrap gap-x-3 pl-12">
                {p.portalLinked && <span className="inline-flex min-h-10 items-center text-xs text-ink-soft">{labels.linked}</span>}
                {live && p.present && (
                  <button type="button" onClick={() => start({ kind: "out", id: p.id })} className="inline-flex min-h-10 items-center text-xs font-semibold text-brand-700 hover:underline">
                    {labels.moveOut}
                  </button>
                )}
                {p.portalLinked && (
                  <button type="button" onClick={() => start({ kind: "access", id: p.id })} className="inline-flex min-h-10 items-center text-xs font-semibold text-ink-soft hover:text-ink hover:underline">
                    {labels.access}
                  </button>
                )}
              </div>
            )}
            {open?.kind === "out" && open.id === p.id && (
              <div className="mt-2 rounded-xl bg-sand-50 p-3.5">
                <Field label={labels.moveOutOn}>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                {errorLine}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" disabled={busy} onClick={() => setOpen(null)}>
                    {labels.keep}
                  </Button>
                  <Button loading={busy} disabled={!date} onClick={() => void send(`/api/baux/${encodeURIComponent(leaseId)}/parties/${encodeURIComponent(p.id)}`, "PATCH", { movedOutOn: date })}>
                    {labels.moveOutDo}
                  </Button>
                </div>
              </div>
            )}
            {open?.kind === "access" && open.id === p.id && (
              <div className="mt-2 rounded-xl bg-sand-50 p-3.5">
                <p className="text-xs leading-relaxed text-ink-soft">{labels.accessBody}</p>
                {errorLine}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" disabled={busy} onClick={() => setOpen(null)}>
                    {labels.keep}
                  </Button>
                  <Button variant="danger" loading={busy} onClick={() => void send(`/api/portail/acces/${encodeURIComponent(p.contactId)}`, "DELETE")}>
                    {labels.accessDo}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {writable && live && open?.kind !== "add" && (
        <button type="button" onClick={() => start({ kind: "add" })} className="mt-2 inline-flex min-h-10 items-center text-sm font-semibold text-brand-700 hover:underline">
          {labels.add}
        </button>
      )}
      {open?.kind === "add" && (
        <div className="mt-3 rounded-xl bg-sand-50 p-3.5" data-party-add>
          {candidates.length === 0 ? (
            <p className="text-sm text-ink-soft">{labels.noCandidate}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">
                <Field label={labels.addContact}>
                  <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                    <option value="">{labels.pick}</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label={labels.addRole}>
                <Select value={role} onChange={(e) => setRole(e.target.value === "guarantor" ? "guarantor" : "tenant")}>
                  <option value="tenant">{labels.roleTenant}</option>
                  <option value="guarantor">{labels.roleGuarantor}</option>
                </Select>
              </Field>
              <Field label={labels.addOn}>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
          )}
          {errorLine}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(null)}>
              {labels.keep}
            </Button>
            {candidates.length > 0 && (
              <Button loading={busy} disabled={!contactId} onClick={() => void send(`/api/baux/${encodeURIComponent(leaseId)}/parties`, "POST", { contactId, role, movedInOn: date })}>
                {labels.addDo}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";

/**
 * "+ Ajouter un lot": one small form, one POST, and the building's page is
 * read again from the database. On a sample cabinet the form opens but
 * nothing is written, and it says so.
 */
export interface LotCreateLabels {
  open: string;
  title: string;
  label: string;
  kind: string;
  kinds: Record<"dwelling" | "commercial" | "office" | "parking" | "cellar" | "other", string>;
  floor: string;
  area: string;
  rooms: string;
  bedrooms: string;
  furnished: string;
  save: string;
  cancel: string;
  failed: string;
}

export default function LotCreate({ propertyId, labels, sampleNote }: { propertyId: string; labels: LotCreateLabels; sampleNote: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<keyof LotCreateLabels["kinds"]>("dwelling");
  const [floor, setFloor] = useState("");
  const [area, setArea] = useState("");
  const [rooms, setRooms] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [furnished, setFurnished] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "failed" | "sample">("idle");

  const close = () => {
    setOpen(false);
    setState("idle");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sampleNote) {
      setState("sample");
      return;
    }
    setState("saving");
    try {
      const res = await fetch("/api/lots/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, label, kind, floor, areaSqm: area, rooms, bedrooms, furnished }),
      });
      if (res.status === 401) {
        window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (!res.ok) {
        setState("failed");
        return;
      }
      setLabel("");
      setFloor("");
      setArea("");
      setRooms("");
      setBedrooms("");
      setFurnished(false);
      close();
      router.refresh();
    } catch {
      setState("failed");
    }
  };

  const home = kind === "dwelling";

  return (
    <>
      <Button onClick={() => setOpen(true)} className="max-sm:min-h-11">
        <Icon name="plus" size={16} />
        {labels.open}
      </Button>
      <Modal open={open} onClose={close} title={labels.title} closeLabel={labels.cancel}>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={labels.label}>
              <Input required maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label={labels.kind}>
              <Select value={kind} onChange={(e) => setKind(e.target.value as keyof LotCreateLabels["kinds"])}>
                {(Object.keys(labels.kinds) as Array<keyof LotCreateLabels["kinds"]>).map((k) => (
                  <option key={k} value={k}>
                    {labels.kinds[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={labels.floor}>
              <Input maxLength={20} value={floor} onChange={(e) => setFloor(e.target.value)} />
            </Field>
            <Field label={labels.area}>
              <Input inputMode="decimal" maxLength={10} value={area} onChange={(e) => setArea(e.target.value)} />
            </Field>
            {home && (
              <>
                <Field label={labels.rooms}>
                  <Input inputMode="numeric" maxLength={4} value={rooms} onChange={(e) => setRooms(e.target.value)} />
                </Field>
                <Field label={labels.bedrooms}>
                  <Input inputMode="numeric" maxLength={3} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
                </Field>
              </>
            )}
          </div>
          {home && (
            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input type="checkbox" checked={furnished} onChange={(e) => setFurnished(e.target.checked)} />
              {labels.furnished}
            </label>
          )}
          {state === "failed" && (
            <p role="alert" className="text-xs font-semibold text-red-700">
              {labels.failed}
            </p>
          )}
          {state === "sample" && sampleNote && (
            <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              {sampleNote}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={state === "saving"}>
              {labels.cancel}
            </Button>
            <Button type="submit" loading={state === "saving"}>
              {labels.save}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

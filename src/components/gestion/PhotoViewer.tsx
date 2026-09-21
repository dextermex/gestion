"use client";

import { useState } from "react";
import { Modal } from "@/components/pro/ui";

/** "Voir les photos": the cover, full size, over the page. Shown only once a photograph exists. */
export default function PhotoViewer({ url, title, label, closeLabel }: { url: string; title: string; label: string; closeLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tactile absolute bottom-3 left-3 flex items-center gap-1.5 rounded-xl bg-ink/80 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 16 5-5 4 4 3-3 6 6" />
          <circle cx="16" cy="9" r="1.5" />
        </svg>
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} closeLabel={closeLabel}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={title} className="max-h-[70vh] w-full rounded-xl object-contain" />
      </Modal>
    </>
  );
}

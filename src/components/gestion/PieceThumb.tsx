import { Icon } from "@/components/pro/icons";
import { isPdfName } from "@/lib/portal/pieces";

/**
 * One file of a request, as a tile: the photograph itself, or for a PDF
 * its name under a document symbol. Either opens the file in a tab of its
 * own. A file whose link could not be signed is named, not shown.
 */
export default function PieceThumb({ name, url }: { name: string; url: string | null }) {
  if (!url) {
    return (
      <p className="truncate p-2 text-[11px] text-ink-soft" title={name}>
        {name}
      </p>
    );
  }
  if (isPdfName(name)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" title={name} data-piece="pdf" className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 p-2 text-center text-brand-700 transition hover:bg-sand-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600">
        <Icon name="documents" size={24} className="shrink-0" />
        <span className="line-clamp-2 w-full break-all text-[11px] font-semibold leading-tight text-ink">{name}</span>
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name} loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
    </a>
  );
}

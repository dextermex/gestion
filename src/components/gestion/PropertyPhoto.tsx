import type { PropertyKind } from "@/lib/gestion/portfolio";

/**
 * The cover image of a property.
 *
 * A portfolio is photographs first, so this is the largest element on a card.
 * Until a photograph has been uploaded it draws a quiet architectural mark
 * instead of an empty grey box: the page reads as designed rather than as
 * unfinished, and the day a real photo lands it simply takes the same frame.
 * Nothing here invents an image from the network.
 */

function Glyph({ kind }: { kind: PropertyKind }) {
  const common = {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.25,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "house") {
    return (
      <svg viewBox="0 0 48 48" className="h-14 w-14" aria-hidden {...common}>
        <path d="M8 21 24 9l16 12" />
        <path d="M12 19v20h24V19" />
        <path d="M20 39V28h8v11" />
        <path d="M31 14V10h4v7" />
      </svg>
    );
  }
  if (kind === "commercial") {
    return (
      <svg viewBox="0 0 48 48" className="h-14 w-14" aria-hidden {...common}>
        <path d="M9 18h30l-2-8H11z" />
        <path d="M11 18v21h26V18" />
        <path d="M17 39V27h7v12" />
        <path d="M29 24h5v7h-5z" />
      </svg>
    );
  }
  if (kind === "apartment") {
    return (
      <svg viewBox="0 0 48 48" className="h-14 w-14" aria-hidden {...common}>
        <path d="M14 39V13h20v26" />
        <path d="M9 39h30" />
        <path d="M19 19h4M25 19h4M19 26h4M25 26h4" />
        <path d="M21 39v-7h6v7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" className="h-14 w-14" aria-hidden {...common}>
      <path d="M8 39V15h14v24" />
      <path d="M22 39V9h18v30" />
      <path d="M6 39h36" />
      <path d="M12 21h5M12 27h5M12 33h5" />
      <path d="M27 15h3M34 15h3M27 22h3M34 22h3M27 29h3M34 29h3" />
    </svg>
  );
}

export default function PropertyPhoto({
  url,
  kind,
  alt,
  className = "",
  rounded = "rounded-t-2xl",
}: {
  url: string | null;
  kind: PropertyKind;
  alt: string;
  className?: string;
  rounded?: string;
}) {
  if (url) {
    // A signed storage URL, not a build-time asset: next/image would have to
    // proxy a short-lived private link on every render.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        loading="lazy"
        className={`${rounded} ${className} h-full w-full bg-sand-100 object-cover`}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={alt}
      className={`${rounded} ${className} flex h-full w-full items-center justify-center bg-gradient-to-br from-sand-100 to-sand-200 text-sand-400`}
    >
      <Glyph kind={kind} />
    </div>
  );
}

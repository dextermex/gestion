"use client";

import { useState } from "react";
import type { PropertyKind } from "@/lib/gestion/portfolio";
import GlassHouse from "@/components/gestion/GlassHouse";

/**
 * The cover image of a property.
 *
 * A portfolio is photographs first, so this is the largest element on a card.
 * Until a photograph has been uploaded the frame is never empty and never
 * grey: the glass house stands on the sky ground the overview uses, on
 * every screen and at every width, and the day a real photo lands it simply
 * takes the same frame. The drawing is a placeholder, said as such to a
 * screen reader by the frame's label; nothing here invents an image from
 * the network.
 */

export default function PropertyPhoto({
  url,
  thumbUrl = null,
  kind,
  alt,
  className = "",
  rounded = "rounded-t-2xl",
}: {
  url: string | null;
  /** A card-sized render of the same photograph; the original stands in when it is missing or fails. */
  thumbUrl?: string | null;
  kind: PropertyKind;
  alt: string;
  className?: string;
  rounded?: string;
}) {
  // The render is tried first; should the storage refuse it, the original is loaded instead.
  const [src, setSrc] = useState(thumbUrl ?? url);
  if (url) {
    // A signed storage URL, not a build-time asset: next/image would have to
    // proxy a short-lived private link on every render.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src ?? url}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => {
          if (src !== url) setSrc(url);
        }}
        className={`${rounded} ${className} h-full w-full bg-sand-100 object-cover`}
      />
    );
  }
  return (
    <div role="img" aria-label={alt} data-kind={kind} className={`${rounded} ${className} property-cover flex h-full w-full items-end justify-center overflow-hidden`}>
      <GlassHouse className="property-cover-art" />
    </div>
  );
}

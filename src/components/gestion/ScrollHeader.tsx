"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Chrome as a material, not a bar: translucent over the content, with the
 * separating edge (border + soft shadow) appearing only once something has
 * actually scrolled underneath it. At rest the page and its chrome read as
 * one surface.
 *
 * Elevation is driven by a 1px in-flow sentinel rendered just above the
 * sticky header: when it leaves the viewport, content is underneath the
 * chrome. An IntersectionObserver fires whatever the scroll container is,
 * including scroll positions restored before hydration, where a scroll
 * listener would stay silent.
 */
export default function ScrollHeader({
  className,
  elevated,
  children,
}: {
  /** Classes that always apply (layout + material). */
  className: string;
  /** Classes added once the page is scrolled (the edge). */
  elevated: string;
  children: React.ReactNode;
}) {
  const [isElevated, setElevated] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setElevated(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} aria-hidden className="-mb-px h-px w-full" />
      <header className={className + (isElevated ? " " + elevated : "")}>{children}</header>
    </>
  );
}

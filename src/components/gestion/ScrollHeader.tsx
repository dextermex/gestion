"use client";

import { useEffect, useState } from "react";

/**
 * Chrome as a material, not a bar: translucent over the content, with the
 * separating edge (border + soft shadow) appearing only once something has
 * actually scrolled underneath it. At rest the page and its chrome read as
 * one surface.
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

  useEffect(() => {
    const onScroll = () => setElevated(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return <header className={className + (isElevated ? " " + elevated : "")}>{children}</header>;
}

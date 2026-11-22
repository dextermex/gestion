/**
 * Whether an address belongs to a section of the rail: it is one of the
 * section's addresses, or sits under one. A bare prefix test is not enough:
 * `/app/compteurs` starts with `/app/compte` and belongs elsewhere.
 */
export function inSection(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

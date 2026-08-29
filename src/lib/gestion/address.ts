/** The address shape stored in gestion.properties.address (jsonb). */
export interface PropertyAddress {
  street?: string;
  number?: string;
  postal_code?: string;
  city?: string;
  country?: string;
}

/** "12, rue de la Gare, L-1611 Luxembourg" — the display convention of the app. */
export function formatAddress(a: PropertyAddress | null | undefined): string {
  if (!a) return "";
  const line1 = [a.number, a.street].filter(Boolean).join(", ");
  const line2 = [a.postal_code, a.city].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ");
}

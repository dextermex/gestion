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

/** The same address, part by part and every part a string: what an editor opens on. */
export interface AddressParts {
  street: string;
  number: string;
  postalCode: string;
  city: string;
  country: string;
}

/**
 * The stored parts of an address, read as they are. An editor is filled from
 * these and never from the printed line: "12, rue de la Gare" cannot be taken
 * apart again without guessing where the number ends ("12A", "12-14", none).
 */
export function addressParts(a: PropertyAddress | null | undefined): AddressParts {
  const part = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  return {
    street: part(a?.street),
    number: part(a?.number),
    postalCode: part(a?.postal_code),
    city: part(a?.city),
    country: part(a?.country) || "LU",
  };
}

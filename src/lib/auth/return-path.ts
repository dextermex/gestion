import { safeSignupNext } from "@/lib/signup/model";

export { REQUESTED_PATH_HEADER, requestedPath } from "./requested-path";

/**
 * The door, with the way back. The value is whatever the request carried, so
 * it goes through the same sanitiser as every `next=`: a same-origin path of
 * this application's own spaces, or the space's home.
 */
export function signInAddress(requested: string | null | undefined, space: "app" | "locataire"): string {
  const next = safeSignupNext(requested, space === "locataire" ? "tenant" : "landlord");
  return `/connexion?next=${encodeURIComponent(next)}`;
}

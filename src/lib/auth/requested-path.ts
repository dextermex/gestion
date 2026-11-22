/**
 * Where a signed-out visitor was going. A layout is not given the address it
 * renders, so `src/middleware.ts` copies the requested path and query into
 * this request header for the two spaces, and the layouts read it back to
 * send the visitor to the door with their destination. Nothing else is
 * imported here: this file is all the middleware carries.
 */
export const REQUESTED_PATH_HEADER = "x-morada-path";

/** The path and query of a request, without the parameter the framework adds to its own data requests. */
export function requestedPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("_rsc");
  const query = params.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}

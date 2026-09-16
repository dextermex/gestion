/**
 * Stands in for the `server-only` marker under vitest. The real package
 * throws on import outside a React Server Component, which is exactly what
 * it is for in the app and exactly what a unit test of a server module does
 * not need.
 */
export {};

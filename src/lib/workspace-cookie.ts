/**
 * The workspace an account that belongs to several chose to open. The
 * browser only names it: the server opens it when the account is a member
 * the database admits there (`getIdentity`), and falls back to its first
 * workspace otherwise. Written only by POST /api/espace/actif, out of reach
 * of scripts; kept apart from `@/lib/workspace` so code that may not import
 * a server module can still name it.
 */
export const WORKSPACE_COOKIE = "morada_workspace";

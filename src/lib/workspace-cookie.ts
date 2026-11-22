/**
 * The workspace an account that belongs to several chose to open. The
 * browser only names it: the server opens it when the account is a member
 * the database admits there (`getIdentity`), and falls back to its first
 * workspace otherwise. Importable from the shell (which writes it) and the
 * server (which reads it).
 */
export const WORKSPACE_COOKIE = "morada_workspace";

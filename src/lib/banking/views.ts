/**
 * The banking workspace's filters, shared by the server page (which reads
 * `?vue=` from the URL) and the client workspace (which keeps the choice).
 */
export const BANK_VIEWS = ["all", "review", "auto", "ignored"] as const;

export type BankView = (typeof BANK_VIEWS)[number];

export function isBankView(v: string | undefined): v is BankView {
  return v !== undefined && (BANK_VIEWS as readonly string[]).includes(v);
}

/**
 * An email address or a phone number as the thing a phone does with it: a
 * tap writes or calls. On a laptop the same links open the mail client or
 * nothing at all, which is what they did as plain text. A missing value
 * shows the dash the rest of the product uses.
 */
export function ContactLink({ email, phone, none = "—", className = "" }: { email?: string | null; phone?: string | null; none?: string; className?: string }) {
  const base = "font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center " + className;
  if (email) {
    return (
      <a href={`mailto:${email}`} className={base}>
        {email}
      </a>
    );
  }
  if (phone) {
    return (
      <a href={`tel:${phone.replace(/[\s.]/g, "")}`} className={base}>
        {phone}
      </a>
    );
  }
  return <>{none}</>;
}

/**
 * Small things every form of the application does the same way.
 */

/**
 * The first date field of a form whose text is not a day.
 *
 * The product's own date field (`DateField`) hands back an ISO day, or
 * nothing while what is typed is not one, and marks itself invalid. A form
 * cannot tell an empty date from a mistyped one by the value alone, so before
 * it saves it asks here: a field found is given the focus and the save waits,
 * instead of "32/13/2026" being stored as no date at all.
 */
export function invalidDayField(root: ParentNode | null | undefined): HTMLInputElement | null {
  return root?.querySelector<HTMLInputElement>('input[data-day][aria-invalid="true"]') ?? null;
}

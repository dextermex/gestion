/**
 * Remounts on every navigation, so each screen enters with the soft house
 * rise instead of snapping into place. Pure CSS (.page-enter in globals):
 * no client JS, and reduced motion collapses it to a plain fade.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}

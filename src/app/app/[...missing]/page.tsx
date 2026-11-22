import { notFound } from "next/navigation";

/**
 * Every address under /app that no screen answers. Without this, the
 * framework answers before the layout runs: no shell, and a signed-out
 * visitor is not sent to sign in. Here the layout has run, and the space's
 * own not-found screen renders inside it.
 */
export default function MissingAppPage() {
  notFound();
}

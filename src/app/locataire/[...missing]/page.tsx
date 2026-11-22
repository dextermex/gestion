import { notFound } from "next/navigation";

/** Every address under /locataire that no screen answers: the layout has run (signed-out visitors go to sign in), the space's own not-found screen renders inside it. */
export default function MissingTenantPage() {
  notFound();
}

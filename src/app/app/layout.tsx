import type { Metadata } from "next";
import GestionShell from "@/components/gestion/Shell";

export const metadata: Metadata = {
  title: "Morada Gestion",
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <GestionShell>{children}</GestionShell>;
}

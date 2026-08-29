import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { getDatasetId, getDemo } from "@/lib/demo";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";
import { initials } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { PRO_URL } from "@/lib/constants";

interface MemberRow {
  key: string;
  name: string;
  email: string;
  role: string;
  self: boolean;
}

/**
 * Utilisateurs & accès: who can open this workspace. Membership lives in
 * the shared Morada tables (crm_members) — one identity across the whole
 * ecosystem — so invitations and role changes happen in Morada Pro, and
 * this screen reads the same rows RLS lets the caller see.
 */
export default async function UtilisateursPage() {
  const { d } = await getI18n();
  const [demo, datasetId] = await Promise.all([getDemo(), getDatasetId()]);
  const real = datasetId === "real";

  let rows: MemberRow[] = [];
  if (real) {
    const session = await getSession();
    const identity = await getIdentity();
    if (session && identity?.active) {
      const { data, error } = await authedClient(session.accessToken)
        .from("crm_members")
        .select("user_id,display_name,email,role,status")
        .eq("agency_id", identity.active.id)
        .eq("status", "active")
        .order("created_at");
      if (error) console.error("members read failed:", error.code, error.message);
      rows = ((data as Array<Record<string, unknown>> | null) ?? []).map((m) => ({
        key: String(m.user_id),
        name: String(m.display_name ?? "") || String(m.email ?? ""),
        email: String(m.email ?? ""),
        role: String(m.role ?? ""),
        self: String(m.user_id) === session.userId,
      }));
      // RLS may only return the caller; the caller is always at least there.
      if (!rows.some((r) => r.self)) {
        rows.unshift({
          key: session.userId,
          name: identity.displayName,
          email: identity.email,
          role: identity.active.role,
          self: true,
        });
      }
    }
  } else {
    rows = [
      {
        key: "demo-manager",
        name: demo.ORG.managerName,
        email: demo.ORG.managerEmail,
        role: "owner",
        self: false,
      },
    ];
  }

  return (
    <div>
      <PageHeader title={d.utilisateurs.title} subtitle={d.utilisateurs.subtitle} />

      <div className="mx-auto max-w-3xl">
        <Card className="overflow-hidden">
          <ul className="divide-y divide-sand-100">
            {rows.map((m) => (
              <li key={m.key} className="flex items-center gap-3 px-5 py-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
                  {initials(m.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {m.name}
                    {m.self && <span className="ml-2 text-xs font-medium text-ink-soft">{d.utilisateurs.you}</span>}
                  </p>
                  <p className="truncate text-xs text-ink-soft">{m.email}</p>
                </div>
                <Badge className="bg-sand-100 text-ink-soft">{m.role}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="mt-5 border-dashed bg-sand-50/50 p-4">
          <p className="text-xs leading-relaxed text-ink-soft">
            {d.utilisateurs.manageInPro}{" "}
            <a
              href={PRO_URL}
              className="font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              {d.utilisateurs.openPro}
            </a>
          </p>
        </Card>
      </div>
    </div>
  );
}

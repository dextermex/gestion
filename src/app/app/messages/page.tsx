import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote } from "@/components/gestion/bits";
import { CONVERSATIONS } from "@/lib/demo/data";
import { initials } from "@/lib/types";

const SENDER_COLORS: Record<string, string> = {
  tenant: "bg-sky-100 text-sky-800",
  manager: "bg-brand-100 text-brand-800",
  owner: "bg-violet-100 text-violet-800",
  artisan: "bg-amber-100 text-amber-800",
  system: "bg-sand-100 text-ink-soft",
};

function timeOf(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-LU", { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString("fr-LU", { hour: "2-digit", minute: "2-digit" });
}

export default function MessagesPage() {
  const first = CONVERSATIONS[0];
  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle="Un fil par sujet — bail, intervention, mandat — avec locataires, propriétaires et artisans au même endroit. Traduction automatique entre les cinq langues."
      />

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="overflow-hidden lg:col-span-2">
          <ul className="divide-y divide-sand-100">
            {CONVERSATIONS.map((conv, i) => (
              <li key={conv.id}>
                <button
                  className={
                    "block w-full px-4 py-3 text-left transition hover:bg-sand-50 " +
                    (i === 0 ? "bg-brand-50/60" : "")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-ink">{conv.subject}</p>
                    {conv.unread > 0 && (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500 text-[10px] font-bold text-white">
                        {conv.unread}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">{conv.scopeLabel}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-soft/70">
                    {conv.messages[conv.messages.length - 1].body}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col lg:col-span-3">
          <div className="border-b border-sand-100 px-5 py-3.5">
            <p className="font-display text-base font-bold text-ink">{first.subject}</p>
            <p className="text-xs text-ink-soft">{first.scopeLabel}</p>
          </div>
          <div className="flex-1 space-y-4 px-5 py-4">
            {first.messages.map((m, i) => (
              <div key={i} className={"flex gap-3 " + (m.kind === "manager" ? "flex-row-reverse" : "")}>
                <span
                  className={
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                    SENDER_COLORS[m.kind]
                  }
                  title={m.from}
                >
                  {initials(m.from)}
                </span>
                <div className={"max-w-[75%] " + (m.kind === "manager" ? "text-right" : "")}>
                  <div
                    className={
                      "inline-block rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed " +
                      (m.kind === "manager"
                        ? "rounded-tr-md bg-brand-600 text-white"
                        : m.kind === "system"
                          ? "rounded-tl-md border border-dashed border-sand-200 bg-sand-50 text-ink-soft"
                          : "rounded-tl-md bg-sand-100 text-ink")
                    }
                  >
                    {m.body}
                  </div>
                  <p className="mt-1 text-[11px] text-ink-soft/70">
                    {m.from} · {timeOf(m.at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-sand-100 p-4">
            <div className="flex items-center gap-2">
              <input
                placeholder="Répondre… (traduit automatiquement si besoin)"
                className="w-full rounded-xl border border-sand-200 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
              <button className="tactile shrink-0 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
                Envoyer
              </button>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <Badge className="bg-sky-100 text-sky-800">Locataires</Badge>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">
            Une seule porte d&apos;entrée « Nouvelle demande » — la catégorie est inférée, jamais demandée.
            Urgence gaz : numéros d&apos;urgence affichés avant même la fin de la saisie.
          </p>
        </Card>
        <Card className="p-4">
          <Badge className="bg-amber-100 text-amber-800">Artisans</Badge>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">
            Répondent par lien magique — pas de compte, pas d&apos;app. Le fil garde la trace des
            créneaux proposés et acceptés.
          </p>
        </Card>
        <Card className="p-4">
          <Badge className="bg-sand-100 text-ink-soft">Système</Badge>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">
            Les événements notables (attestation générée, INDEXATION_LAG, AR reçu) se postent
            d&apos;eux-mêmes dans le bon fil — le fil est la mémoire du dossier.
          </p>
        </Card>
      </div>
      <LegalNote>
        Les notes internes du gestionnaire vivent dans des tables séparées jamais exposées aux
        politiques RLS du portail locataire — pas de fuite possible par construction.
      </LegalNote>
    </div>
  );
}

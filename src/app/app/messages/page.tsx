import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote } from "@/components/gestion/bits";
import { MessagesPanel } from "@/components/gestion/MessagesPanel";
import { CONVERSATIONS } from "@/lib/demo/data";
import { getI18n } from "@/lib/i18n";
import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";

function timeOf(iso: string, locale: Locale): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit" })
  );
}

export default async function MessagesPage() {
  const { locale, d } = await getI18n();
  const conversations = CONVERSATIONS.map((conv) => ({
    id: conv.id,
    subject: conv.subject,
    scopeLabel: conv.scopeLabel,
    unread: conv.unread,
    messages: conv.messages.map((m) => ({
      from: m.from,
      kind: m.kind,
      body: m.body,
      timeLabel: timeOf(m.at, locale),
    })),
  }));

  return (
    <div>
      <PageHeader title={d.messages.title} subtitle={d.messages.subtitle} />

      <MessagesPanel
        conversations={conversations}
        labels={{
          replyPlaceholder: d.messages.replyPlaceholder,
          send: d.common.send,
          sent: d.messages.replySent,
          unreadAria: d.messages.unreadAria,
        }}
      />

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <Badge className="bg-sky-100 text-sky-800">{d.messages.cardTenants}</Badge>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">{d.messages.cardTenantsBody}</p>
        </Card>
        <Card className="p-4">
          <Badge className="bg-amber-100 text-amber-800">{d.messages.cardArtisans}</Badge>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">{d.messages.cardArtisansBody}</p>
        </Card>
        <Card className="p-4">
          <Badge className="bg-sand-100 text-ink-soft">{d.messages.cardSystem}</Badge>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">{d.messages.cardSystemBody}</p>
        </Card>
      </div>
      <LegalNote>{d.messages.legal}</LegalNote>
    </div>
  );
}

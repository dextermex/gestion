/**
 * Every notification the app can send, in the four languages of the
 * profile. One function per kind; the arguments are already formatted
 * (amounts in euros, dates in words) by the caller. No em dashes, no
 * arrows, labels join with a middot, as in the app's own copy.
 */
export type Lang = "fr" | "en" | "de" | "lu";
export type Category = "rent" | "messages" | "tickets" | "deadlines" | "bank" | "digest" | "account";
export type Severity = "low" | "normal" | "high" | "critical";

export interface Text { title: string; body: string }
type T = Record<Lang, (a: Record<string, string>) => Text>;

type SetupStep = "property" | "lease" | "bank" | "invite";
const SETUP: Record<"fr" | "en" | "de" | "lu", Record<SetupStep, { title: string; body: string }>> = {
  fr: {
    property: { title: "Ajoutez votre premier bien", body: "Deux minutes suffisent, et tout le reste en découle." },
    lease: { title: "Créez le bail de votre bien", body: "Avec le bail, chaque loyer est suivi et chaque retard signalé." },
    bank: { title: "Connectez votre banque", body: "Les virements se rapprochent tout seuls de vos loyers." },
    invite: { title: "Invitez votre locataire", body: "Il retrouve son bail, ses paiements et ses demandes dans son espace." },
  },
  en: {
    property: { title: "Add your first property", body: "Two minutes are enough, and everything else follows from it." },
    lease: { title: "Create the lease for your property", body: "With the lease, every rent is tracked and every delay flagged." },
    bank: { title: "Connect your bank", body: "Transfers are matched to your rents on their own." },
    invite: { title: "Invite your tenant", body: "They find their lease, payments and requests in their own space." },
  },
  de: {
    property: { title: "Legen Sie Ihr erstes Objekt an", body: "Zwei Minuten genügen, alles Weitere ergibt sich daraus." },
    lease: { title: "Legen Sie den Mietvertrag an", body: "Mit dem Mietvertrag wird jede Miete verfolgt und jeder Verzug gemeldet." },
    bank: { title: "Verbinden Sie Ihre Bank", body: "Überweisungen werden Ihren Mieten von selbst zugeordnet." },
    invite: { title: "Laden Sie Ihren Mieter ein", body: "Er findet Mietvertrag, Zahlungen und Anfragen in seinem Bereich." },
  },
  lu: {
    property: { title: "Leet Är éischt Immobilie un", body: "Zwou Minutte geet duer, alles anescht kënnt dovun." },
    lease: { title: "Leet de Bail un", body: "Mam Bail gëtt all Loyer verfollegt an all Retard gemellt." },
    bank: { title: "Verbannt Är Bank", body: "D'Iwwerweisunge ginn Äre Loyere vum selwen zougeuerdnet." },
    invite: { title: "Invitéiert Äre Locataire", body: "Hie fënnt säi Bail, seng Bezuelungen a seng Demanden a sengem Beräich." },
  },
};

export const KINDS = {
  "rent.received": {
    category: "rent",
    fr: (a) => ({ title: `Loyer reçu · ${a.tenant}`, body: `${a.amount} pour ${a.unit}.${a.remaining ? ` Reste à percevoir ce mois : ${a.remaining}.` : " Le mois est soldé."}` }),
    en: (a) => ({ title: `Rent received · ${a.tenant}`, body: `${a.amount} for ${a.unit}.${a.remaining ? ` Still open this month: ${a.remaining}.` : " The month is settled."}` }),
    de: (a) => ({ title: `Miete eingegangen · ${a.tenant}`, body: `${a.amount} für ${a.unit}.${a.remaining ? ` Diesen Monat noch offen: ${a.remaining}.` : " Der Monat ist beglichen."}` }),
    lu: (a) => ({ title: `Loyer era · ${a.tenant}`, body: `${a.amount} fir ${a.unit}.${a.remaining ? ` Dëse Mount nach op: ${a.remaining}.` : " De Mount ass bezuelt."}` }),
  },
  "rent.late": {
    category: "rent",
    fr: (a) => ({ title: `Loyer en retard · ${a.tenant}`, body: `${a.amount} attendu le ${a.due}, ${a.days} jours de retard · ${a.unit}.` }),
    en: (a) => ({ title: `Rent overdue · ${a.tenant}`, body: `${a.amount} was due on ${a.due}, ${a.days} days late · ${a.unit}.` }),
    de: (a) => ({ title: `Miete überfällig · ${a.tenant}`, body: `${a.amount} war am ${a.due} fällig, ${a.days} Tage Verzug · ${a.unit}.` }),
    lu: (a) => ({ title: `Loyer am Verzuch · ${a.tenant}`, body: `${a.amount} war den ${a.due} fälleg, ${a.days} Deeg Verzuch · ${a.unit}.` }),
  },
  "rent.month_summary": {
    category: "digest",
    fr: (a) => ({ title: `Loyers de ${a.month}`, body: `${a.collected} perçus sur ${a.expected} attendus · ${a.late} en retard · ${a.vacant} lots vacants.` }),
    en: (a) => ({ title: `Rents for ${a.month}`, body: `${a.collected} collected of ${a.expected} expected · ${a.late} late · ${a.vacant} vacant units.` }),
    de: (a) => ({ title: `Mieten ${a.month}`, body: `${a.collected} von ${a.expected} eingegangen · ${a.late} überfällig · ${a.vacant} leere Einheiten.` }),
    lu: (a) => ({ title: `Loyeren ${a.month}`, body: `${a.collected} vun ${a.expected} era · ${a.late} am Verzuch · ${a.vacant} eidel Lotten.` }),
  },
  "message.received": {
    category: "messages",
    fr: (a) => ({ title: a.sender, body: a.preview }),
    en: (a) => ({ title: a.sender, body: a.preview }),
    de: (a) => ({ title: a.sender, body: a.preview }),
    lu: (a) => ({ title: a.sender, body: a.preview }),
  },
  "ticket.new": {
    category: "tickets",
    fr: (a) => ({ title: `${a.emergency ? "Urgence" : "Nouvelle demande"} · ${a.unit}`, body: a.title }),
    en: (a) => ({ title: `${a.emergency ? "Emergency" : "New request"} · ${a.unit}`, body: a.title }),
    de: (a) => ({ title: `${a.emergency ? "Notfall" : "Neue Anfrage"} · ${a.unit}`, body: a.title }),
    lu: (a) => ({ title: `${a.emergency ? "Noutfall" : "Nei Ufro"} · ${a.unit}`, body: a.title }),
  },
  "ticket.sla": {
    category: "tickets",
    fr: (a) => ({ title: `Délai dépassé · ${a.unit}`, body: `${a.title} attend une réponse depuis ${a.days} jours.` }),
    en: (a) => ({ title: `Deadline passed · ${a.unit}`, body: `${a.title} has waited ${a.days} days for an answer.` }),
    de: (a) => ({ title: `Frist verstrichen · ${a.unit}`, body: `${a.title} wartet seit ${a.days} Tagen auf eine Antwort.` }),
    lu: (a) => ({ title: `Frist iwwerschratt · ${a.unit}`, body: `${a.title} waart zënter ${a.days} Deeg op eng Äntwert.` }),
  },
  "ticket.pending_tenant": {
    category: "tickets",
    fr: (a) => ({ title: `Sans réponse du locataire · ${a.unit}`, body: `${a.title} attend le locataire depuis ${a.days} jours. Relancez ou clôturez.` }),
    en: (a) => ({ title: `No answer from the tenant · ${a.unit}`, body: `${a.title} has waited on the tenant for ${a.days} days. Follow up or close.` }),
    de: (a) => ({ title: `Keine Antwort des Mieters · ${a.unit}`, body: `${a.title} wartet seit ${a.days} Tagen auf den Mieter. Nachfassen oder schließen.` }),
    lu: (a) => ({ title: `Keng Äntwert vum Locataire · ${a.unit}`, body: `${a.title} waart zënter ${a.days} Deeg op de Locataire. Nofroen oder zoumaachen.` }),
  },
  "work.scheduled": {
    category: "tickets",
    fr: (a) => ({ title: `Intervention planifiée · ${a.unit}`, body: `${a.title} · ${a.when}${a.artisan ? ` · ${a.artisan}` : ""}` }),
    en: (a) => ({ title: `Work scheduled · ${a.unit}`, body: `${a.title} · ${a.when}${a.artisan ? ` · ${a.artisan}` : ""}` }),
    de: (a) => ({ title: `Einsatz geplant · ${a.unit}`, body: `${a.title} · ${a.when}${a.artisan ? ` · ${a.artisan}` : ""}` }),
    lu: (a) => ({ title: `Asaz geplangt · ${a.unit}`, body: `${a.title} · ${a.when}${a.artisan ? ` · ${a.artisan}` : ""}` }),
  },
  "work.today": {
    category: "tickets",
    fr: (a) => ({ title: `Intervention aujourd'hui · ${a.time}`, body: `${a.title} · ${a.unit}${a.artisan ? ` · ${a.artisan}` : ""}` }),
    en: (a) => ({ title: `Work today · ${a.time}`, body: `${a.title} · ${a.unit}${a.artisan ? ` · ${a.artisan}` : ""}` }),
    de: (a) => ({ title: `Einsatz heute · ${a.time}`, body: `${a.title} · ${a.unit}${a.artisan ? ` · ${a.artisan}` : ""}` }),
    lu: (a) => ({ title: `Asaz haut · ${a.time}`, body: `${a.title} · ${a.unit}${a.artisan ? ` · ${a.artisan}` : ""}` }),
  },
  "work.done": {
    category: "tickets",
    fr: (a) => ({ title: `Intervention terminée · ${a.unit}`, body: `${a.title}${a.amount ? ` · ${a.amount}` : ""}. Vérifiez et clôturez la demande.` }),
    en: (a) => ({ title: `Work completed · ${a.unit}`, body: `${a.title}${a.amount ? ` · ${a.amount}` : ""}. Check and close the request.` }),
    de: (a) => ({ title: `Einsatz abgeschlossen · ${a.unit}`, body: `${a.title}${a.amount ? ` · ${a.amount}` : ""}. Prüfen und Anfrage schließen.` }),
    lu: (a) => ({ title: `Asaz ofgeschloss · ${a.unit}`, body: `${a.title}${a.amount ? ` · ${a.amount}` : ""}. Kontrolléieren an Ufro zoumaachen.` }),
  },
  "invite.accepted": {
    category: "account",
    fr: (a) => ({ title: `${a.name} a rejoint l'espace locataire`, body: `${a.unit}. Les messages et les demandes passent désormais par l'application.` }),
    en: (a) => ({ title: `${a.name} joined the tenant space`, body: `${a.unit}. Messages and requests now come through the app.` }),
    de: (a) => ({ title: `${a.name} ist dem Mieterbereich beigetreten`, body: `${a.unit}. Nachrichten und Anfragen laufen jetzt über die App.` }),
    lu: (a) => ({ title: `${a.name} ass am Locataire-Beräich`, body: `${a.unit}. Messagen an Ufroe lafen elo iwwer d'App.` }),
  },
  "invite.expiring": {
    category: "account",
    fr: (a) => ({ title: `Invitation de ${a.name} expire ${a.when}`, body: `${a.unit}. Renvoyez le lien depuis le bail.` }),
    en: (a) => ({ title: `${a.name}'s invitation expires ${a.when}`, body: `${a.unit}. Resend the link from the lease.` }),
    de: (a) => ({ title: `Einladung an ${a.name} läuft ${a.when} ab`, body: `${a.unit}. Link aus dem Mietvertrag erneut senden.` }),
    lu: (a) => ({ title: `Invitatioun u ${a.name} leeft ${a.when} of`, body: `${a.unit}. Link aus dem Bail nach eng Kéier schécken.` }),
  },
  "lease.ending": {
    category: "deadlines",
    fr: (a) => ({ title: `Bail se termine dans ${a.days} jours · ${a.unit}`, body: `${a.tenant} · fin le ${a.date}. Préparez l'état des lieux de sortie et la restitution de la garantie.` }),
    en: (a) => ({ title: `Lease ends in ${a.days} days · ${a.unit}`, body: `${a.tenant} · ends ${a.date}. Prepare the exit inspection and the deposit return.` }),
    de: (a) => ({ title: `Mietvertrag endet in ${a.days} Tagen · ${a.unit}`, body: `${a.tenant} · Ende am ${a.date}. Auszugsprotokoll und Kautionsrückgabe vorbereiten.` }),
    lu: (a) => ({ title: `Bail leeft an ${a.days} Deeg of · ${a.unit}`, body: `${a.tenant} · Enn den ${a.date}. Etat des lieux an Garantie virbereeden.` }),
  },
  "lease.notice_end": {
    category: "deadlines",
    fr: (a) => ({ title: `Fin de préavis dans ${a.days} jours · ${a.unit}`, body: `${a.tenant} · date légale au plus tôt ${a.date}.` }),
    en: (a) => ({ title: `Notice ends in ${a.days} days · ${a.unit}`, body: `${a.tenant} · earliest lawful end ${a.date}.` }),
    de: (a) => ({ title: `Kündigungsfrist endet in ${a.days} Tagen · ${a.unit}`, body: `${a.tenant} · frühestes rechtmäßiges Ende ${a.date}.` }),
    lu: (a) => ({ title: `Préavis leeft an ${a.days} Deeg of · ${a.unit}`, body: `${a.tenant} · fréisten Datum ${a.date}.` }),
  },
  "lease.draft_idle": {
    category: "deadlines",
    fr: (a) => ({ title: `Bail en brouillon depuis ${a.days} jours · ${a.unit}`, body: `${a.tenant}. Signez-le ou supprimez-le pour libérer le lot.` }),
    en: (a) => ({ title: `Draft lease for ${a.days} days · ${a.unit}`, body: `${a.tenant}. Sign it or delete it to free the unit.` }),
    de: (a) => ({ title: `Vertragsentwurf seit ${a.days} Tagen · ${a.unit}`, body: `${a.tenant}. Unterschreiben oder löschen, um die Einheit freizugeben.` }),
    lu: (a) => ({ title: `Bail-Entworf zënter ${a.days} Deeg · ${a.unit}`, body: `${a.tenant}. Ënnerschreiwen oder läschen fir de Lot fräi ze maachen.` }),
  },
  "deposit.pending": {
    category: "deadlines",
    fr: (a) => ({ title: `Garantie non reçue · ${a.unit}`, body: `${a.tenant} entre le ${a.date}. Pas de clés sans garantie et sans état des lieux signé.` }),
    en: (a) => ({ title: `Deposit not received · ${a.unit}`, body: `${a.tenant} moves in on ${a.date}. No keys without the deposit and a signed inspection.` }),
    de: (a) => ({ title: `Kaution nicht eingegangen · ${a.unit}`, body: `${a.tenant} zieht am ${a.date} ein. Keine Schlüssel ohne Kaution und unterschriebenes Protokoll.` }),
    lu: (a) => ({ title: `Garantie net era · ${a.unit}`, body: `${a.tenant} zitt den ${a.date} an. Keng Schlësselen ouni Garantie an ënnerschriwwenen Etat des lieux.` }),
  },
  "deadline.due": {
    category: "deadlines",
    fr: (a) => ({ title: a.days === "0" ? `Échéance aujourd'hui · ${a.label}` : `Échéance dans ${a.days} jours · ${a.label}`, body: `${a.related ? `${a.related} · ` : ""}${a.date}${a.basis ? ` · ${a.basis}` : ""}` }),
    en: (a) => ({ title: a.days === "0" ? `Due today · ${a.label}` : `Due in ${a.days} days · ${a.label}`, body: `${a.related ? `${a.related} · ` : ""}${a.date}${a.basis ? ` · ${a.basis}` : ""}` }),
    de: (a) => ({ title: a.days === "0" ? `Heute fällig · ${a.label}` : `Fällig in ${a.days} Tagen · ${a.label}`, body: `${a.related ? `${a.related} · ` : ""}${a.date}${a.basis ? ` · ${a.basis}` : ""}` }),
    lu: (a) => ({ title: a.days === "0" ? `Haut fälleg · ${a.label}` : `Fälleg an ${a.days} Deeg · ${a.label}`, body: `${a.related ? `${a.related} · ` : ""}${a.date}${a.basis ? ` · ${a.basis}` : ""}` }),
  },
  "insurance.expiring": {
    category: "deadlines",
    fr: (a) => ({ title: `Assurance expire dans ${a.days} jours · ${a.property}`, body: `${a.kind}${a.provider ? ` · ${a.provider}` : ""} · jusqu'au ${a.date}. Renouvelez avant la fin de couverture.` }),
    en: (a) => ({ title: `Insurance expires in ${a.days} days · ${a.property}`, body: `${a.kind}${a.provider ? ` · ${a.provider}` : ""} · until ${a.date}. Renew before cover ends.` }),
    de: (a) => ({ title: `Versicherung läuft in ${a.days} Tagen ab · ${a.property}`, body: `${a.kind}${a.provider ? ` · ${a.provider}` : ""} · bis ${a.date}. Vor Ende des Schutzes verlängern.` }),
    lu: (a) => ({ title: `Versécherung leeft an ${a.days} Deeg of · ${a.property}`, body: `${a.kind}${a.provider ? ` · ${a.provider}` : ""} · bis ${a.date}. Virdru verlängeren.` }),
  },
  "energy.expiring": {
    category: "deadlines",
    fr: (a) => ({ title: a.expired === "1" ? `Certificat énergétique expiré · ${a.property}` : `Certificat énergétique expire dans ${a.days} jours · ${a.property}`, body: `Passeport énergétique (CPE) établi le ${a.issued}, valable 10 ans. Il est exigé à chaque nouvelle location.` }),
    en: (a) => ({ title: a.expired === "1" ? `Energy certificate expired · ${a.property}` : `Energy certificate expires in ${a.days} days · ${a.property}`, body: `Energy passport (CPE) issued on ${a.issued}, valid 10 years. It is required for every new letting.` }),
    de: (a) => ({ title: a.expired === "1" ? `Energiepass abgelaufen · ${a.property}` : `Energiepass läuft in ${a.days} Tagen ab · ${a.property}`, body: `Energiepass (CPE) vom ${a.issued}, 10 Jahre gültig. Bei jeder Neuvermietung Pflicht.` }),
    lu: (a) => ({ title: a.expired === "1" ? `Energiepass ofgelaf · ${a.property}` : `Energiepass leeft an ${a.days} Deeg of · ${a.property}`, body: `Energiepass (CPE) vum ${a.issued}, 10 Joer gëlteg. Bei all neier Verlocatioun Pflicht.` }),
  },
  "energy.missing": {
    category: "deadlines",
    fr: (a) => ({ title: `Aucun certificat énergétique · ${a.property}`, body: `Le bien est loué sans passeport énergétique enregistré. Ajoutez sa date d'établissement et sa classe.` }),
    en: (a) => ({ title: `No energy certificate · ${a.property}`, body: `The property is let without a recorded energy passport. Add its issue date and class.` }),
    de: (a) => ({ title: `Kein Energiepass · ${a.property}`, body: `Das Objekt ist ohne erfassten Energiepass vermietet. Ausstellungsdatum und Klasse ergänzen.` }),
    lu: (a) => ({ title: `Keen Energiepass · ${a.property}`, body: `D'Immobilie ass ouni registréierten Energiepass verlount. Datum a Klass ergänzen.` }),
  },
  "smoke.unconfirmed": {
    category: "deadlines",
    fr: (a) => ({ title: `Détecteurs de fumée non confirmés · ${a.property}`, body: `Obligatoires dans tout logement loué au Luxembourg. Confirmez leur installation sur la fiche du bien.` }),
    en: (a) => ({ title: `Smoke detectors not confirmed · ${a.property}`, body: `Mandatory in every let dwelling in Luxembourg. Confirm their installation on the property.` }),
    de: (a) => ({ title: `Rauchmelder nicht bestätigt · ${a.property}`, body: `In Luxemburg in jeder vermieteten Wohnung Pflicht. Installation am Objekt bestätigen.` }),
    lu: (a) => ({ title: `Dampmelder net bestätegt · ${a.property}`, body: `Zu Lëtzebuerg an all verlountem Logement Pflicht. Installatioun op der Immobilie bestätegen.` }),
  },
  "bank.synced": {
    category: "bank",
    fr: (a) => ({ title: `Banque synchronisée`, body: `${a.transactions} virements importés · ${a.matched} loyers rapprochés${a.review !== "0" ? ` · ${a.review} à vérifier` : ""}.` }),
    en: (a) => ({ title: `Bank synced`, body: `${a.transactions} transfers imported · ${a.matched} rents matched${a.review !== "0" ? ` · ${a.review} to review` : ""}.` }),
    de: (a) => ({ title: `Bank synchronisiert`, body: `${a.transactions} Überweisungen importiert · ${a.matched} Mieten zugeordnet${a.review !== "0" ? ` · ${a.review} zu prüfen` : ""}.` }),
    lu: (a) => ({ title: `Bank synchroniséiert`, body: `${a.transactions} Iwwerweisungen importéiert · ${a.matched} Loyeren zougeuerdent${a.review !== "0" ? ` · ${a.review} ze kontrolléieren` : ""}.` }),
  },
  "bank.review": {
    category: "bank",
    fr: (a) => ({ title: `${a.count} virements à vérifier`, body: `Des entrées n'ont pas pu être rapprochées d'un loyer. Attribuez-les en une touche.` }),
    en: (a) => ({ title: `${a.count} transfers to review`, body: `Some incoming transfers could not be matched to a rent. Assign them with one tap.` }),
    de: (a) => ({ title: `${a.count} Überweisungen zu prüfen`, body: `Einige Eingänge konnten keiner Miete zugeordnet werden. Mit einem Tipp zuordnen.` }),
    lu: (a) => ({ title: `${a.count} Iwwerweisungen ze kontrolléieren`, body: `E puer Agäng konnten net engem Loyer zougeuerdent ginn. Mat engem Tipp zouuerdnen.` }),
  },
  "bank.consent_expiring": {
    category: "bank",
    fr: (a) => ({ title: a.days === "0" ? `Consentement bancaire expiré · ${a.account}` : `Consentement bancaire expire dans ${a.days} jours · ${a.account}`, body: `Renouvelez l'accès pour que les loyers continuent d'être rapprochés.` }),
    en: (a) => ({ title: a.days === "0" ? `Bank consent expired · ${a.account}` : `Bank consent expires in ${a.days} days · ${a.account}`, body: `Renew the access so rents keep being matched.` }),
    de: (a) => ({ title: a.days === "0" ? `Bankzugang abgelaufen · ${a.account}` : `Bankzugang läuft in ${a.days} Tagen ab · ${a.account}`, body: `Zugang erneuern, damit Mieten weiter zugeordnet werden.` }),
    lu: (a) => ({ title: a.days === "0" ? `Bankzougang ofgelaf · ${a.account}` : `Bankzougang leeft an ${a.days} Deeg of · ${a.account}`, body: `Zougang erneieren, fir datt Loyere weider zougeuerdent ginn.` }),
  },
  "bank.sync_stale": {
    category: "bank",
    fr: (a) => ({ title: `Banque non synchronisée depuis ${a.days} jours`, body: `${a.account}. Ouvrez Finances pour relancer la synchronisation.` }),
    en: (a) => ({ title: `Bank not synced for ${a.days} days`, body: `${a.account}. Open Finance to sync again.` }),
    de: (a) => ({ title: `Bank seit ${a.days} Tagen nicht synchronisiert`, body: `${a.account}. Finanzen öffnen, um neu zu synchronisieren.` }),
    lu: (a) => ({ title: `Bank zënter ${a.days} Deeg net synchroniséiert`, body: `${a.account}. Finanzen opmaachen fir nei ze synchroniséieren.` }),
  },
  "trial.ending": {
    category: "account",
    fr: (a) => ({ title: a.days === "0" ? `Votre essai se termine aujourd'hui` : `Votre essai se termine dans ${a.days} jours`, body: `Votre abonnement démarre ensuite, sauf annulation dans l'App Store.` }),
    en: (a) => ({ title: a.days === "0" ? `Your trial ends today` : `Your trial ends in ${a.days} days`, body: `Your subscription starts after that, unless you cancel in the App Store.` }),
    de: (a) => ({ title: a.days === "0" ? `Ihre Testphase endet heute` : `Ihre Testphase endet in ${a.days} Tagen`, body: `Danach beginnt Ihr Abo, sofern Sie nicht im App Store kündigen.` }),
    lu: (a) => ({ title: a.days === "0" ? `Är Testphas leeft haut of` : `Är Testphas leeft an ${a.days} Deeg of`, body: `Duerno fänkt Ären Abonnement un, ausser Dir kënnegt am App Store.` }),
  },
  // The open setup step, one and three days after the trial started (src/lib/setup.ts decides which step is open).
  "setup.next": {
    category: "account",
    fr: (a) => SETUP.fr[a.step as SetupStep] ?? SETUP.fr.property,
    en: (a) => SETUP.en[a.step as SetupStep] ?? SETUP.en.property,
    de: (a) => SETUP.de[a.step as SetupStep] ?? SETUP.de.property,
    lu: (a) => SETUP.lu[a.step as SetupStep] ?? SETUP.lu.property,
  },
  "test": {
    category: "account",
    fr: () => ({ title: "Les notifications fonctionnent", body: "Vous recevrez ici les loyers, les messages et les rappels." }),
    en: () => ({ title: "Notifications are working", body: "Rents, messages and reminders will arrive here." }),
    de: () => ({ title: "Benachrichtigungen funktionieren", body: "Mieten, Nachrichten und Erinnerungen kommen hier an." }),
    lu: () => ({ title: "Notifikatiounen funktionéieren", body: "Loyeren, Messagen an Erënnerungen kommen hei un." }),
  },
} satisfies Record<string, { category: Category } & T>;

export type Kind = keyof typeof KINDS;

export function render(kind: Kind, lang: string, args: Record<string, string>): Text {
  const k = KINDS[kind];
  const l: Lang = lang === "en" || lang === "de" || lang === "lu" ? lang : "fr";
  return k[l](args);
}

export const categoryOf = (kind: Kind): Category => KINDS[kind].category;

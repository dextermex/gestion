import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Generate the hosted Supabase templates and a safe, token-free design preview.
// No external images, tracking, web fonts, JavaScript or client-specific effects.
const copy = {
  fr: {
    lang: "fr", eyebrow: "VOTRE COMPTE MORADA", footer: "Vos locations, simplement.",
    ignore: "Vous n’êtes pas à l’origine de cette demande ? Ignorez cet e-mail. Ne partagez pas ce lien.",
    fallback: "Le bouton ne fonctionne pas ? Ouvrez ce lien dans votre navigateur :",
    confirmation: ["Confirmez votre adresse e-mail", "Bienvenue chez Morada.", "Encore une étape : confirmez votre adresse e-mail pour votre compte Morada.", "Confirmer mon adresse"],
    email_change: ["Confirmez votre adresse e-mail Morada", "La bonne adresse, pour vous.", "Confirmez cette adresse e-mail pour l’associer à votre compte Morada. Si vous remplacez une adresse existante, une confirmation sur les deux adresses peut être nécessaire.", "Confirmer mon adresse"],
    recovery: ["Réinitialisez votre mot de passe Morada", "Retrouvons votre compte.", "Vous avez demandé un nouveau mot de passe. Choisissez-en un en suivant le lien ci-dessous.", "Choisir un mot de passe"],
    magic_link: ["Votre lien de connexion Morada", "Heureux de vous retrouver.", "Utilisez ce lien personnel pour vous connecter à Morada.", "Me connecter"],
  },
  en: {
    lang: "en", eyebrow: "YOUR MORADA ACCOUNT", footer: "Renting, made simple.",
    ignore: "Didn’t request this? You can ignore this email. Keep this link to yourself.",
    fallback: "Button not working? Open this link in your browser:",
    confirmation: ["Confirm your email address", "Welcome to Morada.", "One more step: confirm your email address for your Morada account.", "Confirm email address"],
    email_change: ["Confirm your Morada email address", "The right address for you.", "Confirm this email address to use it with your Morada account. If you are replacing an existing address, you may need to confirm both addresses.", "Confirm email address"],
    recovery: ["Reset your Morada password", "Let’s get you back in.", "You asked for a new password. Follow the link below to choose one.", "Choose a new password"],
    magic_link: ["Your Morada sign-in link", "Welcome back.", "Use this personal link to sign in to Morada.", "Sign in to Morada"],
  },
  de: {
    lang: "de", eyebrow: "IHR MORADA-KONTO", footer: "Vermieten, einfach gemacht.",
    ignore: "Sie haben dies nicht angefordert? Ignorieren Sie diese E-Mail. Teilen Sie diesen Link nicht.",
    fallback: "Der Button funktioniert nicht? Öffnen Sie diesen Link im Browser:",
    confirmation: ["Bestätigen Sie Ihre E-Mail-Adresse", "Willkommen bei Morada.", "Noch ein Schritt: Bestätigen Sie Ihre E-Mail-Adresse für Ihr Morada-Konto.", "E-Mail-Adresse bestätigen"],
    email_change: ["Bestätigen Sie Ihre Morada-E-Mail-Adresse", "Die richtige Adresse für Sie.", "Bestätigen Sie diese E-Mail-Adresse für Ihr Morada-Konto. Wenn Sie eine bestehende Adresse ersetzen, müssen Sie gegebenenfalls beide Adressen bestätigen.", "E-Mail-Adresse bestätigen"],
    recovery: ["Setzen Sie Ihr Morada-Passwort zurück", "Zurück zu Ihrem Konto.", "Sie haben ein neues Passwort angefordert. Über den folgenden Link können Sie eines festlegen.", "Neues Passwort wählen"],
    magic_link: ["Ihr Morada-Anmeldelink", "Willkommen zurück.", "Melden Sie sich über diesen persönlichen Link bei Morada an.", "Bei Morada anmelden"],
  },
  lu: {
    lang: "lb", eyebrow: "ÄRE MORADA-KONT", footer: "Verlounen, einfach gemaach.",
    ignore: "Dir hutt dat net ugefrot? Ignoréiert dës E-Mail. Deelt dëse Link net mat aneren.",
    fallback: "De Knäppchen funktionéiert net? Maacht dëse Link an Ärem Browser op:",
    confirmation: ["Bestätegt Är E-Mail-Adress", "Wëllkomm bei Morada.", "Nach ee Schrëtt: Bestätegt Är E-Mail-Adress fir Äre Morada-Kont.", "E-Mail-Adress bestätegen"],
    email_change: ["Bestätegt Är Morada-E-Mail-Adress", "Déi richteg Adress fir Iech.", "Bestätegt dës E-Mail-Adress fir Äre Morada-Kont. Wann Dir eng bestoend Adress ersetzt, musst Dir eventuell béid Adresse bestätegen.", "E-Mail-Adress bestätegen"],
    recovery: ["Setzt Äert Morada-Passwuert zréck", "Zréck an Äre Kont.", "Dir hutt en neit Passwuert ugefrot. Iwwer de Link hei drënner kënnt Dir en neit wielen.", "En neit Passwuert wielen"],
    magic_link: ["Äre Morada-Umeldungslink", "Wëllkomm zeréck.", "Benotzt dëse perséinleche Link fir Iech bei Morada unzemellen.", "Bei Morada umellen"],
  },
};

const escape = (s) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function localized(select) {
  return ["en", "de", "lu"].map((lang, i) => `{{ ${i ? "else if" : "if"} eq .Data.preferred_language "${lang}" }}${escape(select(copy[lang]))}`).join("") + `{{ else }}${escape(select(copy.fr))}{{ end }}`;
}
// Hosted Auth limits the unrendered subject template to 255 characters.
// Bind the language once so all four translations fit that limit.
function localizedSubject(kind) {
  const subject = '{{$l := .Data.preferred_language}}' +
    ["en", "de", "lu"].map((lang, i) => `{{${i ? "else if" : "if"} eq $l "${lang}"}}${copy[lang][kind][0]}`).join("") +
    `{{else}}${copy.fr[kind][0]}{{end}}`;
  if (subject.length > 255) throw new Error(`Auth subject exceeds 255 characters: ${kind}`);
  return subject;
}
function render(kind, preview = false) {
  const t = (select) => preview ? escape(select(copy.en)) : localized(select);
  const link = preview ? "https://app.morada.lu/inscription" : "{{ .ConfirmationURL }}";
  return `<!doctype html>
<html lang="${t(c => c.lang)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${t(c => c[kind][0])}</title></head>
<body style="margin:0;padding:0;background:#f6f3ee;color:#173d42;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${t(c => c[kind][2])}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f6f3ee"><tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="560"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
<tr><td style="padding:4px 8px 30px;"><a href="https://www.morada.lu" style="font-size:30px;font-weight:700;letter-spacing:-1.4px;color:#10505c;text-decoration:none;">morada<span style="color:#c64a29;">.</span></a></td></tr>
<tr><td bgcolor="#ffffff" style="padding:36px 28px 32px;border:1px solid #e9e5dd;border-radius:24px;">
<p style="margin:0 0 22px;color:#596b6c;font-size:11px;font-weight:700;letter-spacing:1.8px;">${t(c => c.eyebrow)}</p>
<h1 style="margin:0 0 18px;color:#173d42;font-size:32px;line-height:1.18;font-weight:700;letter-spacing:-1px;">${t(c => c[kind][1])}</h1>
<p style="margin:0 0 30px;color:#526467;font-size:16px;line-height:1.7;">${t(c => c[kind][2])}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#10505c" style="border-radius:28px;mso-padding-alt:18px 26px;"><a href="${link}" style="display:inline-block;padding:18px 26px;font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:28px;">${t(c => c[kind][3])}</a></td></tr></table>
<p style="margin:30px 0 0;color:#697577;font-size:13px;line-height:1.6;">${t(c => c.ignore)}</p>
</td></tr>
<tr><td style="padding:26px 8px 0;"><p style="margin:0 0 8px;color:#5d6f70;font-size:12px;line-height:1.6;">${t(c => c.fallback)}</p><a href="${link}" style="color:#10505c;font-size:12px;line-height:1.6;word-break:break-all;overflow-wrap:anywhere;">${link}</a></td></tr>
<tr><td style="padding:30px 8px 8px;color:#697577;font-size:12px;line-height:1.7;">Morada · ${t(c => c.footer)}<br><a href="https://www.morada.lu" style="color:#697577;text-decoration:underline;">morada.lu</a></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>
`;
}

const directory = fileURLToPath(new URL("../supabase/templates/", import.meta.url));
mkdirSync(directory, { recursive: true });
const subjects = {};
for (const kind of ["confirmation", "email_change", "recovery", "magic_link"]) {
  writeFileSync(directory + kind + ".html", render(kind));
  subjects[kind] = localizedSubject(kind);
}
writeFileSync(directory + "subjects.json", JSON.stringify(subjects, null, 2) + "\n");
writeFileSync(fileURLToPath(new URL("../docs/auth-email-preview.html", import.meta.url)), render("confirmation", true));

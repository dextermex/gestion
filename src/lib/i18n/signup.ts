import type { Locale } from "./config";
import { signupFr, type SignupCopy } from "./signup-fr";
export type { SignupCopy } from "./signup-fr";
const en: SignupCopy = {
  "or": "or",
  "confirmPhone": "Is this number correct?",
  "confirmPhoneBody": "We’ll send your confirmation code to this number.",
  "sendCode": "Confirm and send code",
  "emailConfirmed": "Email confirmed",
  "socialLinked": "Your email is confirmed. You can also use this account to sign in.",
  "linkError": "We couldn’t connect this account. Try again, enter your email, or sign in to your existing account.",
  "loginTitle": "Welcome back",
  "loginIntro": "Enter the email linked to your Morada account.",
  "passwordTitle": "Your password",
  "password": "Password",
  "forgotPassword": "Forgot password?",
  "wrongPassword": "Incorrect email or password. Try again.",
  "socialNoAccount": "Create your account with your phone number first. You can then connect Google or Apple.",
  "google": "Continue with Google",
  "apple": "Continue with Apple",
  "noAccount": "Don’t have an account?",
  "createAccount": "Create one",
  "socialError": "Sign-in wasn’t completed. Try again or choose another method.",
  "pageTitle": "Create your Morada account",
  "secure": "Secure your account",
  "phoneIntro": "Enter your mobile number. We’ll text you a confirmation code.",
  "phone": "Phone number",
  "country": "Country code",
  "countries": "Choose your country",
  "searchCountry": "Search country or calling code",
  "noCountries": "No countries found.",
  "continue": "Continue",
  "verify": "Verify my number",
  "working": "One moment…",
  "login": "Log in",
  "phoneLogin": "Log in with your phone",
  "emailLogin": "Log in with email",
  "haveAccount": "Already have an account?",
  "back": "Back",
  "close": "Close",
  "editNumber": "Change number",
  "privacyNote": "Your number is for sign-in and security. No marketing texts.",
  "codeTitle": "Check your messages",
  "codeIntro": "Enter the 6-digit code we sent to",
  "code": "Verification code",
  "resend": "Resend code",
  "noCode": "Didn’t receive it?",
  "resendIn": "Resend in {seconds}s",
  "resent": "A new code is on its way.",
  "roleTitle": "How will you use Morada?",
  "roleIntro": "Choose the space that’s right for you.",
  "landlord": "I’m a landlord",
  "landlordBody": "Keep track of rent, documents and the places I let.",
  "tenant": "I’m a tenant",
  "tenantBody": "Access my tenancy, stay in touch and report issues.",
  "nameTitle": "What’s your name?",
  "nameIntro": "This name will appear on your account.",
  "firstName": "First name",
  "lastName": "Last name",
  "emailTitle": "Add your email",
  "emailIntro": "For important account updates and your email confirmation.",
  "email": "Email address",
  "emailPending": "Check your inbox to confirm your email. You can still sign in with your phone.",
  "involvement": [
    "Around 1 hour a week",
    "Around 5 hours a week",
    "Around 20 hours a week",
    "40 hours a week or more"
  ],
  "skip": "Skip for now",
  "welcomeTitle": "You’re all set, {name}.",
  "welcomeIntro": "Your account is ready. Let’s start with your first property.",
  "tenantWelcome": "Your account is ready. Open your landlord’s invitation to connect to your rental.",
  "enter": "Open my space",
  "enterTenant": "Open my tenant space",
  "verified": "Phone verified",
  "saved": "Your details are saved.",
  "progress": "Signup progress",
  "language": "Language",
  "sideTitle": "Rental life.\nSimplified.",
  "sideBody": "Your properties, rent and conversations.\nOne place for it all.",
  "sideFoot": "Made for rental life in Luxembourg.",
  "sideLabel": "Morada Gestion",
  "termsPrefix": "By continuing, you agree to our",
  "terms": "Terms",
  "and": "and acknowledge our",
  "privacy": "Privacy Policy",
  "invalidPhone": "Check your phone number and country code so we can send your code.",
  "invalidCode": "Enter the 6 digits from your text message.",
  "expiredCode": "That code is incorrect or has expired. Try again or request a new one.",
  "requiredName": "Enter your first and last name.",
  "invalidEmail": "Enter a valid email address.",
  "selectOption": "Choose an answer to continue.",
  "unavailable": "We can’t connect right now. Please try again in a moment.",
  "emailCodeTitle": "Check your inbox",
  "verifyEmail": "Verify my email",
  "emailCodeIntro": "Enter the 6-digit code we sent to",
  "emailCodeHint": "You can also click the link in the email. This page continues on its own.",
  "resendEmail": "Resend email",
  "emailResent": "A new email is on its way.",
  "changeEmail": "Change address",
  "createPasswordTitle": "Create your password",
  "createPasswordIntro": "You’ll sign in with {email} and this password. At least 8 characters.",
  "confirmPassword": "Confirm password",
  "passwordMismatch": "The two passwords don’t match.",
  "emailUnconfirmed": "Confirm your email first, with the code or link we sent.",
  "passwordRequired": "Create your password first.",
  "passwordAlreadySet": "This account already has a password. To change it, ask for a reset link from the sign-in page.",
  "phoneCodeIfAccount": "If an account uses this number, a code has just been sent to it.",
  "emailCodeOtherAccount": "No code after a few minutes? This address may already belong to another account: sign in with it, or choose another address.",
  "smsFailed": "We couldn’t send a text to this number. Check it, or try again in a few minutes.",
  "phoneUnavailable": "Phone sign-up is temporarily unavailable. Please try again later.",
  "noPhoneAccount": "No account uses this number yet. Create your account to get started.",
  "networkError": "Your connection dropped. Check your network and try again.",
  "emailNotConfirmed": "Confirm your email first, using the link we sent you.",
  "resetSent": "If an account uses this address, a reset link is on its way.",
  "resetTitle": "Choose a new password",
  "resetIntro": "Use at least 8 characters.",
  "newPassword": "New password",
  "savePassword": "Save password",
  "weakPassword": "That password is too weak. Use at least 8 characters, with letters and numbers.",
  "samePassword": "Choose a password different from your previous one.",
  "resetExpired": "This reset link has expired. Request a new one.",
  "setupUnavailable": "Sign-up is temporarily unavailable. Please try again shortly.",
  "rateLimited": "Too many attempts. Wait a minute, then try again.",
  "captchaError": "The security check couldn’t finish. Please try again.",
  "captchaLoading": "Checking your connection…",
  "captchaRetry": "Retry security check",
  "emailExists": "This email can’t be added. Use another address or log in to your existing account.",
  "sessionExpired": "Your session has expired. Log in to pick up where you left off.",
  "saveFailed": "We couldn’t save your details. Please try again.",
  "existingTitle": "You’re already at home.",
  "existingIntro": "You’re signed in as {account}.",
  "useAccount": "Continue with this account",
  "otherAccount": "Use another account",
  "preview": "Interactive preview. No texts sent or accounts created.",
  "previewCode": "For this preview, use code 123456.",
  "previewDone": "Preview complete. No data was saved.",
  "restart": "Restart preview",
  "previewSecurity": "Preview: security check is simulated.",
  "onboarding": {
    "quiz": {
      "kind": {
        "title": "What do you let?",
        "intro": "To show you the right screens.",
        "options": {
          "flats": "Flats",
          "houses": "Houses",
          "building": "A whole building",
          "mixed": "A bit of everything"
        }
      },
      "manage": {
        "title": "You manage for…",
        "intro": "Everyone has their own pace.",
        "options": {
          "self": "Myself",
          "family": "My family or a family company",
          "clients": "Clients, I am a manager"
        }
      },
      "units": {
        "title": "How many units, roughly?",
        "intro": "Flats, houses, studios, parking spaces.",
        "options": {
          "0": "No unit yet",
          "1": "1 unit",
          "2-5": "2 to 5 units",
          "6-10": "6 to 10 units",
          "11-20": "11 to 20 units",
          "21-50": "21 to 50 units"
        }
      },
      "rent": {
        "title": "And your rents, on average?",
        "intro": "Per unit, excluding charges. An estimate is enough.",
        "options": [
          "Under €1,000",
          "€1,000 to €1,499",
          "€1,500 to €1,999",
          "€2,000 to €2,999",
          "€3,000 and above"
        ]
      },
      "where": {
        "title": "Where are your properties?",
        "intro": "The rules differ from place to place.",
        "options": {
          "lu": "Luxembourg",
          "be": "Belgium",
          "fr": "France",
          "de": "Germany",
          "multi": "Several countries"
        }
      },
      "today": {
        "title": "How do you manage today?",
        "intro": "To start from where you are.",
        "options": {
          "spreadsheet": "A spreadsheet",
          "software": "Other software",
          "paper": "Paper and email",
          "starting": "I am starting out"
        }
      },
      "challenge": {
        "title": "What weighs on you most?",
        "intro": "We start with that.",
        "options": {
          "rent": {
            "label": "Chasing late rent",
            "sub": "And checking every transfer on the account"
          },
          "documents": {
            "label": "Leases, inventories, documents",
            "sub": "Finding everything when it is needed"
          },
          "compliance": {
            "label": "Indexation, charges, deadlines",
            "sub": "Missing nothing, losing nothing"
          },
          "finances": {
            "label": "Income, expenses, tax return",
            "sub": "Knowing where I stand, without a spreadsheet"
          },
          "maintenance": {
            "label": "Requests and repairs",
            "sub": "The calls, the quotes, the follow-ups"
          }
        }
      },
      "time": {
        "title": "How much time does it take you?",
        "intro": "Per week, roughly."
      },
      "late": {
        "title": "When rent is late, you find out…",
        "intro": "Be honest, it helps us tune the app.",
        "options": {
          "same_day": "The same day",
          "days": "After a few days",
          "month_end": "At the end of the month",
          "never": "Sometimes never"
        }
      },
      "goal": {
        "title": "Your goal this year?",
        "intro": "Just one, the one that matters most.",
        "options": {
          "rent": "Stop chasing rent",
          "everything": "Have everything in one place",
          "time": "Spend less time on it",
          "tax": "Prepare my tax return without stress",
          "grow": "Let one more property"
        }
      },
      "source": {
        "title": "Where did you hear about Morada?",
        "intro": "It helps us find people like you.",
        "options": {
          "instagram": "Instagram",
          "tiktok": "TikTok",
          "word": "A friend or colleague",
          "search": "A Google search",
          "press": "The press or an article",
          "other": "Other"
        }
      }
    },
    "interests": {
      "groups": {
        "first": "See first",
        "horizon": "Your horizon",
        "watch": "Keep a close eye on"
      },
      "horizons": {
        "month": "The month",
        "year": "The year"
      },
      "watches": {
        "arrears": "Late payments",
        "vacancy": "Vacant units",
        "edl_exit": "Leases ending",
        "ticket": "Urgent repairs",
        "invite": "Tenant spaces"
      },
      "title": "What matters to you?",
      "intro": "Your Home adapts to your answers.",
      "chosen": {
        "one": "1 chosen",
        "many": "{n} chosen"
      },
      "chips": {
        "arrears": "Unpaid rent",
        "cashflow": "Cash flow",
        "actions": "To do",
        "costs": "Costs",
        "requests": "Requests",
        "activity": "Activity"
      }
    },
    "potential": {
      "title": "You have what it takes.",
      "intro": "Here is your first month with Morada, as it happens.",
      "introGoal": "Your goal: {goal}. Here is your first month with Morada, as it happens.",
      "chart": "Your first month",
      "steps": {
        "w1": "Week 1",
        "w1Body": "Bank connected, rents matched on their own",
        "w2": "Week 2",
        "w2Body": "Delays flagged the same day, the reminder ready",
        "m1": "Month 1",
        "m1Body": "The month closed, every euro in its place"
      },
      "foot": "Nothing to type each month: your transfers do the work.",
      "cta": "Continue"
    },
    "reviews": {
      "title": "Landlords like you already manage their rents here",
      "rating": "landlord reviews",
      "cta": "Continue"
    },
    "setup": {
      "title": "Building your space",
      "intro": "Personalised from your answers.",
      "items": {
        "answers": "Your answers read: {challenge}",
        "home": "Your home screen: {sections}",
        "alerts": "Your alerts: {watch}",
        "price": "Your price for {n}"
      },
      "retry": "Try again"
    },
    "ready": {
      "title": "Your plan is ready.",
      "intro": "Tuned to what weighs on you: {challenge}.",
      "goal": "Goal: {goal}",
      "home": "Home",
      "cta": "Continue",
      "foot": "Your free 30-day trial starts right after.",
      "rows": {
        "rent": [
          "Every transfer matched to the right rent",
          "A late rent flagged the same day",
          "One-tap reminder, text ready"
        ],
        "documents": [
          "One file per tenancy: lease, inventory, papers",
          "Inventory signed on site, sealed as PDF",
          "Everything findable from your phone"
        ],
        "compliance": [
          "Indexation calculated, letter ready",
          "Guided service-charge statement",
          "Legal deadlines reminded in time"
        ],
        "finances": [
          "Money in and out, month by month",
          "Expenses captured by photographing the receipt",
          "A yearly view ready for the tax return"
        ],
        "maintenance": [
          "Tenant requests in one place",
          "Emergencies flagged in red",
          "History per home"
        ]
      }
    },
    "tryFree": {
      "title": "We want you to try Morada for free.",
      "cta": "Try for free",
      "shot": "Morada’s home screen on a phone, with sample figures"
    },
    "reminder": {
      "title": "We will remind you before your trial ends.",
      "intro": "By email, two days before it ends.",
      "cta": "Continue for free"
    },
    "offer": {
      "noPayment": "No payment due now",
      "onUsTitle": "Your first {days} days are on us.",
      "tl": {
        "today": "Today",
        "todayBody": "Full access to every feature.",
        "inDays": "In {days} days",
        "remindBody": "A reminder by email that your trial is about to end.",
        "startBody": "Your subscription starts, unless you cancel before then."
      },
      "tryThen": "Try {days} days free, then",
      "periodYear": "per year",
      "periodQuarter": "per quarter",
      "monthlyEq": "({amount} per month)",
      "priceFor": "Price for {units}",
      "lots": {
        "one": "1 unit",
        "many": "{n} units"
      },
      "understand": "Understand my price",
      "start": "Start my {days} free days",
      "noCharge": "No payment today. Cancel anytime.",
      "notNow": "Not now",
      "nowTitle": "Your subscription starts today.",
      "nowSub": "This account has already had its free days.",
      "startNow": "Start my subscription",
      "finePrintNow": "{amount} {period}, charged today and renewed automatically. Cancel anytime.",
      "checkoutFailed": "The payment page couldn’t open. Try again in a moment.",
      "unavailable": "Online payment is unavailable for now. Try again later.",
      "retry": "Try again",
      "scalesTitle": "A price that scales with you",
      "perUnitLine": "{perUnit} per unit per month, rent excluding charges. Lower from the 6th unit.",
      "adjustLots": "Number of lots",
      "adjustRent": "Average rent per lot",
      "rhythm": "Billing",
      "plans": {
        "year": "Yearly",
        "quarter": "Quarterly"
      },
      "twoMonths": "2 months free",
      "launchNote": "Launch prices, still being validated: they may change.",
      "done": "Done",
      "close": "Close"
    },
    "winback": {
      "eyebrow": "Your one-time offer",
      "badge": "{pct}% off",
      "title": "{pct}% off\nyour first year",
      "sub": "It goes when you leave this screen. Still €0 today, and 30 days free.",
      "subCharged": "It goes when you leave this screen. Charged today, cancel anytime.",
      "plan": "Yearly · 12 months",
      "firstYear": "{amount} the first year, then {full} per year",
      "perMonth": "per month",
      "cta": "Start my {days} free days",
      "ctaCharged": "Take the offer",
      "noCommit": "No commitment, cancel anytime",
      "decline": "No thanks"
    },
    "progressLabel": "Step {current} of {total}"
  }
};
const de: SignupCopy = {
  "or": "oder",
  "confirmPhone": "Ist diese Nummer richtig?",
  "confirmPhoneBody": "Wir senden Ihren Bestätigungscode an diese Nummer.",
  "sendCode": "Bestätigen und Code senden",
  "emailConfirmed": "E-Mail bestätigt",
  "socialLinked": "Ihre E-Mail ist bestätigt. Sie können sich auch mit diesem Konto anmelden.",
  "linkError": "Dieses Konto konnte nicht verknüpft werden. Versuchen Sie es erneut, geben Sie Ihre E-Mail ein oder melden Sie sich bei Ihrem bestehenden Konto an.",
  "loginTitle": "Willkommen zurück",
  "loginIntro": "Geben Sie die E-Mail Ihres Morada-Kontos ein.",
  "passwordTitle": "Ihr Passwort",
  "password": "Passwort",
  "forgotPassword": "Passwort vergessen?",
  "wrongPassword": "E-Mail oder Passwort falsch. Versuchen Sie es erneut.",
  "socialNoAccount": "Erstellen Sie Ihr Konto zuerst mit Ihrer Telefonnummer. Danach können Sie Google oder Apple verknüpfen.",
  "google": "Mit Google fortfahren",
  "apple": "Mit Apple fortfahren",
  "noAccount": "Noch kein Konto?",
  "createAccount": "Konto erstellen",
  "socialError": "Die Anmeldung wurde nicht abgeschlossen. Versuchen Sie es erneut oder wählen Sie eine andere Methode.",
  "pageTitle": "Morada-Konto erstellen",
  "secure": "Sichern Sie Ihr Konto",
  "phoneIntro": "Geben Sie Ihre Handynummer ein. Wir senden Ihnen einen Bestätigungscode.",
  "phone": "Telefonnummer",
  "country": "Vorwahl",
  "countries": "Land auswählen",
  "searchCountry": "Land oder Vorwahl suchen",
  "noCountries": "Keine Länder gefunden.",
  "continue": "Weiter",
  "verify": "Nummer bestätigen",
  "working": "Einen Moment…",
  "login": "Anmelden",
  "phoneLogin": "Mit Telefonnummer anmelden",
  "emailLogin": "Mit E-Mail anmelden",
  "haveAccount": "Schon ein Konto?",
  "back": "Zurück",
  "close": "Schließen",
  "editNumber": "Nummer ändern",
  "privacyNote": "Ihre Nummer dient der Anmeldung und Sicherheit. Keine Werbe-SMS.",
  "codeTitle": "Prüfen Sie Ihre Nachrichten",
  "codeIntro": "Geben Sie den 6-stelligen Code ein. Gesendet an",
  "code": "Bestätigungscode",
  "resend": "Code erneut senden",
  "noCode": "Nichts erhalten?",
  "resendIn": "Erneut senden in {seconds} s",
  "resent": "Ein neuer Code ist unterwegs.",
  "roleTitle": "Wie nutzen Sie Morada?",
  "roleIntro": "Wählen Sie den passenden Bereich.",
  "landlord": "Ich vermiete",
  "landlordBody": "Mieten, Unterlagen und meine Immobilien verwalten.",
  "tenant": "Ich miete",
  "tenantBody": "Meine Mietunterlagen einsehen, Nachrichten senden und Probleme melden.",
  "nameTitle": "Wie heißen Sie?",
  "nameIntro": "Dieser Name erscheint in Ihrem Konto.",
  "firstName": "Vorname",
  "lastName": "Nachname",
  "emailTitle": "Ihre E-Mail-Adresse",
  "emailIntro": "Für wichtige Kontonachrichten und die Bestätigung Ihrer Adresse.",
  "email": "E-Mail-Adresse",
  "emailPending": "Bestätigen Sie Ihre E-Mail-Adresse über den Link im Posteingang. Die Anmeldung per Telefon bleibt möglich.",
  "involvement": [
    "Etwa 1 Stunde pro Woche",
    "Etwa 5 Stunden pro Woche",
    "Etwa 20 Stunden pro Woche",
    "40 Stunden pro Woche oder mehr"
  ],
  "skip": "Vorerst überspringen",
  "welcomeTitle": "Willkommen, {name}.",
  "welcomeIntro": "Ihr Konto ist bereit. Beginnen wir mit Ihrer ersten Immobilie.",
  "tenantWelcome": "Ihr Konto ist bereit. Öffnen Sie die Einladung Ihres Vermieters, um Ihre Mietunterlagen zu sehen.",
  "enter": "Meinen Bereich öffnen",
  "enterTenant": "Meinen Mietbereich öffnen",
  "verified": "Nummer bestätigt",
  "saved": "Ihre Angaben sind gespeichert.",
  "progress": "Fortschritt der Registrierung",
  "language": "Sprache",
  "sideTitle": "Vermieten.\nEinfacher.",
  "sideBody": "Immobilien, Mieten und Nachrichten.\nAlles an einem Ort.",
  "sideFoot": "Für den Mietalltag in Luxemburg.",
  "sideLabel": "Morada Gestion",
  "termsPrefix": "Indem Sie fortfahren, akzeptieren Sie die",
  "terms": "Nutzungsbedingungen",
  "and": "und bestätigen die Kenntnisnahme unserer",
  "privacy": "Datenschutzerklärung",
  "invalidPhone": "Prüfen Sie Ihre Telefonnummer und Vorwahl.",
  "invalidCode": "Geben Sie die 6 Ziffern aus der SMS ein.",
  "expiredCode": "Dieser Code ist falsch oder abgelaufen. Versuchen Sie es erneut oder fordern Sie einen neuen an.",
  "requiredName": "Geben Sie Ihren Vor- und Nachnamen ein.",
  "invalidEmail": "Geben Sie eine gültige E-Mail-Adresse ein.",
  "selectOption": "Wählen Sie eine Antwort aus.",
  "unavailable": "Verbindung momentan nicht möglich. Versuchen Sie es gleich erneut.",
  "emailCodeTitle": "Prüfen Sie Ihr Postfach",
  "verifyEmail": "E-Mail bestätigen",
  "emailCodeIntro": "Geben Sie den 6-stelligen Code ein, den wir gesendet haben an",
  "emailCodeHint": "Sie können auch auf den Link in der E-Mail klicken. Diese Seite geht dann von selbst weiter.",
  "resendEmail": "E-Mail erneut senden",
  "emailResent": "Eine neue E-Mail ist unterwegs.",
  "changeEmail": "Adresse ändern",
  "createPasswordTitle": "Passwort erstellen",
  "createPasswordIntro": "Sie melden sich mit {email} und diesem Passwort an. Mindestens 8 Zeichen.",
  "confirmPassword": "Passwort bestätigen",
  "passwordMismatch": "Die beiden Passwörter stimmen nicht überein.",
  "emailUnconfirmed": "Bestätigen Sie zuerst Ihre E-Mail mit dem Code oder dem Link.",
  "passwordRequired": "Erstellen Sie zuerst Ihr Passwort.",
  "passwordAlreadySet": "Dieses Konto hat bereits ein Passwort. Um es zu ändern, fordern Sie auf der Anmeldeseite einen Link zum Zurücksetzen an.",
  "phoneCodeIfAccount": "Falls ein Konto diese Nummer verwendet, wurde soeben ein Code an sie gesendet.",
  "emailCodeOtherAccount": "Nach einigen Minuten kein Code? Diese Adresse gehört möglicherweise bereits zu einem anderen Konto: Melden Sie sich damit an oder wählen Sie eine andere Adresse.",
  "smsFailed": "Wir konnten keine SMS an diese Nummer senden. Prüfen Sie sie oder versuchen Sie es in ein paar Minuten erneut.",
  "phoneUnavailable": "Die Registrierung per Telefon ist vorübergehend nicht verfügbar. Bitte versuchen Sie es später erneut.",
  "noPhoneAccount": "Mit dieser Nummer ist noch kein Konto verbunden. Erstellen Sie Ihr Konto, um zu beginnen.",
  "networkError": "Die Verbindung wurde unterbrochen. Prüfen Sie Ihr Netzwerk und versuchen Sie es erneut.",
  "emailNotConfirmed": "Bestätigen Sie zuerst Ihre E-Mail-Adresse über den Link, den wir Ihnen gesendet haben.",
  "resetSent": "Falls ein Konto mit dieser Adresse existiert, ist ein Link zum Zurücksetzen unterwegs.",
  "resetTitle": "Neues Passwort",
  "resetIntro": "Verwenden Sie mindestens 8 Zeichen.",
  "newPassword": "Neues Passwort",
  "savePassword": "Passwort speichern",
  "weakPassword": "Dieses Passwort ist zu schwach. Verwenden Sie mindestens 8 Zeichen mit Buchstaben und Ziffern.",
  "samePassword": "Wählen Sie ein anderes Passwort als bisher.",
  "resetExpired": "Dieser Link ist abgelaufen. Fordern Sie einen neuen an.",
  "setupUnavailable": "Die Registrierung ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in Kürze erneut.",
  "rateLimited": "Zu viele Versuche. Warten Sie eine Minute.",
  "captchaError": "Die Sicherheitsprüfung ist fehlgeschlagen. Versuchen Sie es erneut.",
  "captchaLoading": "Sicherheitsprüfung…",
  "captchaRetry": "Sicherheitsprüfung wiederholen",
  "emailExists": "Diese Adresse kann nicht hinzugefügt werden. Nutzen Sie eine andere oder melden Sie sich bei Ihrem bestehenden Konto an.",
  "sessionExpired": "Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an.",
  "saveFailed": "Ihre Angaben konnten nicht gespeichert werden. Versuchen Sie es erneut.",
  "existingTitle": "Sie sind schon zu Hause.",
  "existingIntro": "Sie sind als {account} angemeldet.",
  "useAccount": "Mit diesem Konto fortfahren",
  "otherAccount": "Anderes Konto verwenden",
  "preview": "Interaktive Vorschau. Keine SMS und keine Kontoerstellung.",
  "previewCode": "Verwenden Sie in der Vorschau den Code 123456.",
  "previewDone": "Vorschau abgeschlossen. Es wurden keine Daten gespeichert.",
  "restart": "Vorschau neu starten",
  "previewSecurity": "Vorschau: Sicherheitsprüfung simuliert.",
  "onboarding": {
    "quiz": {
      "kind": {
        "title": "Was vermieten Sie?",
        "intro": "Damit wir Ihnen die richtigen Ansichten zeigen.",
        "options": {
          "flats": "Wohnungen",
          "houses": "Häuser",
          "building": "Ein ganzes Gebäude",
          "mixed": "Von allem etwas"
        }
      },
      "manage": {
        "title": "Sie verwalten für…",
        "intro": "Jeder hat sein Tempo.",
        "options": {
          "self": "Mich selbst",
          "family": "Meine Familie oder eine Familiengesellschaft",
          "clients": "Kunden, ich bin Verwalter"
        }
      },
      "units": {
        "title": "Wie viele Einheiten, ungefähr?",
        "intro": "Wohnungen, Häuser, Studios, Stellplätze.",
        "options": {
          "0": "Noch keine Einheit",
          "1": "1 Einheit",
          "2-5": "2 bis 5 Einheiten",
          "6-10": "6 bis 10 Einheiten",
          "11-20": "11 bis 20 Einheiten",
          "21-50": "21 bis 50 Einheiten"
        }
      },
      "rent": {
        "title": "Und Ihre Mieten, im Schnitt?",
        "intro": "Pro Einheit, ohne Nebenkosten. Eine Schätzung genügt.",
        "options": [
          "Unter 1.000 €",
          "1.000 bis 1.499 €",
          "1.500 bis 1.999 €",
          "2.000 bis 2.999 €",
          "3.000 € und mehr"
        ]
      },
      "where": {
        "title": "Wo sind Ihre Immobilien?",
        "intro": "Die Regeln sind nicht überall gleich.",
        "options": {
          "lu": "Luxemburg",
          "be": "Belgien",
          "fr": "Frankreich",
          "de": "Deutschland",
          "multi": "Mehrere Länder"
        }
      },
      "today": {
        "title": "Wie verwalten Sie heute?",
        "intro": "Um dort anzufangen, wo Sie stehen.",
        "options": {
          "spreadsheet": "Eine Tabelle",
          "software": "Eine andere Software",
          "paper": "Papier und E-Mails",
          "starting": "Ich fange an"
        }
      },
      "challenge": {
        "title": "Was belastet Sie am meisten?",
        "intro": "Damit fangen wir an.",
        "options": {
          "rent": {
            "label": "Säumige Mieten anmahnen",
            "sub": "Und jede Überweisung auf dem Konto prüfen"
          },
          "documents": {
            "label": "Verträge, Übergaben, Dokumente",
            "sub": "Alles finden, wenn es gebraucht wird"
          },
          "compliance": {
            "label": "Indexierung, Nebenkosten, Fristen",
            "sub": "Nichts verpassen, nichts verlieren"
          },
          "finances": {
            "label": "Einnahmen, Ausgaben, Steuererklärung",
            "sub": "Wissen, wo ich stehe, ohne Tabelle"
          },
          "maintenance": {
            "label": "Anfragen und Reparaturen",
            "sub": "Die Anrufe, die Angebote, das Nachfassen"
          }
        }
      },
      "time": {
        "title": "Wie viel Zeit kostet Sie das?",
        "intro": "Pro Woche, ungefähr."
      },
      "late": {
        "title": "Eine verspätete Miete bemerken Sie…",
        "intro": "Seien Sie ehrlich, das hilft uns, die App einzustellen.",
        "options": {
          "same_day": "Am selben Tag",
          "days": "Nach ein paar Tagen",
          "month_end": "Am Monatsende",
          "never": "Manchmal gar nicht"
        }
      },
      "goal": {
        "title": "Ihr Ziel in diesem Jahr?",
        "intro": "Nur eines, das wichtigste.",
        "options": {
          "rent": "Nicht mehr den Mieten hinterherlaufen",
          "everything": "Alles an einem Ort haben",
          "time": "Weniger Zeit dafür aufwenden",
          "tax": "Die Steuererklärung ohne Stress vorbereiten",
          "grow": "Eine Immobilie mehr vermieten"
        }
      },
      "source": {
        "title": "Wie haben Sie von Morada erfahren?",
        "intro": "Das hilft uns, Menschen wie Sie zu finden.",
        "options": {
          "instagram": "Instagram",
          "tiktok": "TikTok",
          "word": "Bekannte oder Kollegen",
          "search": "Eine Google-Suche",
          "press": "Presse oder ein Artikel",
          "other": "Anderes"
        }
      }
    },
    "interests": {
      "groups": {
        "first": "Zuerst sehen",
        "horizon": "Ihr Zeitraum",
        "watch": "Genau im Blick"
      },
      "horizons": {
        "month": "Der Monat",
        "year": "Das Jahr"
      },
      "watches": {
        "arrears": "Zahlungsverzug",
        "vacancy": "Leere Einheiten",
        "edl_exit": "Vertragsenden",
        "ticket": "Dringende Reparaturen",
        "invite": "Mieterbereiche"
      },
      "title": "Was ist Ihnen wichtig?",
      "intro": "Ihre Startseite passt sich Ihren Antworten an.",
      "chosen": {
        "one": "1 gewählt",
        "many": "{n} gewählt"
      },
      "chips": {
        "arrears": "Mietrückstände",
        "cashflow": "Cashflow",
        "actions": "Zu erledigen",
        "costs": "Ausgaben",
        "requests": "Anfragen",
        "activity": "Aktivität"
      }
    },
    "potential": {
      "title": "Sie haben alles, was es braucht.",
      "intro": "So verläuft Ihr erster Monat mit Morada.",
      "introGoal": "Ihr Ziel: {goal}. So verläuft Ihr erster Monat mit Morada.",
      "chart": "Ihr erster Monat",
      "steps": {
        "w1": "Woche 1",
        "w1Body": "Bank verbunden, Mieten von selbst zugeordnet",
        "w2": "Woche 2",
        "w2Body": "Rückstände am selben Tag gemeldet, Erinnerung bereit",
        "m1": "Monat 1",
        "m1Body": "Der Monat abgeschlossen, jeder Euro an seinem Platz"
      },
      "foot": "Nichts monatlich einzutippen: Ihre Überweisungen erledigen die Arbeit.",
      "cta": "Weiter"
    },
    "reviews": {
      "title": "Vermieter wie Sie verwalten ihre Mieten schon hier",
      "rating": "Vermieterbewertungen",
      "cta": "Weiter"
    },
    "setup": {
      "title": "Wir bauen Ihren Bereich",
      "intro": "Persönlich, nach Ihren Antworten.",
      "items": {
        "answers": "Ihre Antworten ausgewertet: {challenge}",
        "home": "Ihre Startseite: {sections}",
        "alerts": "Ihre Hinweise: {watch}",
        "price": "Ihr Preis für {n}"
      },
      "retry": "Erneut versuchen"
    },
    "ready": {
      "title": "Ihr Plan ist bereit.",
      "intro": "Eingestellt auf das, was Sie belastet: {challenge}.",
      "goal": "Ziel: {goal}",
      "home": "Start",
      "cta": "Weiter",
      "foot": "Ihre kostenlose 30-Tage-Testphase beginnt gleich danach.",
      "rows": {
        "rent": [
          "Jede Überweisung der richtigen Miete zugeordnet",
          "Ein Rückstand am selben Tag gemeldet",
          "Erinnerung mit einem Tipp, Text fertig"
        ],
        "documents": [
          "Eine Akte pro Mietverhältnis: Vertrag, Übergabe, Unterlagen",
          "Übergabe vor Ort unterschrieben, als PDF versiegelt",
          "Alles vom Telefon aus auffindbar"
        ],
        "compliance": [
          "Indexierung berechnet, Schreiben fertig",
          "Geführte Nebenkostenabrechnung",
          "Gesetzliche Fristen rechtzeitig erinnert"
        ],
        "finances": [
          "Ein- und Ausgaben, Monat für Monat",
          "Ausgaben per Foto des Belegs erfasst",
          "Eine Jahresansicht für die Steuererklärung"
        ],
        "maintenance": [
          "Mieteranfragen an einem Ort",
          "Notfälle rot markiert",
          "Verlauf pro Wohnung"
        ]
      }
    },
    "tryFree": {
      "title": "Wir möchten, dass Sie Morada gratis testen.",
      "cta": "Gratis testen",
      "shot": "Die Startseite von Morada auf einem Telefon, mit Beispielzahlen"
    },
    "reminder": {
      "title": "Wir erinnern Sie vor dem Ende Ihrer Testphase.",
      "intro": "Per E-Mail, zwei Tage vor dem Ende.",
      "cta": "Gratis weiter"
    },
    "offer": {
      "noPayment": "Heute keine Zahlung",
      "onUsTitle": "Ihre ersten {days} Tage sind geschenkt.",
      "tl": {
        "today": "Heute",
        "todayBody": "Voller Zugang zu allen Funktionen.",
        "inDays": "In {days} Tagen",
        "remindBody": "Eine Erinnerung per E-Mail, dass Ihre Testphase bald endet.",
        "startBody": "Ihr Abo beginnt, sofern Sie nicht vorher kündigen."
      },
      "tryThen": "{days} Tage gratis testen, danach",
      "periodYear": "pro Jahr",
      "periodQuarter": "pro Quartal",
      "monthlyEq": "({amount} pro Monat)",
      "priceFor": "Preis für {units}",
      "lots": {
        "one": "1 Einheit",
        "many": "{n} Einheiten"
      },
      "understand": "Meinen Preis verstehen",
      "start": "Meine {days} Gratistage starten",
      "noCharge": "Heute keine Zahlung. Jederzeit kündbar.",
      "notNow": "Jetzt nicht",
      "nowTitle": "Ihr Abo beginnt heute.",
      "nowSub": "Dieses Konto hatte seine Gratistage bereits.",
      "startNow": "Mein Abo starten",
      "finePrintNow": "{amount} {period}, heute abgebucht und automatisch verlängert. Jederzeit kündbar.",
      "checkoutFailed": "Die Zahlungsseite konnte nicht geöffnet werden. Versuchen Sie es gleich noch einmal.",
      "unavailable": "Die Online-Zahlung ist vorübergehend nicht verfügbar. Versuchen Sie es später.",
      "retry": "Erneut versuchen",
      "scalesTitle": "Ein Preis, der mitwächst",
      "perUnitLine": "{perUnit} pro Einheit und Monat, Kaltmiete. Günstiger ab der 6. Einheit.",
      "adjustLots": "Anzahl der Einheiten",
      "adjustRent": "Durchschnittsmiete pro Einheit",
      "rhythm": "Abrechnung",
      "plans": {
        "year": "Jährlich",
        "quarter": "Vierteljährlich"
      },
      "twoMonths": "2 Monate geschenkt",
      "launchNote": "Einführungspreise, noch in Prüfung: sie können sich ändern.",
      "done": "Fertig",
      "close": "Schließen"
    },
    "winback": {
      "eyebrow": "Ihr einmaliges Angebot",
      "badge": "-{pct} %",
      "title": "{pct} % Rabatt\nauf Ihr erstes Jahr",
      "sub": "Es verfällt, wenn Sie diesen Bildschirm verlassen. Weiterhin 0 € heute und 30 Tage gratis.",
      "subCharged": "Es verfällt, wenn Sie diesen Bildschirm verlassen. Heute abgebucht, jederzeit kündbar.",
      "plan": "Jährlich · 12 Monate",
      "firstYear": "{amount} im ersten Jahr, danach {full} pro Jahr",
      "perMonth": "pro Monat",
      "cta": "Meine {days} Gratistage starten",
      "ctaCharged": "Angebot annehmen",
      "noCommit": "Ohne Bindung, jederzeit kündbar",
      "decline": "Nein danke"
    },
    "progressLabel": "Schritt {current} von {total}"
  }
};
const lu: SignupCopy = {
  "or": "oder",
  "confirmPhone": "Ass dës Nummer richteg?",
  "confirmPhoneBody": "Mir schécken Äre Confirmatiounscode op dës Nummer.",
  "sendCode": "Confirméieren a Code schécken",
  "emailConfirmed": "E-Mail confirméiert",
  "socialLinked": "Är E-Mail ass confirméiert. Dir kënnt Iech och mat dësem Kont umellen.",
  "linkError": "Dëse Kont konnt net verbonne ginn. Probéiert nach eng Kéier, gitt Är E-Mail an oder mellt Iech bei Ärem bestoende Kont un.",
  "loginTitle": "Wëllkomm zréck",
  "loginIntro": "Gitt d’E-Mail vun Ärem Morada-Kont an.",
  "passwordTitle": "Äert Passwuert",
  "password": "Passwuert",
  "forgotPassword": "Passwuert vergiess?",
  "wrongPassword": "Falsch E-Mail oder Passwuert. Probéiert nach eng Kéier.",
  "socialNoAccount": "Erstellt Äre Kont fir d’éischt mat Ärer Telefonsnummer. Duerno kënnt Dir Google oder Apple verbannen.",
  "google": "Mat Google weiderfueren",
  "apple": "Mat Apple weiderfueren",
  "noAccount": "Nach kee Kont?",
  "createAccount": "E Kont erstellen",
  "socialError": "D’Umeldung gouf net ofgeschloss. Probéiert nach eng Kéier oder wielt eng aner Method.",
  "pageTitle": "Äre Morada-Kont erstellen",
  "secure": "Sécher Äre Kont",
  "phoneIntro": "Gitt Är Handysnummer an. Mir schécken Iech e Bestätegungscode.",
  "phone": "Telefonsnummer",
  "country": "Virwal",
  "countries": "E Land auswielen",
  "searchCountry": "Land oder Virwal sichen",
  "noCountries": "Kee Land fonnt.",
  "continue": "Weider",
  "verify": "Meng Nummer bestätegen",
  "working": "Ee Moment…",
  "login": "Umellen",
  "phoneLogin": "Mat Telefonsnummer umellen",
  "emailLogin": "Mat E-Mail umellen",
  "haveAccount": "Schonn e Kont?",
  "back": "Zréck",
  "close": "Zoumaachen",
  "editNumber": "Nummer änneren",
  "privacyNote": "Är Nummer ass fir d’Umeldung a Sécherheet. Keng Reklammen iwwer SMS.",
  "codeTitle": "Kuckt an Är Messagen",
  "codeIntro": "Gitt de Code mat 6 Zifferen an. Geschéckt un",
  "code": "Bestätegungscode",
  "resend": "Code nach eng Kéier schécken",
  "noCode": "Näischt kritt?",
  "resendIn": "Nach eng Kéier an {seconds} s",
  "resent": "En neie Code ass ënnerwee.",
  "roleTitle": "Wéi benotzt Dir Morada?",
  "roleIntro": "Wielt de passende Beräich.",
  "landlord": "Ech verlounen",
  "landlordBody": "Loyeren, Dokumenter a meng Immobilie geréieren.",
  "tenant": "Ech lounen",
  "tenantBody": "Mäi Bail gesinn, Noriichte schécken a Problemer mellen.",
  "nameTitle": "Wéi heescht Dir?",
  "nameIntro": "Dësen Numm erschéngt op Ärem Kont.",
  "firstName": "Virnumm",
  "lastName": "Familljennumm",
  "emailTitle": "Är E-Mail-Adress",
  "emailIntro": "Fir wichteg Kontonoriichten an d’Bestätegung vun Ärer Adress.",
  "email": "E-Mail-Adress",
  "emailPending": "Bestätegt Är E-Mail-Adress iwwer de Link an Ärer Inbox. Dir kënnt Iech weider mam Telefon umellen.",
  "involvement": [
    "Ongeféier 1 Stonn pro Woch",
    "Ongeféier 5 Stonne pro Woch",
    "Ongeféier 20 Stonne pro Woch",
    "40 Stonne pro Woch oder méi"
  ],
  "skip": "Fir de Moment iwwersprangen",
  "welcomeTitle": "Wëllkomm, {name}.",
  "welcomeIntro": "Äre Kont ass prett. Fänke mir mat Ärer éischter Immobilie un.",
  "tenantWelcome": "Äre Kont ass prett. Maacht d’Invitatioun vun Ärem Proprietär op, fir Är Locatioun ze gesinn.",
  "enter": "Mäi Beräich opmaachen",
  "enterTenant": "Mäi Locataireberäich opmaachen",
  "verified": "Nummer bestätegt",
  "saved": "Är Donnéeë si gespäichert.",
  "progress": "Fortschrëtt vun der Umeldung",
  "language": "Sprooch",
  "sideTitle": "Verlounen.\nMéi einfach.",
  "sideBody": "Är Immobilien, Loyeren a Messagen.\nAlles op enger Plaz.",
  "sideFoot": "Fir de Locatiounsalltag zu Lëtzebuerg.",
  "sideLabel": "Morada Gestion",
  "termsPrefix": "Wann Dir weiderfuert, akzeptéiert Dir d’",
  "terms": "Benotzungsbedingungen",
  "and": "an huelt Kenntnis vun der",
  "privacy": "Dateschutzerklärung",
  "invalidPhone": "Iwwerpréift Är Telefonsnummer an d’Virwal.",
  "invalidCode": "Gitt déi 6 Zifferen aus der SMS an.",
  "expiredCode": "Dëse Code ass falsch oder ofgelaf. Probéiert nach eng Kéier oder frot en neien un.",
  "requiredName": "Gitt Äre Virnumm a Familljennumm an.",
  "invalidEmail": "Gitt eng valabel E-Mail-Adress an.",
  "selectOption": "Wielt eng Äntwert aus.",
  "unavailable": "D’Verbindung ass grad net méiglech. Probéiert et gläich nach eng Kéier.",
  "emailCodeTitle": "Kuckt an Är Mailbox",
  "verifyEmail": "E-Mail bestätegen",
  "emailCodeIntro": "Gitt de 6-stellege Code an, dee mir geschéckt hunn un",
  "emailCodeHint": "Dir kënnt och op de Link an der E-Mail klicken. Dës Säit geet dann eleng weider.",
  "resendEmail": "E-Mail nach eng Kéier schécken",
  "emailResent": "Eng nei E-Mail ass ënnerwee.",
  "changeEmail": "Adress änneren",
  "createPasswordTitle": "Maacht Äert Passwuert",
  "createPasswordIntro": "Dir mellt Iech mat {email} an dësem Passwuert un. Mindestens 8 Zeechen.",
  "confirmPassword": "Passwuert bestätegen",
  "passwordMismatch": "Déi zwee Passwierder stëmmen net iwwereneen.",
  "emailUnconfirmed": "Confirméiert fir d’éischt Är E-Mail mam Code oder mam Link.",
  "passwordRequired": "Maacht fir d’éischt Äert Passwuert.",
  "passwordAlreadySet": "Dëse Kont huet schonn e Passwuert. Fir et z’änneren, frot op der Umeldungssäit e Link fir et zréckzesetzen.",
  "phoneCodeIfAccount": "Wann e Kont dës Nummer benotzt, gouf grad e Code drop geschéckt.",
  "emailCodeOtherAccount": "No e puer Minutte nach ëmmer keen Code? Dës Adress gehéiert vläicht schonn zu engem anere Kont: Mellt Iech domat un, oder wielt eng aner Adress.",
  "smsFailed": "Mir konnten keng SMS un dës Nummer schécken. Kontrolléiert se oder probéiert et an e puer Minutten nach eng Kéier.",
  "phoneUnavailable": "D’Umeldung mam Telefon ass de Moment net disponibel. Probéiert et w.e.g. méi spéit nach eng Kéier.",
  "noPhoneAccount": "Mat dëser Nummer ass nach kee Kont verbonnen. Maacht Äre Kont fir unzefänken.",
  "networkError": "D’Verbindung gouf ënnerbrach. Kontrolléiert Äert Netz a probéiert nach eng Kéier.",
  "emailNotConfirmed": "Confirméiert fir d’éischt Är E-Mail-Adress mam Link, deen mir Iech geschéckt hunn.",
  "resetSent": "Wann e Kont mat dëser Adress existéiert, ass e Link fir zréckzesetzen ënnerwee.",
  "resetTitle": "Neit Passwuert",
  "resetIntro": "Benotzt mindestens 8 Zeechen.",
  "newPassword": "Neit Passwuert",
  "savePassword": "Passwuert späicheren",
  "weakPassword": "Dëst Passwuert ass ze schwaach. Benotzt mindestens 8 Zeechen, mat Buschtawen an Zuelen.",
  "samePassword": "Wielt en anert Passwuert wéi dat bësheregt.",
  "resetExpired": "Dëse Link ass ofgelaf. Frot en neien un.",
  "setupUnavailable": "D’Umeldung ass de Moment net disponibel. Probéiert et gläich nach eng Kéier.",
  "rateLimited": "Ze vill Versich. Waart eng Minutt.",
  "captchaError": "D’Sécherheetskontroll ass feelgeschloen. Probéiert nach eng Kéier.",
  "captchaLoading": "Sécherheetskontroll…",
  "captchaRetry": "Sécherheetskontroll widderhuelen",
  "emailExists": "Dës Adress kann net bäigesat ginn. Benotzt eng aner oder mellt Iech mat Ärem bestoende Kont un.",
  "sessionExpired": "Är Sessioun ass ofgelaf. Mellt Iech nach eng Kéier un.",
  "saveFailed": "Är Donnéeë konnten net gespäichert ginn. Probéiert nach eng Kéier.",
  "existingTitle": "Dir sidd schonn doheem.",
  "existingIntro": "Dir sidd als {account} ugemellt.",
  "useAccount": "Mat dësem Kont weiderfueren",
  "otherAccount": "En anere Kont benotzen",
  "preview": "Interaktiv Virschau. Keng SMS a kee Kont gëtt erstallt.",
  "previewCode": "Benotzt de Code 123456 fir dës Virschau.",
  "previewDone": "Virschau fäerdeg. Keng Donnéeë goufe gespäichert.",
  "restart": "Virschau nei starten",
  "previewSecurity": "Virschau: Sécherheetskontroll simuléiert.",
  "onboarding": {
    "quiz": {
      "kind": {
        "title": "Wat verlount Dir?",
        "intro": "Fir Iech déi richteg Vuen ze weisen.",
        "options": {
          "flats": "Wunnengen",
          "houses": "Haiser",
          "building": "E ganzt Gebai",
          "mixed": "Vun allem eppes"
        }
      },
      "manage": {
        "title": "Dir geréiert fir…",
        "intro": "Jiddereen huet säin Tempo.",
        "options": {
          "self": "Mech selwer",
          "family": "Meng Famill oder eng Familljegesellschaft",
          "clients": "Clienten, ech sinn Gestionnaire"
        }
      },
      "units": {
        "title": "Wéi vill Eenheeten, ongeféier?",
        "intro": "Wunnengen, Haiser, Studioen, Parkplazen.",
        "options": {
          "0": "Nach keng Eenheet",
          "1": "1 Eenheet",
          "2-5": "2 bis 5 Eenheeten",
          "6-10": "6 bis 10 Eenheeten",
          "11-20": "11 bis 20 Eenheeten",
          "21-50": "21 bis 50 Eenheeten"
        }
      },
      "rent": {
        "title": "An Är Loyeren, am Schnëtt?",
        "intro": "Pro Eenheet, ouni Chargen. Eng Schätzung geet duer.",
        "options": [
          "Ënner 1.000 €",
          "1.000 bis 1.499 €",
          "1.500 bis 1.999 €",
          "2.000 bis 2.999 €",
          "3.000 € a méi"
        ]
      },
      "where": {
        "title": "Wou sinn Är Immobilien?",
        "intro": "D’Reegele sinn net iwwerall déiselwecht.",
        "options": {
          "lu": "Lëtzebuerg",
          "be": "Belsch",
          "fr": "Frankräich",
          "de": "Däitschland",
          "multi": "E puer Länner"
        }
      },
      "today": {
        "title": "Wéi geréiert Dir haut?",
        "intro": "Fir do unzefänken, wou Dir sidd.",
        "options": {
          "spreadsheet": "Eng Tabell",
          "software": "Eng aner Software",
          "paper": "Pabeier an E-Mailen",
          "starting": "Ech fänken un"
        }
      },
      "challenge": {
        "title": "Wat belaascht Iech am meeschten?",
        "intro": "Domat fänke mir un.",
        "options": {
          "rent": {
            "label": "Spéit Loyeren unmahnen",
            "sub": "An all Iwwerweisung um Kont kucken"
          },
          "documents": {
            "label": "Kontrakter, Iwwergaben, Dokumenter",
            "sub": "Alles fannen, wann et gebraucht gëtt"
          },
          "compliance": {
            "label": "Indexéierung, Chargen, Delaien",
            "sub": "Näischt verpassen, näischt verléieren"
          },
          "finances": {
            "label": "Recetten, Ausgaben, Steiererklärung",
            "sub": "Wëssen, wou ech stinn, ouni Tabell"
          },
          "maintenance": {
            "label": "Demanden a Reparaturen",
            "sub": "D’Uriff, d’Devisen, d’Nofroen"
          }
        }
      },
      "time": {
        "title": "Wéi vill Zäit kascht Iech dat?",
        "intro": "Pro Woch, ongeféier."
      },
      "late": {
        "title": "Eng Loyer am Réckstand bemierkt Dir…",
        "intro": "Sidd éierlech, dat hëlleft eis, d’App anzestellen.",
        "options": {
          "same_day": "Deeselwechten Dag",
          "days": "No e puer Deeg",
          "month_end": "Um Enn vum Mount",
          "never": "Heiansdo guer net"
        }
      },
      "goal": {
        "title": "Äert Zil dëst Joer?",
        "intro": "Just eent, dat wichtegst.",
        "options": {
          "rent": "Net méi de Loyeren nolafen",
          "everything": "Alles op enger Plaz hunn",
          "time": "Manner Zäit domat verbréngen",
          "tax": "D’Steiererklärung ouni Stress preparéieren",
          "grow": "Eng Immobilie méi verlounen"
        }
      },
      "source": {
        "title": "Wéi hutt Dir vu Morada héieren?",
        "intro": "Dat hëlleft eis, Leit wéi Iech ze fannen.",
        "options": {
          "instagram": "Instagram",
          "tiktok": "TikTok",
          "word": "Bekannten oder Kollegen",
          "search": "Eng Google-Sich",
          "press": "Press oder en Artikel",
          "other": "Anescht"
        }
      }
    },
    "interests": {
      "groups": {
        "first": "Fir d’éischt gesinn",
        "horizon": "Ären Zäitraum",
        "watch": "Genee am A behalen"
      },
      "horizons": {
        "month": "De Mount",
        "year": "D’Joer"
      },
      "watches": {
        "arrears": "Bezuelungsréckstänn",
        "vacancy": "Eidel Eenheeten",
        "edl_exit": "Enn vun de Bailen",
        "ticket": "Dréngend Reparaturen",
        "invite": "Locatairen-Espacen"
      },
      "title": "Wat ass Iech wichteg?",
      "intro": "Är Startsäit passt sech un Är Äntwerten un.",
      "chosen": {
        "one": "1 gewielt",
        "many": "{n} gewielt"
      },
      "chips": {
        "arrears": "Net bezuelt Loyeren",
        "cashflow": "Cashflow",
        "actions": "Ze maachen",
        "costs": "Ausgaben",
        "requests": "Demanden",
        "activity": "Aktivitéit"
      }
    },
    "potential": {
      "title": "Dir hutt alles, wat et brauch.",
      "intro": "Esou leeft Ären éischte Mount mat Morada.",
      "introGoal": "Äert Zil: {goal}. Esou leeft Ären éischte Mount mat Morada.",
      "chart": "Ären éischte Mount",
      "steps": {
        "w1": "Woch 1",
        "w1Body": "Bank verbonnen, Loyere vum selwen zougeuerdent",
        "w2": "Woch 2",
        "w2Body": "Réckstänn deeselwechten Dag gemellt, Erënnerung prett",
        "m1": "Mount 1",
        "m1Body": "De Mount ofgeschloss, all Euro op senger Plaz"
      },
      "foot": "Näischt all Mount anzetippen: Är Iwwerweisunge maachen d’Aarbecht.",
      "cta": "Weider"
    },
    "reviews": {
      "title": "Verlouner wéi Dir geréieren hir Loyere schonn hei",
      "rating": "Avise vu Verlouner",
      "cta": "Weider"
    },
    "setup": {
      "title": "Mir bauen Äre Beräich",
      "intro": "Perséinlech, no Ären Äntwerten.",
      "items": {
        "answers": "Är Äntwerten ausgewäert: {challenge}",
        "home": "Är Startsäit: {sections}",
        "alerts": "Är Alerten: {watch}",
        "price": "Äre Präis fir {n}"
      },
      "retry": "Nach eng Kéier probéieren"
    },
    "ready": {
      "title": "Äre Plang ass prett.",
      "intro": "Agestallt op dat, wat Iech belaascht: {challenge}.",
      "goal": "Zil: {goal}",
      "home": "Start",
      "cta": "Weider",
      "foot": "Är gratis 30-Deeg-Testphas fänkt direkt duerno un.",
      "rows": {
        "rent": [
          "All Iwwerweisung der richteger Loyer zougeuerdent",
          "E Réckstand deeselwechten Dag gemellt",
          "Erënnerung mat engem Tipp, Text prett"
        ],
        "documents": [
          "Een Dossier pro Locatioun: Kontrakt, Iwwergab, Pabeieren",
          "Iwwergab op der Plaz ënnerschriwwen, als PDF verségelt",
          "Alles vum Telefon aus ze fannen"
        ],
        "compliance": [
          "Indexéierung berechent, Bréif prett",
          "Gefouert Chargenofrechnung",
          "Gesetzlech Delaie rechtzäiteg erënnert"
        ],
        "finances": [
          "Entréeën an Ausgaben, Mount fir Mount",
          "Ausgabe per Foto vum Beleg erfaasst",
          "Eng Joresvue fir d’Steiererklärung"
        ],
        "maintenance": [
          "Demande vun de Locatairen op enger Plaz",
          "Noutfäll rout markéiert",
          "Verlaf pro Wunneng"
        ]
      }
    },
    "tryFree": {
      "title": "Mir wëllen, datt Dir Morada gratis testt.",
      "cta": "Gratis testen",
      "shot": "D’Startsäit vu Morada op engem Telefon, mat Beispillzuelen"
    },
    "reminder": {
      "title": "Mir erënneren Iech virum Enn vun Ärer Testphas.",
      "intro": "Per E-Mail, zwee Deeg virum Enn.",
      "cta": "Gratis weider"
    },
    "offer": {
      "noPayment": "Haut keng Bezuelung",
      "onUsTitle": "Är éischt {days} Deeg si geschenkt.",
      "tl": {
        "today": "Haut",
        "todayBody": "Vollen Zougang zu alle Funktiounen.",
        "inDays": "An {days} Deeg",
        "remindBody": "Eng Erënnerung per E-Mail, datt Är Testphas geschwënn ofleeft.",
        "startBody": "Ären Abonnement fänkt un, ausser Dir kënnegt virdrun."
      },
      "tryThen": "{days} Deeg gratis testen, duerno",
      "periodYear": "pro Joer",
      "periodQuarter": "pro Trimester",
      "monthlyEq": "({amount} pro Mount)",
      "priceFor": "Präis fir {units}",
      "lots": {
        "one": "1 Eenheet",
        "many": "{n} Eenheeten"
      },
      "understand": "Mäi Präis verstoen",
      "start": "Meng {days} gratis Deeg starten",
      "noCharge": "Haut keng Bezuelung. Zu all Moment kënnegbar.",
      "notNow": "Elo net",
      "nowTitle": "Ären Abonnement fänkt haut un.",
      "nowSub": "Dëse Kont hat seng gratis Deeg schonn.",
      "startNow": "Mäin Abonnement starten",
      "finePrintNow": "{amount} {period}, haut ofgebucht an automatesch verlängert. Zu all Moment kënnegbar.",
      "checkoutFailed": "D’Bezuelsäit konnt net opgoen. Probéiert et an engem Moment nach eng Kéier.",
      "unavailable": "D’Online-Bezuelung ass de Moment net disponibel. Probéiert et méi spéit.",
      "retry": "Nach eng Kéier probéieren",
      "scalesTitle": "E Präis, dee matwiisst",
      "perUnitLine": "{perUnit} pro Eenheet a Mount, Loyer ouni Chargen. Méi bëlleg vun der 6. Eenheet un.",
      "adjustLots": "Zuel vun Eenheeten",
      "adjustRent": "Duerchschnëttsloyer pro Eenheet",
      "rhythm": "Rechnung",
      "plans": {
        "year": "Joresplang",
        "quarter": "Trimesterplang"
      },
      "twoMonths": "2 Méint geschenkt",
      "launchNote": "Lancementspräisser, nach a Validatioun: si kënne sech änneren.",
      "done": "Fäerdeg",
      "close": "Zoumaachen"
    },
    "winback": {
      "eyebrow": "Är eemoleg Offer",
      "badge": "-{pct} %",
      "title": "{pct} % Remise\nop Äert éischt Joer",
      "sub": "Si verfält, wann Dir dësen Ecran verloosst. Ëmmer nach 0 € haut, an 30 Deeg gratis.",
      "subCharged": "Si verfält, wann Dir dësen Ecran verloosst. Haut ofgebucht, jidderzäit ofbestellbar.",
      "plan": "Joresplang · 12 Méint",
      "firstYear": "{amount} dat éischt Joer, duerno {full} pro Joer",
      "perMonth": "pro Mount",
      "cta": "Meng {days} gratis Deeg starten",
      "ctaCharged": "D’Offer huelen",
      "noCommit": "Ouni Engagement, jidderzäit ofbestellbar",
      "decline": "Nee merci"
    },
    "progressLabel": "Schrëtt {current} vun {total}"
  }
};
export const signupCopy: Record<Locale, SignupCopy> = { fr: signupFr, en, de, lu };

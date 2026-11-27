"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import type { User } from "@supabase/supabase-js";
import type { CountryCode } from "libphonenumber-js/min";
import GestionLogo from "@/components/gestion/GestionLogo";
import { getSupabase } from "@/lib/supabase/browser";
import { fmt, htmlLang, LOCALES, LOCALE_LABELS, plural, type Locale } from "@/lib/i18n/config";
import { signupCopy, type SignupCopy } from "@/lib/i18n/signup";
import { arrivedFromRecoveryLink, emailConfirmed, funnelStep, resumeStep, safeSignupNext, type OfferOutcome, type SignupRole, type SignupStep } from "@/lib/signup/model";
import { normalizePhone } from "@/lib/signup/phone";
import { MORADA_URL } from "@/lib/constants";
import { AUTH_APP_URL } from "@/lib/auth/redirects";
import { logSignupFailure, signupErrorKey, unknownNumberAtLogin, type SignupStage } from "@/lib/signup/errors";
import CountryPicker from "./CountryPicker";
import Turnstile from "./Turnstile";
import SocialButtons from "./SocialButtons";
import PhoneConfirmation from "./PhoneConfirmation";
import { confirmedEmail, LINK_INTENT_KEY, oauthReturnUrl, socialProviders, type SocialProvider } from "@/lib/signup/social";
import { TRIAL_DAYS, type Rhythm } from "@/domain/billing/pricing";
import { price } from "@/lib/billing/format";
import { apiProblem, type ApiErrorCopy } from "@/lib/api-errors";
import { answerForUnits, unitsFromAnswer, webProperties, WINBACK_PCT, type UnitsAnswer } from "@/lib/signup/offer";
import { EMPTY_ANSWERS, QUIZ_STEPS, answer, answerOf, answersFromStored, questionFromParam, storedQuiz, type QuizAnswers } from "@/lib/signup/quiz";
import { dashboardFromQuiz, fromInterests, visibleWidgets, type DashboardPrefs, type Watch } from "@/lib/signup/dashboard";
import { JOURNEY, journeyProgress, quizStep, type JourneyStep } from "@/lib/signup/journey";
import { afterOfferClosed, afterPlan, billingState, checkoutTarget, offerFrom, priceLine, spaceAddress, winbackLine, type BillingState } from "@/lib/signup/flow";
import { TESTIMONIALS, reviewsAvailable } from "@/lib/signup/reviews";
import {
  InterestsChips, PlanReady, PotentialCurve, PricePanel, PriceLine, ProductShot, QuizChoices, ReminderBell, ReviewsWall, SetupCount, TrialRows, UnderstandLink, WinbackCard,
  chosenLabel, interestsCount, midSentence, priceSentence, winbackBadge, type InterestsValue,
} from "./Onboarding";

/** The answers, kept in this tab between questions so a reload stays put (no name, no number, no address: only the keys tapped). */
const ANSWERS_KEY = "morada.signup.answers";
/** The one-time offer was shown in this tab: closing the offer again leads to the space. */
const WINBACK_KEY = "morada.signup.winback";
/** How long "Nous créons votre espace" counts, while the server finishes the account. */
export const SETUP_MS = 3200;
/** The design preview's billing: payments on, a trial to offer, so every screen can be seen. */
const PREVIEW_BILLING: BillingState = { configured: true, access: "locked", reason: "no_trial", trialOffered: true };
const NO_INTERESTS: InterestsValue = { first: [], horizon: null, watch: [] };

function readSession<T>(key: string): T | null {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function writeSession(key: string, value: unknown) {
  try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* A private window keeps nothing: the funnel still works. */ }
}

/** What `/api/abonnement/etat` says for this account's workspace; no answer is `null` (the funnel then goes to "Bienvenue"). */
async function readBillingState(): Promise<BillingState | null> {
  try {
    const response = await fetch("/api/abonnement/etat", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    return response.ok ? billingState(await response.json().catch(() => null)) : null;
  } catch { return null; }
}

/** The bar's place for a step, when it has one (the trial screens and the welcome have none). */
function journeyOf(step: SignupStep, question: number): JourneyStep | null {
  if (step === "properties") return quizStep(question);
  if (step === "email-code") return "email";
  return (JOURNEY as readonly string[]).includes(step) ? step as JourneyStep : null;
}

function Icon({ name, className = "" }: { name: "arrow" | "back" | "check" | "shield" | "home" | "key" | "mail"; className?: string }) {
  const paths = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    shield: <><path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    home: <><path d="m3 10 9-7 9 7v10H3V10Z" /><path d="M9 20v-7h6v7" /></>,
    key: <><circle cx="8" cy="8" r="5" /><path d="m12 12 9 9m-3-3 3-3m-6 0 3-3" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function FloatingField({ label, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: boolean }) {
  return <div className="signup-field" data-error={error || undefined}>
    <input {...props} placeholder=" " aria-invalid={error || undefined} aria-describedby={error ? "signup-error" : props["aria-describedby"]} />
    <label htmlFor={props.id}>{label}</label>
  </div>;
}

function Choices({ labels, values, selected, onSelect, name, descriptions, icons }: {
  labels: string[]; values: readonly string[]; selected: string | null; onSelect: (value: string) => void;
  name: string; descriptions?: string[]; icons?: ("home" | "key")[];
}) {
  return <fieldset className="signup-choices" aria-labelledby="signup-title">
    <legend className="sr-only">{name}</legend>
    {labels.map((label, index) => <label key={values[index]} className="signup-choice" data-selected={selected === values[index]}>
      <input type="radio" name={name} value={values[index]} checked={selected === values[index]} onChange={() => onSelect(values[index])} />
      {icons && <span className="signup-choice-icon"><Icon name={icons[index]} /></span>}
      <span className="signup-choice-copy"><span>{label}</span>{descriptions && <small>{descriptions[index]}</small>}</span>
      <span className="signup-radio" aria-hidden="true">{selected === values[index] && <Icon name="check" />}</span>
    </label>)}
  </fieldset>;
}

/** The sentence for a failed call, after logging its code (never its payload). */
function errorMessage(stage: SignupStage, failure: { code?: string; status?: number; name?: string } | null | undefined, copy: SignupCopy) {
  logSignupFailure(stage, failure);
  return copy[signupErrorKey(stage, failure)];
}

/** A session delivered by an email link (confirmation, magic link, recovery). */
const fromAuthLink = (url: URL) => /access_token=|refresh_token=|type=(signup|magiclink|recovery|invite|email_change)|[?&]code=/.test(url.hash + url.search);

export default function SignupFunnel({ locale: initialLocale, preview = false, signedIn = false, next, loginMode = false, phoneLogin = false, oauthIntent, initialEmail = "", recovery = false, placement, entry, cancelled = false, question, apiErrors }: {
  locale: Locale; preview?: boolean; signedIn?: boolean; next?: string; loginMode?: boolean; phoneLogin?: boolean; oauthIntent?: "link" | "login";
  /** An invitation's address: prefilled, never trusted (Auth confirms it). */
  initialEmail?: string;
  /** Arriving from a password-recovery email: choose a new password. */
  recovery?: boolean;
  /** Where on the public site the person pressed "try it" (`?ref=`): noted on the account it creates, nowhere else. */
  placement?: string;
  /** `?etape=offre` (the offer, for an account whose sign-up is complete) or `?etape=bienvenue`. */
  entry?: "offer" | "welcome";
  /** `?retour=annule`: back from a cancelled Checkout; the one-time offer opens instead of the offer (once). */
  cancelled?: boolean;
  /** `?q=`: the question to open, 1 to 11. */
  question?: number;
  /** The general sentences for a refused request, per language (src/lib/api-errors.ts). */
  apiErrors?: Record<Locale, ApiErrorCopy>;
}) {
  const [locale, setLocale] = useState(initialLocale);
  const c = signupCopy[locale];
  const k = c.onboarding;
  const [step, setStep] = useState<SignupStep>(signedIn ? "existing" : loginMode && !phoneLogin ? "login" : "phone");
  const [direction, setDirection] = useState(1);
  const [country, setCountry] = useState<CountryCode>("LU");
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const confirming = useRef(false);
  const [role, setRole] = useState<SignupRole | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [emailPending, setEmailPending] = useState(false);
  // The answers this tab already gave (a reload stays put); none on the server.
  const [answers, setAnswers] = useState<QuizAnswers>(() => ({ ...EMPTY_ANSWERS, ...readSession<{ answers?: QuizAnswers }>(ANSWERS_KEY)?.answers }));
  const [q, setQ] = useState(questionFromParam(question === undefined ? null : String(question)));
  const [interests, setInterests] = useState<InterestsValue>(NO_INTERESTS);
  const [dashboard, setDashboard] = useState<DashboardPrefs | null>(null);
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [rhythm, setRhythm] = useState<Rhythm>("year");
  const [panel, setPanel] = useState(false);
  const [setupPct, setSetupPct] = useState(0);
  const [setupRun, setSetupRun] = useState(0);
  const [setupFailed, setSetupFailed] = useState(false);
  const [busy, setBusy] = useState(signedIn || !!oauthIntent || recovery);
  const [pendingPhone, setPendingPhone] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [captcha, setCaptcha] = useState("");
  const [captchaGeneration, setCaptchaGeneration] = useState(0);
  const [account, setAccount] = useState("");
  const [previewDone, setPreviewDone] = useState(false);
  const copyRef = useRef(c);
  copyRef.current = c;
  const title = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const lock = useRef(false);
  const pendingFocus = useRef<string | null>(null);
  const mounted = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const ready = preview || (process.env.NEXT_PUBLIC_PHONE_SIGNUP_ENABLED === "1" && !!siteKey);
  // An account created to accept an invitation joins a workspace that exists: no space of its own, no payment.
  const invited = (next ?? "").startsWith("/invitation");

  const providers = socialProviders(ready, preview);
  const socialLoginEnabled = preview || process.env.NEXT_PUBLIC_SOCIAL_LOGIN_ENABLED === "1";
  const linkingEnabled = preview || process.env.NEXT_PUBLIC_SOCIAL_LINKING_ENABLED === "1";

  const go = useCallback((target: SignupStep, backwards = false) => {
    setDirection(backwards ? -1 : 1); setStep(target); setError(""); setStatus("");
  }, []);

  // The question in the address (`?q=`), so a reload stays put and the browser's Back walks the questions.
  const questionUrl = useCallback((n: number | null) => {
    const url = new URL(window.location.href);
    if (n === null) url.searchParams.delete("q"); else url.searchParams.set("q", String(n));
    return url.pathname + url.search + url.hash;
  }, []);
  const openQuestion = useCallback((n: number, how: "push" | "replace" = "replace", backwards = false) => {
    setQ(n); go("properties", backwards);
    window.history[how === "push" ? "pushState" : "replaceState"]({ signupQuestion: n }, "", questionUrl(n));
  }, [go, questionUrl]);

  /** The one-time offer was shown already, in this tab or recorded on the account. */
  const winbackSeen = useCallback((stored?: unknown) => readSession<boolean>(WINBACK_KEY) === true || stored === "winback" || stored === "declined", []);

  // The offer, for an account whose sign-up is done (`?etape=offre`): only while this workspace is locked on a deployment that takes payments.
  const openOffer = useCallback(async (storedOutcome?: unknown) => {
    const state = preview ? PREVIEW_BILLING : await readBillingState();
    setBilling(state);
    if (!state || !state.configured || state.access === "open") { go("welcome"); return; }
    go(cancelled && !winbackSeen(storedOutcome) ? "winback" : "offer");
  }, [preview, go, cancelled, winbackSeen]);

  // Signing in (password, phone code, email link) opens the space directly
  // when the profile is complete; an unfinished signup resumes where it stopped.
  const land = useCallback((user: User) => {
    if (resumeStep(user) !== "existing") return false;
    window.location.assign(safeSignupNext(next, user.user_metadata?.morada_signup?.role === "tenant" ? "tenant" : "landlord"));
    return true;
  }, [next]);

  const restoreUser = useCallback(async (user: User, arriving = false) => {
    const meta = user.user_metadata?.morada_signup;
    const mobile = (user.user_metadata?.morada_mobile ?? {}) as { quiz?: Record<string, unknown>; offer?: { units?: unknown; band?: unknown } };
    setAccount(user.email || user.phone || "");
    setPhone(user.phone ? "+" + user.phone.replace(/^\+/, "") : "");
    setFirstName(user.user_metadata?.first_name ?? "");
    setLastName(user.user_metadata?.last_name ?? "");
    setEmail(user.new_email || user.email || initialEmail);
    setEmailPending(!!user.new_email);
    setEmailVerified(confirmedEmail(user));
    setRole(meta?.role === "tenant" ? "tenant" : meta?.role === "landlord" ? "landlord" : null);
    // The answers of this tab first; otherwise what the account holds (the other surface may have written them).
    const storedBand = typeof mobile.offer?.band === "number" ? mobile.offer.band : null;
    const fromAccount = answersFromStored(mobile.quiz, storedBand);
    if (!fromAccount.units && typeof mobile.offer?.units === "number") fromAccount.units = answerForUnits(mobile.offer.units);
    setAnswers((current) => (Object.values(current).some((value) => value !== null) ? current : fromAccount));
    const target = funnelStep(user, invited);
    if (target === "properties") { openQuestion(question ?? 1); return; }
    if (target !== "existing") { go(target); return; }
    const complete = meta?.stage === "complete";
    if (entry === "welcome" && meta) go("welcome");
    else if (entry === "offer" && complete && meta?.role === "landlord" && !invited) await openOffer(mobile.quiz?.offer);
    // A landlord whose sign-up is done has nothing left here: the space (which shows the locked screen when it must).
    else if (arriving && !loginMode && !entry && complete && meta?.role === "landlord") window.location.assign(safeSignupNext(next, "landlord"));
    else go("existing");
  }, [go, initialEmail, invited, openQuestion, question, entry, openOffer, loginMode, next]);

  useEffect(() => {
    if (preview) {
      // The preview opens the screens it is asked for, with nothing behind them.
      if (entry === "offer") void openOffer();
      else if (entry === "welcome") go("welcome");
      else if (question) openQuestion(question);
      return;
    }
    let active = true;
    // Let the existing browser client consume OAuth tokens before reading the user.
    // Linking must return to the phone account that initiated it.
    const url = new URL(window.location.href);
    const callbackReason = url.searchParams.get("error_description") ?? new URLSearchParams(url.hash.slice(1)).get("error_description") ?? "";
    const callbackFailed = url.searchParams.has("error") || new URLSearchParams(url.hash.slice(1)).has("error");
    const linkSession = fromAuthLink(url);
    // The new-password form opens for the recovery link only, never for a session
    // that merely exists: a password is changed by whoever reads the account's mail.
    const recoveryArrival = recovery && arrivedFromRecoveryLink(url);
    getSupabase().auth.getUser().then(async ({ data, error: authError }) => {
      if (!active) return;
      if (recovery) {
        if (data.user && !authError && recoveryArrival && !callbackFailed) go("reset");
        else if (data.user && !authError && !callbackFailed) await restoreUser(data.user);
        else { go("login"); setError(copyRef.current.resetExpired); }
        return;
      }
      if (oauthIntent === "link") {
        let intent: { userId?: string; provider?: string; at?: number } | null = null;
        try { intent = JSON.parse(sessionStorage.getItem(LINK_INTENT_KEY) ?? "null"); } catch { /* A missing intent cannot approve a link. */ }
        sessionStorage.removeItem(LINK_INTENT_KEY);
        if (intent?.userId && data.user && intent.userId !== data.user.id) {
          await getSupabase().auth.signOut({ scope: "local" });
          if (active) { go("phone"); setError(copyRef.current.linkError); }
          return;
        }
        if (data.user && !authError) await restoreUser(data.user);
        const linked = intent && Date.now() - (intent.at ?? 0) < 15 * 60 * 1000 && data.user?.id === intent.userId &&
          data.user?.phone_confirmed_at && data.user.identities?.some((identity) => identity.provider === intent.provider);
        if (callbackFailed || !linked) setError(copyRef.current.linkError);
      } else if (!authError && data.user) {
        if (!(loginMode && (linkSession || oauthIntent === "login") && land(data.user))) await restoreUser(data.user, true);
      } else if (signedIn || oauthIntent) go(loginMode ? "login" : "phone");
      if (callbackFailed || (oauthIntent === "login" && (authError || !data.user))) setError(callbackReason.includes("morada_phone_signup_required") ? copyRef.current.socialNoAccount : copyRef.current.socialError);
    }).catch((failure) => { if (active) { go(loginMode ? "login" : "phone"); setError(errorMessage("login", failure, copyRef.current)); } }).finally(() => {
      if (!active) return;
      setBusy(false);
      if (oauthIntent) {
        for (const key of ["oauth", "error", "error_code", "error_description"]) url.searchParams.delete(key);
        url.hash = "";
        window.history.replaceState(null, "", url.pathname + url.search);
      }
    });
    return () => { active = false; };
    // The arrival is read once; the question, entry and offer it opens are the page's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, signedIn, restoreUser, land, go, oauthIntent, loginMode, recovery]);

  useEffect(() => {
    if (mounted.current) title.current?.focus({ preventScroll: true });
    mounted.current = true;
  }, [step, q]);

  // The browser's Back and Forward between questions.
  useEffect(() => {
    const onPop = () => {
      const raw = new URL(window.location.href).searchParams.get("q");
      if (raw && (stepRef.current === "properties" || stepRef.current === "interests")) { setQ(questionFromParam(raw)); go("properties", true); }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [go]);

  useEffect(() => { writeSession(ANSWERS_KEY, { answers }); }, [answers]);
  useEffect(() => { if (step === "winback") writeSession(WINBACK_KEY, true); }, [step]);

  useEffect(() => {
    if (!retryAt) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [retryAt]);

  useEffect(() => {
    if (!busy && error && pendingFocus.current) {
      document.querySelector<HTMLElement>(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [busy, error]);

  const changeLocale = (value: Locale) => {
    setLocale(value);
    if (!preview) document.cookie = "morada_locale=" + value + ";path=/;max-age=31536000;SameSite=Lax" + (location.protocol === "https:" ? ";Secure" : "");
  };

  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setStatus("");
    try { await work(); } catch (failure) { setError(errorMessage("save", failure as { name?: string }, c)); } finally { lock.current = false; setBusy(false); }
  };

  const save = async (body: Record<string, unknown>) => {
    if (preview) return { ok: true, emailPending: !emailVerified };
    const response = await fetch("/api/signup/profile", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.error === "session_expired" || result.error === "phone_required") go("phone");
      setError(errorMessage("save", { code: result.error, status: response.status }, c)); return null;
    }
    return result;
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  const sendCode = async (number: string, resend = false) => {
    if (!ready || (!preview && !captcha)) { setError(c.captchaError); return; }
    if (resend && Date.now() < retryAt) return;
    if (!preview) {
      try {
        const answer = await getSupabase().auth.signInWithOtp({
          phone: number, options: {
            captchaToken: captcha, shouldCreateUser: !loginMode,
            ...(!loginMode ? { data: { preferred_language: locale, morada_signup: { version: 1, stage: "role", ...(placement ? { ref: placement } : {}) } } } : {}),
          },
        });
        // Signing in, a number without an account is answered as one with: a code is awaited.
        if (answer.error && !(loginMode && unknownNumberAtLogin(answer.error))) { setPendingPhone(""); setError(errorMessage("send", answer.error, c)); return; }
      } catch (failure) {
        setPendingPhone(""); setError(errorMessage("send", failure as { name?: string }, c)); return;
      } finally {
        // A failed network response may still have consumed the single-use token.
        setCaptcha(""); setCaptchaGeneration((value) => value + 1);
      }
    }
    setPendingPhone(""); setPhone(number); setCode(""); setRetryAt(Date.now() + 60000); setRemaining(60);
    if (resend) setStatus(c.resent); else go("verify");
    // The same words for every number signing in, whether or not an account uses it.
    if (loginMode && !resend) setStatus(c.phoneCodeIfAccount);
  };

  // An invitation's sign-up only: the code, or the link clicked on any device.
  // Auth marks the address confirmed, the server records the stage, the
  // password step follows.
  const emailConfirmedNow = async () => {
    if (confirming.current) return;
    confirming.current = true;
    try {
      // The session in hand was issued before the address was confirmed (a link
      // clicked on another device): renewed, it carries the confirmed address,
      // which accepting an invitation reads.
      await getSupabase().auth.refreshSession().catch(() => undefined);
      if (await save({ action: "email_confirmed" })) { setEmailPending(false); setEmailVerified(true); go("create-password"); }
    } finally { confirming.current = false; }
  };
  const emailConfirmedRef = useRef(emailConfirmedNow);
  emailConfirmedRef.current = emailConfirmedNow;

  useEffect(() => {
    if (step !== "email-code" || preview) return;
    const started = Date.now();
    const check = async () => {
      if (document.visibilityState !== "visible" || lock.current || Date.now() - started > 30 * 60 * 1000) return;
      const { data } = await getSupabase().auth.getUser().catch(() => ({ data: { user: null } }));
      if (data.user && emailConfirmed(data.user)) await emailConfirmedRef.current();
    };
    const interval = setInterval(() => { void check(); }, 5000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", check); };
  }, [step, preview]);

  const resendEmail = () => void run(async () => {
    if (Date.now() < retryAt) return;
    if (!preview) {
      const result = await getSupabase().auth.resend({ type: "email_change", email });
      if (result.error) { setError(errorMessage("send", result.error, c)); return; }
    }
    setRetryAt(Date.now() + 60000); setRemaining(60); setStatus(c.emailResent);
  });

  // "Nous créons votre espace": the answers saved on the account (stage complete, the web's preferences, the
  // app's quiz and home screen), the management space opened, and the subscription read, while the figure counts.
  const setupBody = useRef<Record<string, unknown>>({});
  setupBody.current = {
    action: "complete",
    preferences: { properties: webProperties(answers.units), challenge: answers.challenge, involvement: answers.time },
    quiz: storedQuiz(answers),
    dashboard: dashboard ?? dashboardFromQuiz(answers.challenge, answers.late),
  };
  useEffect(() => {
    if (step !== "setup") return;
    let alive = true;
    const start = Date.now();
    setSetupPct(0); setSetupFailed(false);
    const work: Promise<{ ok: boolean; state: BillingState | null }> = (async () => {
      if (preview) return { ok: true, state: PREVIEW_BILLING };
      if (!(await saveRef.current(setupBody.current))) return { ok: false, state: null };
      if (invited) return { ok: true, state: null };
      // The space the payment is for: opened now (idempotent), as /app would on first entry. A failure is not fatal: /app opens it then.
      await fetch("/api/espace/creer", { method: "POST", signal: AbortSignal.timeout(20000) }).catch(() => null);
      return { ok: true, state: await readBillingState() };
    })().catch(() => ({ ok: false, state: null }));
    const id = setInterval(() => {
      const x = Math.min(1, (Date.now() - start) / SETUP_MS);
      // Quick at first, settling at the end, like a real install.
      setSetupPct(Math.round((1 - Math.pow(1 - x, 2.2)) * 100));
      if (x < 1) return;
      clearInterval(id);
      void work.then((result) => {
        if (!alive) return;
        if (!result.ok) { setSetupFailed(true); return; }
        setBilling(result.state);
        go("ready");
      });
    }, 40);
    return () => { alive = false; clearInterval(id); };
  }, [step, setupRun, preview, invited, go]);

  const offer = offerFrom(answers.units, answers.rent, rhythm);
  const trial = billing?.trialOffered ?? true;

  /** What the offer screen came to, kept on the account beside the answers (bookkeeping: access is the subscription's). */
  const recordOutcome = async (outcome: OfferOutcome, quoted = offer) => {
    if (preview) return;
    await fetch("/api/signup/profile", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ action: "offer", outcome, offer: quoted }),
    }).catch(() => null);
  };

  const checkout = (winback: boolean) => void run(async () => {
    const quoted = winback ? { ...offer, billing: "year" as const } : offer;
    if (preview) { go("welcome"); return; }
    await recordOutcome(winback ? "winback" : "paywall", quoted);
    let response: Response;
    try {
      response = await fetch("/api/abonnement/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ source: "signup", ...quoted, ...(winback ? { winback: true } : {}) }),
      });
    } catch { setError(k.offer.checkoutFailed); return; }
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const target = checkoutTarget((body as { url?: unknown } | null)?.url);
      if (target) { window.location.assign(target); return; }
      setError(k.offer.checkoutFailed); return;
    }
    // A subscription already runs for this space: nothing to pay, welcome.
    if (response.status === 409) { go("welcome"); return; }
    const copy = apiErrors?.[locale];
    const own = { billing_unavailable: k.offer.unavailable, invalid: k.offer.checkoutFailed };
    setError(copy ? apiProblem(response.status, body, copy, { codes: own, fallback: k.offer.checkoutFailed }).message : (response.status === 503 ? k.offer.unavailable : k.offer.checkoutFailed));
  });

  const leaveOffer = () => void run(async () => {
    if (afterOfferClosed(winbackSeen()) === "winback") { go("winback"); return; }
    await decline();
  });
  // Declining both: the space, which shows the locked screen until a trial starts.
  const decline = async () => {
    await recordOutcome("declined", { ...offer, billing: step === "winback" ? "year" : offer.billing });
    if (preview) { setPreviewDone(true); return; }
    window.location.assign("/app");
  };

  const invalid = (message: string, id?: string) => {
    setError(message);
    pendingFocus.current = id ? "#" + id : '.signup-choices input[type="radio"]';
  };

  const continueWithProvider = (provider: SocialProvider) => void run(async () => {
    const linking = step === "email";
    if (!providers.includes(provider) || (linking && !linkingEnabled) || (!linking && (step !== "login" || !socialLoginEnabled))) return;
    if (preview) {
      if (linking) { setEmail("preview@example.test"); setEmailVerified(true); setEmailPending(false); setStatus(c.socialLinked); }
      else { setAccount("preview@example.test"); go("existing"); }
      return;
    }
    const auth = getSupabase().auth;
    if (linking) {
      const { data, error: authError } = await auth.getUser();
      if (authError || !data.user?.phone_confirmed_at) { go("phone"); setError(c.sessionExpired); return; }
      sessionStorage.setItem(LINK_INTENT_KEY, JSON.stringify({ userId: data.user.id, provider, at: Date.now() }));
      const result = await auth.linkIdentity({ provider, options: { redirectTo: oauthReturnUrl(window.location.origin, locale, "link", next) } });
      if (result.error) { sessionStorage.removeItem(LINK_INTENT_KEY); setError(c.linkError); }
    } else {
      const result = await auth.signInWithOAuth({ provider, options: { redirectTo: oauthReturnUrl(window.location.origin, locale, "login", next) } });
      if (result.error) setError(c.socialError);
    }
  });

  const quizKey = QUIZ_STEPS[Math.min(QUIZ_STEPS.length, Math.max(1, q)) - 1];
  const afterQuestions = () => {
    const prefill = dashboardFromQuiz(answers.challenge, answers.late);
    // Pre-filled from the questions (the pain named, the lateness): the person confirms or adjusts.
    setInterests(dashboard ? { first: dashboard.interests, horizon: dashboard.horizon, watch: dashboard.watch } : { first: prefill.interests, horizon: prefill.horizon, watch: prefill.watch });
    window.history.pushState(null, "", questionUrl(null));
    go("interests");
  };
  const afterInterests = (skip: boolean) => {
    setDashboard(skip ? fromInterests([]) : fromInterests(interests.first, { horizon: interests.horizon ?? "month", watch: interests.watch }));
    go("potential");
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(async () => {
      if (step === "login") {
        const value = String(data.get("email") ?? "").trim().toLowerCase(); setEmail(value);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) { invalid(c.invalidEmail, "signup-email"); return; }
        go("password");
      } else if (step === "password") {
        const password = String(data.get("password") ?? "");
        if (!password) { invalid(c.wrongPassword, "login-password"); return; }
        if (preview) { setAccount(email); go("existing"); return; }
        if (ready && !captcha) { setError(c.captchaError); return; }
        const result = await getSupabase().auth.signInWithPassword({ email, password, options: { captchaToken: captcha || undefined } });
        setCaptcha(""); setCaptchaGeneration((value) => value + 1);
        if (result.error) { invalid(errorMessage("login", result.error, c), "login-password"); return; }
        if (result.data.user && !land(result.data.user)) await restoreUser(result.data.user);
      } else if (step === "reset") {
        const password = String(data.get("new-password") ?? "");
        if (password.length < 8) { invalid(c.weakPassword, "reset-password"); return; }
        if (preview) { setAccount(email); go("existing"); return; }
        const result = await getSupabase().auth.updateUser({ password });
        if (result.error) { invalid(errorMessage("reset", result.error, c), "reset-password"); return; }
        if (result.data.user && !land(result.data.user)) await restoreUser(result.data.user);
      } else if (step === "phone") {
        const raw = String(data.get("phone") ?? ""); setPhoneInput(raw);
        const normalized = normalizePhone(raw, country);
        if (!normalized) { invalid(c.invalidPhone, "signup-phone"); return; }
        if (!ready || (!preview && !captcha)) { setError(c.captchaError); return; }
        setPendingPhone(normalized);
      } else if (step === "verify") {
        const token = String(data.get("code") ?? "").replace(/\s/g, "");
        if (!/^\d{6}$/.test(token)) { invalid(c.invalidCode, "signup-code"); return; }
        if (preview) {
          if (token !== "123456") { invalid(c.expiredCode, "signup-code"); return; }
          go("role");
        } else {
          const result = await getSupabase().auth.verifyOtp({ phone, token, type: "sms" });
          if (result.error || !result.data.user) { invalid(errorMessage("verify", result.error ?? { code: "otp_expired" }, c), "signup-code"); return; }
          if (!(loginMode && land(result.data.user))) await restoreUser(result.data.user);
        }
      } else if (step === "role") {
        if (!role) { invalid(c.selectOption); return; } go("name");
      } else if (step === "name") {
        const first = String(data.get("given-name") ?? "").trim();
        const last = String(data.get("family-name") ?? "").trim();
        setFirstName(first); setLastName(last);
        if (!first || !last) { invalid(c.requiredName, !first ? "signup-first" : "signup-last"); return; }
        if (await save({ action: "details", firstName: first, lastName: last, role, locale })) go("email");
      } else if (step === "email") {
        const value = String(data.get("email") ?? "").trim().toLowerCase(); setEmail(value);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) { invalid(c.invalidEmail, "signup-email"); return; }
        const result = await save({ action: "email", email: value });
        if (!result) return;
        setEmailPending(result.emailPending === true);
        setEmailCode(""); setRetryAt(Date.now() + 60000); setRemaining(60);
        // The address is recorded and its confirmation mail goes out; only an invitation waits for it.
        go(invited && result.emailPending === true ? "email-code" : "create-password");
      } else if (step === "email-code") {
        const token = String(data.get("email-code") ?? "").replace(/\s/g, "");
        if (!/^\d{6}$/.test(token)) { invalid(c.invalidCode, "email-code"); return; }
        if (!preview) {
          const result = await getSupabase().auth.verifyOtp({ email, token, type: "email_change" });
          if (result.error) { invalid(errorMessage("verify", result.error, c), "email-code"); return; }
        }
        await emailConfirmedNow();
      } else if (step === "create-password") {
        const password = String(data.get("new-password") ?? "");
        const repeat = String(data.get("confirm-password") ?? "");
        if (password.length < 8) { invalid(c.weakPassword, "create-password"); return; }
        if (password !== repeat) { invalid(c.passwordMismatch, "confirm-password"); return; }
        const result = await save({ action: "password", password });
        if (!result) return;
        if (result.stage === "complete" || role === "tenant") go("welcome"); else openQuestion(1);
      } else if (step === "properties") {
        if (answerOf(answers, quizKey) === null) { invalid(c.selectOption); return; }
        if (q < QUIZ_STEPS.length) openQuestion(q + 1, "push"); else afterQuestions();
      } else if (step === "interests") {
        if (interestsCount(interests) === 0) { setError(c.selectOption); return; }
        afterInterests(false);
      }
    });
  };

  const back = () => {
    if (busy) return;
    if (step === "properties" && q > 1) { setCode(""); openQuestion(q - 1, "replace", true); return; }
    if (step === "interests") { openQuestion(QUIZ_STEPS.length, "replace", true); return; }
    // Once the password is set and the space created, there is no way back into them.
    const previous: Partial<Record<SignupStep, SignupStep>> = { password: "login", verify: "phone", name: "role", email: "name", "email-code": "email", potential: "interests", reviews: "potential", try: "ready", reminder: "try" };
    if (previous[step]) { setCode(""); setEmailCode(""); go(previous[step]!, true); }
  };

  const useOtherAccount = () => void run(async () => {
    if (!preview) {
      sessionStorage.removeItem(LINK_INTENT_KEY);
      const result = await getSupabase().auth.signOut({ scope: "local" });
      if (result.error) { setError(c.unavailable); return; }
    }
    writeSession(ANSWERS_KEY, null); writeSession(WINBACK_KEY, null);
    setRole(null); setPhone(""); setPhoneInput(""); setFirstName(""); setLastName(""); setEmail(""); setCode("");
    setAnswers(EMPTY_ANSWERS); setDashboard(null); setEmailPending(false); setEmailVerified(false); setCaptchaGeneration((value) => value + 1); go(loginMode ? "login" : "phone");
  });

  // The recovery email returns to this page in reset mode, on this app's own
  // domain (allow-listed in Supabase Auth), never to a retired Morada page.
  const sendReset = () => void run(async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { go("login", true); invalid(c.invalidEmail, "signup-email"); return; }
    if (preview) { setStatus(c.resetSent); return; }
    if (ready && !captcha) { setError(c.captchaError); return; }
    const redirectTo = AUTH_APP_URL + "/connexion?mode=reset" + (next ? "&next=" + encodeURIComponent(safeSignupNext(next)) : "");
    const result = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo, captchaToken: captcha || undefined });
    setCaptcha(""); setCaptchaGeneration((value) => value + 1);
    // Same answer whether or not the address has an account.
    if (result.error && !["user_not_found", "email_address_invalid"].includes(result.error.code ?? "")) { setError(errorMessage("login", result.error, c)); return; }
    setStatus(c.resetSent);
  });

  const openSpace = () => {
    if (preview) { setPreviewDone(true); return; }
    writeSession(ANSWERS_KEY, null); writeSession(WINBACK_KEY, null);
    // A landlord starts with the first property (its type from the first question), or on the home screen without a lot yet.
    window.location.assign(role === "tenant" || invited || (role === null && next) ? safeSignupNext(next, role ?? "landlord") : spaceAddress(answers));
  };

  const challenge = answers.challenge ?? "rent";
  const sections = visibleWidgets(dashboard ?? dashboardFromQuiz(answers.challenge, answers.late)).slice(0, 3);
  const watched: Watch[] = (dashboard?.watch.length ? dashboard.watch : ["arrears" as Watch]).slice(0, 2);
  const lots = plural(locale, unitsFromAnswer(answers.units), k.offer.lots.one, k.offer.lots.many);
  const setupItems = [
    fmt(k.setup.items.answers, { challenge: midSentence(k.quiz.challenge.options[challenge].label, locale) }),
    fmt(k.setup.items.home, { sections: sections.map((w) => k.interests.chips[w]).join(" · ") }),
    fmt(k.setup.items.alerts, { watch: watched.map((w) => k.interests.watches[w]).join(", ").toLowerCase() }),
    fmt(k.setup.items.price, { n: lots }),
  ];
  const goalLabel = answers.goal ? k.quiz.goal.options[answers.goal] : null;
  const nextAfterPlan = afterPlan(billing, invited);
  const journey = journeyOf(step, q);
  const fill = journey ? journeyProgress(journey) : 0;
  const hasBar = journey !== null && !["phone", "login", "password", "existing", "welcome", "reset"].includes(step);
  const canBack = ["password", "verify", "name", "email", "email-code", "interests", "potential", "reviews", "try", "reminder"].includes(step) || (step === "properties" && q > 1);
  const showNav = hasBar || step === "try" || step === "reminder";
  const { perPeriod } = priceLine(offer);
  const period = offer.billing === "year" ? k.offer.periodYear : k.offer.periodQuarter;

  const titles: Record<SignupStep, string> = {
    login: c.loginTitle, password: c.passwordTitle, phone: loginMode ? c.login : c.secure, verify: c.codeTitle, role: c.roleTitle, name: c.nameTitle, email: c.emailTitle,
    "email-code": c.emailCodeTitle, "create-password": c.createPasswordTitle,
    properties: k.quiz[quizKey].title, interests: k.interests.title, potential: k.potential.title, reviews: k.reviews.title, setup: k.setup.title, ready: k.ready.title,
    try: k.tryFree.title, reminder: k.reminder.title, offer: trial ? fmt(k.offer.onUsTitle, { days: TRIAL_DAYS }) : k.offer.nowTitle, winback: fmt(k.winback.title, { pct: WINBACK_PCT }),
    welcome: fmt(c.welcomeTitle, { name: firstName || "Morada" }), existing: c.existingTitle, reset: c.resetTitle,
  };
  const intros: Record<SignupStep, string> = {
    login: c.loginIntro, password: email, phone: c.phoneIntro, verify: c.codeIntro, role: c.roleIntro, name: c.nameIntro, email: c.emailIntro,
    "email-code": c.emailCodeIntro, "create-password": fmt(c.createPasswordIntro, { email }),
    properties: k.quiz[quizKey].intro, interests: k.interests.intro,
    potential: goalLabel ? fmt(k.potential.introGoal, { goal: midSentence(goalLabel, locale) }) : k.potential.intro,
    reviews: "", setup: k.setup.intro, ready: fmt(k.ready.intro, { challenge: midSentence(k.quiz.challenge.options[challenge].label, locale) }),
    try: "", reminder: k.reminder.intro, offer: trial ? "" : k.offer.nowSub, winback: trial ? k.winback.sub : k.winback.subCharged,
    welcome: role === "tenant" ? c.tenantWelcome : c.welcomeIntro, existing: fmt(c.existingIntro, { account }), reset: c.resetIntro,
  };
  const count = interestsCount(interests);
  const buttonText = step === "verify" ? c.verify : step === "email-code" ? c.verifyEmail : step === "reset" ? c.savePassword
    : step === "interests" && count > 0 ? `${c.continue} · ${chosenLabel(c, locale, count)}` : c.continue;
  const baseUrl = preview ? "/inscription/apercu" : "/inscription";
  const routeParams = "lang=" + locale + (next ? "&next=" + encodeURIComponent(safeSignupNext(next, role ?? "landlord")) : "");
  const loginUrl = baseUrl + "?mode=login&" + routeParams;
  const formSteps: SignupStep[] = ["login", "password", "reset", "phone", "verify", "email-code", "create-password", "role", "name", "email", "properties", "interests"];
  const line = priceSentence(c, locale, offer, trial);

  return <main className="signup-page" lang={htmlLang(locale)} data-preview={preview || undefined}>
    {preview && <div className="signup-preview-banner">{c.preview}</div>}
    <section className="signup-main">
      <header className="signup-header">
        <a className="signup-wordmark" href={MORADA_URL} aria-label="Morada"><GestionLogo compact /><span className="font-display font-bold">morada</span></a>
        <label className="signup-language"><span className="sr-only">{c.language}</span><select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)}>{LOCALES.map((language) => <option key={language} value={language}>{LOCALE_LABELS[language]}</option>)}</select></label>
      </header>
      <div className="signup-form-wrap">
        {showNav && <div className="signup-navigation">
          {canBack ? <button className="signup-back" type="button" onClick={back} disabled={busy} aria-label={c.back}><Icon name="back" /></button> : <span className="signup-back-space" />}
          {hasBar && journey && <div className="signup-bar" role="progressbar" aria-label={c.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill * 100)}
            aria-valuetext={fmt(k.progressLabel, { current: JOURNEY.indexOf(journey) + 1, total: JOURNEY.length })}><span style={{ width: `${Math.round(fill * 1000) / 10}%` }} /></div>}
        </div>}
        <div className="signup-step" key={step === "properties" ? step + q : step} data-step={step} data-backwards={direction < 0}>
          {step === "welcome" && <div className="signup-complete-icon"><Icon name="check" /></div>}
          {step === "ready" && <div className="signup-complete-icon signup-ready-icon"><Icon name="check" /></div>}
          {step === "role" && <p className="signup-verified"><Icon name="check" />{c.verified}</p>}
          {step === "winback" && <p className="signup-eyebrow">{k.winback.eyebrow}<span className="signup-badge">{winbackBadge(c)}</span></p>}
          {step === "setup" && <SetupCount pct={setupPct} items={setupItems} label={k.setup.title} />}
          <h1 id="signup-title" ref={title} tabIndex={-1} className="font-display font-bold">{titles[step]}</h1>
          {intros[step] && <p className="signup-intro">{intros[step]}{step === "verify" && <><br /><strong dir="ltr">{phone}</strong><button type="button" className="signup-inline-link" onClick={() => go("phone", true)} disabled={busy}>{c.editNumber}</button></>}{step === "email-code" && <><br /><strong>{email}</strong><button type="button" className="signup-inline-link" onClick={() => go("email", true)} disabled={busy}>{c.changeEmail}</button></>}</p>}

          {step === "existing" ? <div className="signup-actions">
            <button type="button" className="signup-primary" onClick={openSpace} disabled={busy}>{c.useAccount}</button>
            <button type="button" className="signup-text-button" onClick={useOtherAccount} disabled={busy}>{c.otherAccount}</button>
          </div> : step === "welcome" ? <>
            <div className="signup-welcome-summary"><Icon name="shield" /><div><strong>{c.verified}</strong><span>{c.saved}</span></div></div>
            {emailPending && <p className="signup-email-note"><Icon name="mail" />{c.emailPending}</p>}
            {previewDone ? <div className="signup-preview-end" role="status"><p>{c.previewDone}</p><button className="signup-primary" type="button" onClick={() => window.location.reload()}>{c.restart}</button></div> :
              <button className="signup-primary" type="button" onClick={openSpace}>{role === "tenant" ? c.enterTenant : c.enter}</button>}
          </> : step === "potential" ? <>
            <PotentialCurve c={c} />
            <p className="signup-helper">{k.potential.foot}</p>
            <button className="signup-primary" type="button" onClick={() => go(reviewsAvailable() ? "reviews" : "setup")}>{k.potential.cta}</button>
          </> : step === "reviews" ? <>
            <ReviewsWall c={c} locale={locale} list={TESTIMONIALS} />
            <button className="signup-primary" type="button" onClick={() => go("setup")}>{k.reviews.cta}</button>
          </> : step === "setup" ? <>
            {setupFailed && <div className="signup-setup-retry">
              {error && <p className="signup-error" role="alert">{error}</p>}
              <button className="signup-primary" type="button" onClick={() => setSetupRun((n) => n + 1)}>{k.setup.retry}</button>
            </div>}
          </> : step === "ready" ? <>
            <PlanReady c={c} locale={locale} challenge={challenge} goal={answers.goal} sections={sections} />
            <button className="signup-primary" type="button" onClick={() => go(nextAfterPlan)}>{k.ready.cta}</button>
            {nextAfterPlan === "try" && <p className="signup-free">{k.ready.foot}</p>}
          </> : step === "try" ? <>
            <ProductShot locale={locale} alt={k.tryFree.shot} />
            <p className="signup-no-payment"><Icon name="check" />{k.offer.noPayment}</p>
            <button className="signup-primary" type="button" onClick={() => go("reminder")}>{k.tryFree.cta}</button>
          </> : step === "reminder" ? <>
            <ReminderBell />
            <p className="signup-no-payment"><Icon name="check" />{k.offer.noPayment}</p>
            <button className="signup-primary" type="button" onClick={() => go("offer")}>{k.reminder.cta}</button>
          </> : step === "offer" ? <>
            {trial && <TrialRows c={c} />}
            <PriceLine c={c} locale={locale} offer={offer} trial={trial} />
            <UnderstandLink c={c} locale={locale} units={offer.units} open={panel} onOpen={() => setPanel(true)} />
            {error && <p className="signup-error" id="signup-error" role="alert">{error}</p>}
            <button className="signup-primary" type="button" disabled={busy} onClick={() => checkout(false)}>
              {busy ? <><span className="signup-spinner" />{c.working}</> : trial ? fmt(k.offer.start, { days: TRIAL_DAYS }) : k.offer.startNow}
            </button>
            <p className="signup-free">{trial ? k.offer.noCharge : fmt(k.offer.finePrintNow, { amount: price(perPeriod, locale), period })}</p>
            <button type="button" className="signup-skip" disabled={busy} onClick={leaveOffer}>{k.offer.notNow}</button>
          </> : step === "winback" ? <>
            <WinbackCard c={c} locale={locale} offer={offer} trial={trial} />
            <UnderstandLink c={c} locale={locale} units={offer.units} open={panel} onOpen={() => setPanel(true)} />
            {error && <p className="signup-error" id="signup-error" role="alert">{error}</p>}
            <button className="signup-primary" type="button" disabled={busy} onClick={() => checkout(true)}>
              {busy ? <><span className="signup-spinner" />{c.working}</> : trial ? fmt(k.winback.cta, { days: TRIAL_DAYS }) : k.winback.ctaCharged}
            </button>
            <p className="signup-free">{k.winback.noCommit}</p>
            {previewDone ? <p className="signup-preview-end" role="status">{c.previewDone}</p> :
              <button type="button" className="signup-skip" disabled={busy} onClick={() => void run(decline)}>{k.winback.decline}</button>}
          </> : formSteps.includes(step) ? <form ref={form} onSubmit={submit} noValidate aria-busy={busy}>
            <fieldset className="signup-form-fields" disabled={busy}>
              {step === "login" && <FloatingField id="signup-email" name="email" label={c.email} type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} defaultValue={email} required error={!!error} />}
              {step === "password" && <>
                <input type="hidden" name="email" autoComplete="username" value={email} />
                <FloatingField id="login-password" name="password" label={c.password} type="password" autoComplete="current-password" required error={!!error} />
                <button type="button" className="signup-recovery" onClick={sendReset} disabled={busy}>{c.forgotPassword}</button>
                {!preview && ready && <Turnstile key={captchaGeneration} siteKey={siteKey} onToken={setCaptcha} copy={c} locale={locale} />}
              </>}
              {step === "reset" && <>
                <input type="hidden" name="email" autoComplete="username" value={account || email} />
                <FloatingField id="reset-password" name="new-password" label={c.newPassword} type="password" autoComplete="new-password" minLength={8} required error={!!error} />
              </>}
              {step === "phone" && <>
                <div className="signup-phone-row">
                  <CountryPicker value={country} onChange={setCountry} locale={locale} copy={c} />
                  <FloatingField label={c.phone} id="signup-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" defaultValue={phoneInput} onChange={(event) => setPhoneInput(event.target.value)} required maxLength={40} error={!!error} aria-describedby="phone-privacy" />
                </div>
                <p id="phone-privacy" className="signup-helper">{c.privacyNote}</p>
                {preview ? <p className="signup-preview-security">{c.previewSecurity}</p> : ready ? <Turnstile key={captchaGeneration} siteKey={siteKey} onToken={setCaptcha} copy={c} locale={locale} /> :
                  <p className="signup-setup-note">{c.setupUnavailable}</p>}
              </>}
              {step === "verify" && <>
                <div className="signup-otp" data-error={!!error || undefined}>
                  <label className="sr-only" htmlFor="signup-code">{c.code}</label>
                  <input id="signup-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} aria-invalid={!!error || undefined} aria-describedby={error ? "signup-error" : undefined} />
                  <div className="signup-otp-slots" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} data-current={index === code.length}>{code[index] ?? ""}</span>)}</div>
                </div>
                {preview && <p className="signup-preview-security">{c.previewCode}</p>}
              </>}
              {step === "email-code" && <>
                <div className="signup-otp" data-error={!!error || undefined}>
                  <label className="sr-only" htmlFor="email-code">{c.code}</label>
                  <input id="email-code" name="email-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))} aria-invalid={!!error || undefined} aria-describedby={error ? "signup-error" : "email-code-hint"} />
                  <div className="signup-otp-slots" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} data-current={index === emailCode.length}>{emailCode[index] ?? ""}</span>)}</div>
                </div>
                <p id="email-code-hint" className="signup-helper">{c.emailCodeHint}</p>
                <p className="signup-helper">{c.emailCodeOtherAccount}</p>
                {preview && <p className="signup-preview-security">{c.previewCode}</p>}
              </>}
              {step === "create-password" && <div className="signup-fields-stack">
                <input type="hidden" name="email" autoComplete="username" value={email} />
                <FloatingField id="create-password" name="new-password" label={c.password} type="password" autoComplete="new-password" minLength={8} maxLength={72} required error={!!error} />
                <FloatingField id="confirm-password" name="confirm-password" label={c.confirmPassword} type="password" autoComplete="new-password" minLength={8} maxLength={72} required error={!!error} />
              </div>}
              {step === "role" && <Choices name="role" labels={[c.landlord, c.tenant]} values={["landlord", "tenant"]} descriptions={[c.landlordBody, c.tenantBody]} icons={["home", "key"]} selected={role} onSelect={(value) => { setRole(value as SignupRole); setError(""); }} />}
              {step === "name" && <div className="signup-fields-stack">
                <FloatingField id="signup-first" name="given-name" label={c.firstName} autoComplete="given-name" defaultValue={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={60} required error={!!error} />
                <FloatingField id="signup-last" name="family-name" label={c.lastName} autoComplete="family-name" defaultValue={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={60} required error={!!error} />
              </div>}
              {step === "email" && <FloatingField id="signup-email" name="email" label={c.email} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => { setEmail(event.target.value); setEmailVerified(false); }} maxLength={160} required error={!!error} />}
              {step === "properties" && <QuizChoices c={c} step={quizKey} selected={answerOf(answers, quizKey)} onSelect={(value) => { setAnswers((current) => answer(current, quizKey, value)); setError(""); }} />}
              {step === "interests" && <InterestsChips c={c} value={interests} onChange={(value) => { setInterests(value); setError(""); }} />}
            </fieldset>
            {step === "email" && emailVerified && <p className="signup-verified signup-email-verified"><Icon name="check" />{c.emailConfirmed}</p>}
            {error && !pendingPhone && <p className="signup-error" id="signup-error" role="alert">{error}</p>}
            {status && <p className="signup-status" role="status">{status}</p>}
            <button className="signup-primary" type="submit" disabled={busy || (step === "phone" && (!ready || (!preview && !captcha))) || (step === "password" && ready && !preview && !captcha)}>
              {busy ? <><span className="signup-spinner" />{c.working}</> : buttonText}
            </button>
            {step === "interests" && <button type="button" className="signup-skip" disabled={busy} onClick={() => afterInterests(true)}>{c.skip}</button>}
            {((step === "email" && linkingEnabled && !emailVerified) || (step === "login" && socialLoginEnabled)) && <SocialButtons providers={providers} copy={c} disabled={busy} onContinue={continueWithProvider} />}
            {step === "password" && ready && <a className="signup-alternative" href={baseUrl + "?mode=phone&" + routeParams}>{c.phoneLogin}</a>}
            {step === "login" && <>
              {ready && <a className="signup-alternative" href={baseUrl + "?mode=phone&" + routeParams}>{c.phoneLogin}</a>}
              <p className="signup-login">{c.noAccount} <a href={baseUrl + "?" + routeParams}>{c.createAccount}</a></p>
            </>}
            {step === "phone" && <>
              <p className="signup-login">{loginMode ? <><a href={loginUrl}>{c.emailLogin}</a><br />{c.noAccount} <a href={baseUrl + "?" + routeParams}>{c.createAccount}</a></> : <>{c.haveAccount} <a href={loginUrl}>{c.login}</a></>}</p>
              {!loginMode && <p className="signup-terms">{c.termsPrefix} <a href={MORADA_URL + "/" + locale + "/legal#conditions"} target="_blank" rel="noreferrer">{c.terms}</a> {c.and} <a href={MORADA_URL + "/" + locale + "/legal#confidentialite"} target="_blank" rel="noreferrer">{c.privacy}</a>.</p>}
            </>}
            {step === "email-code" && <div className="signup-resend">
              <span>{c.noCode}</span>
              <button type="button" className="signup-text-button" disabled={busy || remaining > 0} onClick={resendEmail}>{remaining > 0 ? fmt(c.resendIn, { seconds: remaining }) : c.resendEmail}</button>
            </div>}
            {step === "verify" && <div className="signup-resend">
              <span>{c.noCode}</span>
              <button type="button" className="signup-text-button" disabled={busy || remaining > 0 || (!preview && !captcha)} onClick={() => void run(() => sendCode(phone, true))}>{remaining > 0 ? fmt(c.resendIn, { seconds: remaining }) : c.resend}</button>
              {!preview && remaining === 0 && <Turnstile key={captchaGeneration} siteKey={siteKey} onToken={setCaptcha} copy={c} locale={locale} />}
            </div>}
          </form> : null}
          {(step === "existing" || step === "welcome") && error && <p className="signup-error" role="alert">{error}</p>}
        </div>
      </div>
      <footer className="signup-footer"><span>© {new Date().getFullYear()} Morada</span><a href={MORADA_URL + "/" + locale + "/legal#confidentialite"}>{c.privacy}</a></footer>
    </section>
    <PhoneConfirmation number={pendingPhone} busy={busy} error={error} copy={c} onConfirm={() => void run(() => sendCode(pendingPhone))} onClose={() => { setPendingPhone(""); setError(""); }} />
    {(step === "offer" || step === "winback") && <PricePanel c={c} locale={locale} open={panel} onClose={() => setPanel(false)} units={offer.units} band={offer.band}
      billing={step === "offer" ? rhythm : undefined} onBilling={step === "offer" ? setRhythm : undefined}
      onUnits={(value: UnitsAnswer) => setAnswers((current) => ({ ...current, units: value }))} onBand={(band) => setAnswers((current) => ({ ...current, rent: band }))}
      resultLabel={step === "offer" ? (offer.billing === "year" ? k.offer.plans.year : k.offer.plans.quarter) : k.winback.plan}
      result={step === "offer" ? `${line.amount} ${line.tail}` : fmt(k.winback.firstYear, { amount: price(winbackLine(offer).firstYear, locale), full: price(winbackLine(offer).fullYear, locale) })} />}
    <aside className="signup-visual" aria-label={c.sideLabel}>
      <div className="signup-visual-copy"><h2 className="font-display font-bold">{c.sideTitle}</h2><span>{c.sideBody}</span></div>
      <div className="signup-art"><Image src="/signup-key.webp" alt="" fill sizes="(min-width: 1024px) 46vw, 1px" priority /></div>
      <div className="signup-visual-foot">{c.sideFoot}</div>
    </aside>
  </main>;
}

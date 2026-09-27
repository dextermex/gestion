"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import type { User } from "@supabase/supabase-js";
import type { CountryCode } from "libphonenumber-js/min";
import GestionLogo from "@/components/gestion/GestionLogo";
import { getSupabase } from "@/lib/supabase/browser";
import { fmt, htmlLang, LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/config";
import { signupCopy, type SignupCopy } from "@/lib/i18n/signup";
import { EMPTY_PREFERENCES, safeSignupNext, type Preferences, type SignupRole, type SignupStep } from "@/lib/signup/model";
import { normalizePhone } from "@/lib/signup/phone";
import { MORADA_URL } from "@/lib/constants";
import { AUTH_APP_URL } from "@/lib/auth/redirects";
import { logSignupFailure, signupErrorKey, type SignupStage } from "@/lib/signup/errors";
import CountryPicker from "./CountryPicker";
import Turnstile from "./Turnstile";
import SocialButtons from "./SocialButtons";
import PhoneConfirmation from "./PhoneConfirmation";
import { confirmedEmail, LINK_INTENT_KEY, oauthReturnUrl, socialProviders, type SocialProvider } from "@/lib/signup/social";

const PROPERTY_VALUES = ["0", "1", "2-5", "6-10", "11+"] as const;
const CHALLENGE_VALUES = ["maintenance", "compliance", "rent", "documents", "finances"] as const;
const TIME_VALUES = ["1", "5", "20", "40"] as const;

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

export default function SignupFunnel({ locale: initialLocale, preview = false, signedIn = false, next, loginMode = false, phoneLogin = false, oauthIntent, initialEmail = "", recovery = false }: {
  locale: Locale; preview?: boolean; signedIn?: boolean; next?: string; loginMode?: boolean; phoneLogin?: boolean; oauthIntent?: "link" | "login";
  /** An invitation's address: prefilled, never trusted (Auth confirms it). */
  initialEmail?: string;
  /** Arriving from a password-recovery email: choose a new password. */
  recovery?: boolean;
}) {
  const [locale, setLocale] = useState(initialLocale);
  const c = signupCopy[locale];
  const [step, setStep] = useState<SignupStep>(signedIn ? "existing" : loginMode && !phoneLogin ? "login" : "phone");
  const [direction, setDirection] = useState(1);
  const [country, setCountry] = useState<CountryCode>("LU");
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [role, setRole] = useState<SignupRole | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [emailPending, setEmailPending] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>({ ...EMPTY_PREFERENCES });
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
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const ready = preview || (process.env.NEXT_PUBLIC_PHONE_SIGNUP_ENABLED === "1" && !!siteKey);

  const providers = socialProviders(ready, preview);
  const socialLoginEnabled = preview || process.env.NEXT_PUBLIC_SOCIAL_LOGIN_ENABLED === "1";
  const linkingEnabled = preview || process.env.NEXT_PUBLIC_SOCIAL_LINKING_ENABLED === "1";

  const go = useCallback((target: SignupStep, backwards = false) => {
    setDirection(backwards ? -1 : 1); setStep(target); setError(""); setStatus("");
  }, []);

  // Signing in (password, phone code, email link) opens the space directly
  // when the profile is complete; an unfinished signup resumes where it stopped.
  const land = useCallback((user: User) => {
    const meta = user.user_metadata?.morada_signup;
    if (!meta || meta.stage === "complete") { window.location.assign(safeSignupNext(next, meta?.role === "tenant" ? "tenant" : "landlord")); return true; }
    return false;
  }, [next]);

  const restoreUser = useCallback((user: User) => {
    const meta = user.user_metadata?.morada_signup;
    setAccount(user.email || user.phone || "");
    setPhone(user.phone ? "+" + user.phone.replace(/^\+/, "") : "");
    setFirstName(user.user_metadata?.first_name ?? "");
    setLastName(user.user_metadata?.last_name ?? "");
    setEmail(user.new_email || user.email || initialEmail);
    setEmailPending(!!user.new_email);
    setEmailVerified(confirmedEmail(user));
    setRole(meta?.role === "tenant" ? "tenant" : meta?.role === "landlord" ? "landlord" : null);
    if (!meta || meta.stage === "complete") { go("existing"); return; }
    if (!user.phone_confirmed_at) { go("phone"); return; }
    go(meta.stage === "tailor" ? (meta.role === "tenant" ? "email" : "properties") : meta.stage === "email" ? "email" : "role");
  }, [go, initialEmail]);

  useEffect(() => {
    if (preview) return;
    let active = true;
    // Let the existing browser client consume OAuth tokens before reading the user.
    // Linking must return to the phone account that initiated it.
    const url = new URL(window.location.href);
    const callbackReason = url.searchParams.get("error_description") ?? new URLSearchParams(url.hash.slice(1)).get("error_description") ?? "";
    const callbackFailed = url.searchParams.has("error") || new URLSearchParams(url.hash.slice(1)).has("error");
    const linkSession = fromAuthLink(url);
    getSupabase().auth.getUser().then(async ({ data, error: authError }) => {
      if (!active) return;
      if (recovery) {
        if (data.user && !authError) go("reset");
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
        if (data.user && !authError) restoreUser(data.user);
        const linked = intent && Date.now() - (intent.at ?? 0) < 15 * 60 * 1000 && data.user?.id === intent.userId &&
          data.user?.phone_confirmed_at && data.user.identities?.some((identity) => identity.provider === intent.provider);
        if (callbackFailed || !linked) setError(copyRef.current.linkError);
      } else if (!authError && data.user) {
        if (!(loginMode && (linkSession || oauthIntent === "login") && land(data.user))) restoreUser(data.user);
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
  }, [preview, signedIn, restoreUser, land, go, oauthIntent, loginMode, recovery]);

  useEffect(() => {
    if (mounted.current) title.current?.focus({ preventScroll: true });
    mounted.current = true;
  }, [step]);

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

  const sendCode = async (number: string, resend = false) => {
    if (!ready || (!preview && !captcha)) { setError(c.captchaError); return; }
    if (resend && Date.now() < retryAt) return;
    if (!preview) {
      try {
        const answer = await getSupabase().auth.signInWithOtp({
          phone: number, options: {
            captchaToken: captcha, shouldCreateUser: !loginMode,
            ...(!loginMode ? { data: { preferred_language: locale, morada_signup: { version: 1, stage: "role" } } } : {}),
          },
        });
        if (answer.error) { setPendingPhone(""); setError(errorMessage("send", answer.error, c)); return; }
      } catch (failure) {
        setPendingPhone(""); setError(errorMessage("send", failure as { name?: string }, c)); return;
      } finally {
        // A failed network response may still have consumed the single-use token.
        setCaptcha(""); setCaptchaGeneration((value) => value + 1);
      }
    }
    setPendingPhone(""); setPhone(number); setCode(""); setRetryAt(Date.now() + 60000); setRemaining(60);
    if (resend) setStatus(c.resent); else go("verify");
  };

  const finish = async (answers = preferences) => {
    if (await save({ action: "complete", preferences: answers })) go("welcome");
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
        if (result.data.user && !land(result.data.user)) restoreUser(result.data.user);
      } else if (step === "reset") {
        const password = String(data.get("new-password") ?? "");
        if (password.length < 8) { invalid(c.weakPassword, "reset-password"); return; }
        if (preview) { setAccount(email); go("existing"); return; }
        const result = await getSupabase().auth.updateUser({ password });
        if (result.error) { invalid(errorMessage("reset", result.error, c), "reset-password"); return; }
        if (result.data.user && !land(result.data.user)) restoreUser(result.data.user);
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
          if (!(loginMode && land(result.data.user))) restoreUser(result.data.user);
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
        if (role === "tenant") await finish(); else go("properties");
      } else if (step === "properties") {
        if (!preferences.properties) { invalid(c.selectOption); return; } go("challenge");
      } else if (step === "challenge") {
        if (!preferences.challenge) { invalid(c.selectOption); return; } go("involvement");
      } else if (step === "involvement") {
        if (!preferences.involvement) { invalid(c.selectOption); return; } await finish();
      }
    });
  };

  const back = () => {
    if (busy) return;
    const previous: Partial<Record<SignupStep, SignupStep>> = { password: "login", verify: "phone", name: "role", email: "name", properties: "email", challenge: "properties", involvement: "challenge" };
    if (previous[step]) { setCode(""); go(previous[step]!, true); }
  };

  const useOtherAccount = () => void run(async () => {
    if (!preview) {
      sessionStorage.removeItem(LINK_INTENT_KEY);
      const result = await getSupabase().auth.signOut({ scope: "local" });
      if (result.error) { setError(c.unavailable); return; }
    }
    setRole(null); setPhone(""); setPhoneInput(""); setFirstName(""); setLastName(""); setEmail(""); setCode("");
    setPreferences({ ...EMPTY_PREFERENCES }); setEmailPending(false); setEmailVerified(false); setCaptchaGeneration((value) => value + 1); go(loginMode ? "login" : "phone");
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
    window.location.assign(safeSignupNext(next, role ?? "landlord"));
  };
  const stage = ["phone", "verify"].includes(step) ? 0 : ["role", "name", "email", "existing"].includes(step) ? 1 : 2;
  const tailoring = ["properties", "challenge", "involvement"].includes(step);
  const canBack = ["password", "verify", "name", "email", "properties", "challenge", "involvement"].includes(step);
  const titles: Record<SignupStep, string> = {
    login: c.loginTitle, password: c.passwordTitle, phone: loginMode ? c.login : c.secure, verify: c.codeTitle, role: c.roleTitle, name: c.nameTitle, email: c.emailTitle,
    properties: c.propertiesTitle, challenge: c.challengeTitle, involvement: c.involvementTitle,
    welcome: fmt(c.welcomeTitle, { name: firstName || "Morada" }), existing: c.existingTitle, reset: c.resetTitle,
  };
  const intros: Record<SignupStep, string> = {
    login: c.loginIntro, password: email, phone: c.phoneIntro, verify: c.codeIntro, role: c.roleIntro, name: c.nameIntro, email: c.emailIntro,
    properties: c.propertiesIntro, challenge: c.challengeIntro, involvement: c.involvementIntro,
    welcome: role === "tenant" ? c.tenantWelcome : c.welcomeIntro, existing: fmt(c.existingIntro, { account }), reset: c.resetIntro,
  };
  const buttonText = step === "verify" ? c.verify : step === "involvement" ? c.finish : step === "reset" ? c.savePassword : c.continue;
  const baseUrl = preview ? "/inscription/apercu" : "/inscription";
  const routeParams = "lang=" + locale + (next ? "&next=" + encodeURIComponent(safeSignupNext(next, role ?? "landlord")) : "");
  const loginUrl = baseUrl + "?mode=login&" + routeParams;

  return <main className="signup-page" lang={htmlLang(locale)} data-preview={preview || undefined}>
    {preview && <div className="signup-preview-banner">{c.preview}</div>}
    <section className="signup-main">
      <header className="signup-header">
        <a className="signup-wordmark" href={MORADA_URL} aria-label="Morada"><GestionLogo compact /><span className="font-display font-bold">morada</span></a>
        <label className="signup-language"><span className="sr-only">{c.language}</span><select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)}>{LOCALES.map((language) => <option key={language} value={language}>{LOCALE_LABELS[language]}</option>)}</select></label>
      </header>
      <div className="signup-form-wrap">
        {step !== "phone" && step !== "login" && step !== "existing" && step !== "welcome" && step !== "reset" && <div className="signup-navigation">
          {canBack ? <button className="signup-back" type="button" onClick={back} disabled={busy} aria-label={c.back}><Icon name="back" /></button> : <span />}
          <span>{tailoring ? fmt(c.progressCount, { current: ["properties", "challenge", "involvement"].indexOf(step) + 1, total: 3 }) : stage === 0 ? c.account : c.details}</span>
          {tailoring ? <button className="signup-nav-skip" type="button" disabled={busy} onClick={() => void run(() => finish(preferences))}>{c.skip}</button> : <nav className="signup-progress" aria-label={c.progress}>
            {[c.account, c.details, c.tailor].map((label, index) => <span key={index} data-active={index === stage} data-done={index < stage} aria-current={index === stage ? "step" : undefined}><span className="signup-progress-line" /><span className="sr-only">{label}</span></span>)}
          </nav>}
        </div>}
        <div className="signup-step" key={step} data-step={step} data-backwards={direction < 0}>
          {step === "welcome" && <div className="signup-complete-icon"><Icon name="check" /></div>}
          {step === "role" && <p className="signup-verified"><Icon name="check" />{c.verified}</p>}
          <h1 id="signup-title" ref={title} tabIndex={-1} className="font-display font-bold">{titles[step]}</h1>
          <p className="signup-intro">{intros[step]}{step === "verify" && <><br /><strong dir="ltr">{phone}</strong><button type="button" className="signup-inline-link" onClick={() => go("phone", true)} disabled={busy}>{c.editNumber}</button></>}</p>

          {step === "existing" ? <div className="signup-actions">
            <button type="button" className="signup-primary" onClick={openSpace} disabled={busy}>{c.useAccount}</button>
            <button type="button" className="signup-text-button" onClick={useOtherAccount} disabled={busy}>{c.otherAccount}</button>
          </div> : step === "welcome" ? <>
            <div className="signup-welcome-summary"><Icon name="shield" /><div><strong>{c.verified}</strong><span>{c.saved}</span></div></div>
            {emailPending && <p className="signup-email-note"><Icon name="mail" />{c.emailPending}</p>}
            {previewDone ? <div className="signup-preview-end" role="status"><p>{c.previewDone}</p><button className="signup-primary" type="button" onClick={() => window.location.reload()}>{c.restart}</button></div> :
              <button className="signup-primary" type="button" onClick={openSpace}>{role === "tenant" ? c.enterTenant : c.enter}</button>}
          </> : <form ref={form} onSubmit={submit} noValidate aria-busy={busy}>
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
              {step === "role" && <Choices name="role" labels={[c.landlord, c.tenant]} values={["landlord", "tenant"]} descriptions={[c.landlordBody, c.tenantBody]} icons={["home", "key"]} selected={role} onSelect={(value) => { setRole(value as SignupRole); setError(""); }} />}
              {step === "name" && <div className="signup-fields-stack">
                <FloatingField id="signup-first" name="given-name" label={c.firstName} autoComplete="given-name" defaultValue={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={60} required error={!!error} />
                <FloatingField id="signup-last" name="family-name" label={c.lastName} autoComplete="family-name" defaultValue={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={60} required error={!!error} />
              </div>}
              {step === "email" && <FloatingField id="signup-email" name="email" label={c.email} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => { setEmail(event.target.value); setEmailVerified(false); }} maxLength={160} required error={!!error} />}
              {step === "properties" && <Choices name="properties" labels={c.properties} values={PROPERTY_VALUES} selected={preferences.properties} onSelect={(value) => { setPreferences({ ...preferences, properties: value as Preferences["properties"] }); setError(""); }} />}
              {step === "challenge" && <Choices name="challenge" labels={c.challenges} values={CHALLENGE_VALUES} selected={preferences.challenge} onSelect={(value) => { setPreferences({ ...preferences, challenge: value as Preferences["challenge"] }); setError(""); }} />}
              {step === "involvement" && <Choices name="involvement" labels={c.involvement} values={TIME_VALUES} selected={preferences.involvement} onSelect={(value) => { setPreferences({ ...preferences, involvement: value as Preferences["involvement"] }); setError(""); }} />}
            </fieldset>
            {step === "email" && emailVerified && <p className="signup-verified signup-email-verified"><Icon name="check" />{c.emailConfirmed}</p>}
            {error && !pendingPhone && <p className="signup-error" id="signup-error" role="alert">{error}</p>}
            {status && <p className="signup-status" role="status">{status}</p>}
            <button className="signup-primary" type="submit" disabled={busy || (step === "phone" && (!ready || (!preview && !captcha))) || (step === "password" && ready && !preview && !captcha)}>
              {busy ? <><span className="signup-spinner" />{c.working}</> : buttonText}
            </button>
            {((step === "email" && linkingEnabled && !emailVerified) || (step === "login" && socialLoginEnabled)) && <SocialButtons providers={providers} copy={c} disabled={busy} onContinue={continueWithProvider} />}
            {step === "password" && ready && <a className="signup-alternative" href={baseUrl + "?mode=phone&" + routeParams}>{c.phoneLogin}</a>}
            {step === "login" && <>
              {ready && <a className="signup-alternative" href={baseUrl + "?mode=phone&" + routeParams}>{c.phoneLogin}</a>}
              <p className="signup-login">{c.noAccount} <a href={baseUrl + "?" + routeParams}>{c.createAccount}</a></p>
            </>}
            {step === "phone" && <>
              {!loginMode && <p className="signup-free">{c.free}</p>}
              <p className="signup-login">{loginMode ? <><a href={loginUrl}>{c.emailLogin}</a><br />{c.noAccount} <a href={baseUrl + "?" + routeParams}>{c.createAccount}</a></> : <>{c.haveAccount} <a href={loginUrl}>{c.login}</a></>}</p>
              {!loginMode && <p className="signup-terms">{c.termsPrefix} <a href={MORADA_URL + "/" + locale + "/legal#conditions"} target="_blank" rel="noreferrer">{c.terms}</a> {c.and} <a href={MORADA_URL + "/" + locale + "/legal#confidentialite"} target="_blank" rel="noreferrer">{c.privacy}</a>.</p>}
            </>}
            {step === "verify" && <div className="signup-resend">
              <span>{c.noCode}</span>
              <button type="button" className="signup-text-button" disabled={busy || remaining > 0 || (!preview && !captcha)} onClick={() => void run(() => sendCode(phone, true))}>{remaining > 0 ? fmt(c.resendIn, { seconds: remaining }) : c.resend}</button>
              {!preview && remaining === 0 && <Turnstile key={captchaGeneration} siteKey={siteKey} onToken={setCaptcha} copy={c} locale={locale} />}
            </div>}
          </form>}
          {(step === "existing" || step === "welcome") && error && <p className="signup-error" role="alert">{error}</p>}
        </div>
      </div>
      <footer className="signup-footer"><span>© {new Date().getFullYear()} Morada</span><a href={MORADA_URL + "/" + locale + "/legal#confidentialite"}>{c.privacy}</a></footer>
    </section>
    <PhoneConfirmation number={pendingPhone} busy={busy} error={error} copy={c} onConfirm={() => void run(() => sendCode(pendingPhone))} onClose={() => { setPendingPhone(""); setError(""); }} />
    <aside className="signup-visual" aria-label={c.sideLabel}>
      <div className="signup-visual-copy"><h2 className="font-display font-bold">{c.sideTitle}</h2><span>{c.sideBody}</span></div>
      <div className="signup-art"><Image src="/signup-key.webp" alt="" fill sizes="(min-width: 1024px) 46vw, 1px" priority /></div>
      <div className="signup-visual-foot">{c.sideFoot}</div>
    </aside>
  </main>;
}

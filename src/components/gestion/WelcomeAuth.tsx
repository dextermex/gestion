"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Input } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import { readField, signInOutcome, signUpOutcome, type SignInOutcome, type SignUpOutcome } from "@/lib/auth/outcomes";
import { getSupabase, signOutEverywhere } from "@/lib/supabase/browser";
import { MORADA_URL } from "@/lib/constants";
import { fmt, type Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";

/**
 * The single door into Morada Gestion: what the product is and how to get in,
 * on one page. Both actions run against the Morada account system (the same
 * `auth.users`, the same sign-up shape as morada.lu: first/last name in the
 * user metadata, e-mail confirmation), so there is no second account system
 * and no page between here and the existing dashboard.
 *
 * Two forms, two states. "Se connecter" and "Créer un compte" are separate
 * components, mounted one at a time and remounted on every switch, so what a
 * password manager put in one never travels into the other. Each reads its
 * fields from the form at submit time, the way the browser holds them: Safari
 * fills saved credentials without firing input events, and a controlled input
 * would submit empty strings over a visibly filled form. Nothing here fights
 * the password manager; the fields just say what they are (`email`,
 * `current-password`, `new-password`) and are read when it matters.
 *
 * A visitor who is already signed in is shown that, and chooses: carry on with
 * that account, or leave it to sign in or sign up with another. Nobody is
 * bounced past the door, and nobody is silently kept on the wrong account.
 */
type Tab = "signin" | "signup";

export default function WelcomeAuth({
  d,
  next,
  locale,
  initialTab = "signin",
  initialEmail = "",
  signedInAs = null,
}: {
  d: Dict;
  next: string;
  locale: Locale;
  initialTab?: Tab;
  initialEmail?: string;
  /** The account the server verified in the cookie, if any. */
  signedInAs?: string | null;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // An address handed from one form to the other on purpose only: the
  // invitation link's, or "this address already has an account".
  const [handedEmail, setHandedEmail] = useState(initialEmail);
  const [generation, setGeneration] = useState(0);
  const [current, setCurrent] = useState<string | null>(signedInAs);
  const [switching, setSwitching] = useState(false);

  // A session arriving from a link (the confirmation e-mail, a recovery
  // link) is the visitor's own act: it opens the space. A session that merely
  // exists in this browser is never followed from here; it was shown above
  // as a choice, or the server would have said so.
  useEffect(() => {
    const fromLink = /access_token=|refresh_token=|type=(signup|magiclink|recovery|invite)|[?&]code=/.test(window.location.hash + window.location.search);
    if (!fromLink) return;
    const { data: sub } = getSupabase().auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) window.location.assign(next);
    });
    return () => sub.subscription.unsubscribe();
  }, [next]);

  const pick = (t: Tab) => {
    if (t === tab) return;
    setTab(t);
    setHandedEmail("");
    setGeneration((g) => g + 1);
  };

  // "This address already has an account": the sign-in form opens on it.
  const handToSignIn = (email: string) => {
    setTab("signin");
    setHandedEmail(email);
    setGeneration((g) => g + 1);
  };

  // Leaving the signed-in account before signing in as, or creating, another.
  const useOtherAccount = async () => {
    setSwitching(true);
    try {
      await signOutEverywhere();
    } finally {
      setCurrent(null);
      setSwitching(false);
      setTab("signin");
      setHandedEmail("");
      setGeneration((g) => g + 1);
    }
  };

  const points = [d.auth.pitchPoint1, d.auth.pitchPoint2, d.auth.pitchPoint3];

  return (
    <div className="flex min-h-dvh flex-col bg-sand-50">
      <div className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.1fr_minmax(360px,1fr)] lg:gap-16">
        {/* ------------------------------- the pitch ------------------------------- */}
        <div className="max-lg:text-center">
          <div className="flex max-lg:justify-center">
            <a href={`${MORADA_URL}/welcome`} aria-label="Morada">
              <GestionLogo />
            </a>
          </div>
          <h1 className="mt-7 text-balance font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {d.auth.title}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-ink-soft lg:mx-0">{d.auth.pitch}</p>
          <ul className="mt-6 space-y-2.5 max-lg:mx-auto max-lg:max-w-xs">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm text-ink max-lg:text-left">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                  <Check />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <p className="mt-7 text-xs font-semibold text-ink-soft">{d.auth.oneAccount}</p>
        </div>

        {/* ------------------------------- the door ------------------------------- */}
        <div className="w-full">
          <div className="rounded-2xl border border-sand-200 bg-white p-6 shadow-sm sm:p-7">
            {current ? (
              <div data-testid="signed-in-card">
                <h2 className="font-display text-xl font-bold tracking-tight text-ink">{d.auth.signedInTitle}</h2>
                <p className="mt-2 text-sm text-ink" data-testid="signed-in-email">
                  {fmt(d.auth.signedInAs, { email: current })}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-ink-soft">{d.auth.signedInHint}</p>
                <div className="mt-5 flex flex-col gap-3">
                  <a
                    href={next}
                    className="tactile inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    {d.auth.continueAs}
                  </a>
                  <button
                    type="button"
                    onClick={useOtherAccount}
                    disabled={switching}
                    className="tactile inline-flex min-h-11 items-center justify-center rounded-xl border border-sand-200 bg-white px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-brand-300 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
                  >
                    {switching ? d.auth.switching : d.auth.useOtherAccount}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div
                  role="tablist"
                  aria-label={d.auth.title}
                  className="grid grid-cols-2 gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1"
                >
                  {(["signin", "signup"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      id={`tab-${t}`}
                      aria-selected={tab === t}
                      aria-controls={`panel-${t}`}
                      onClick={() => pick(t)}
                      className={
                        "rounded-lg px-3 py-2 text-sm font-semibold transition " +
                        (tab === t ? "bg-white text-brand-800 shadow-sm" : "text-ink-soft hover:text-ink")
                      }
                    >
                      {t === "signin" ? d.auth.tabSignIn : d.auth.tabSignUp}
                    </button>
                  ))}
                </div>

                {tab === "signin" ? (
                  <SignInForm key={`signin-${generation}`} d={d} next={next} initialEmail={handedEmail} />
                ) : (
                  <SignUpForm key={`signup-${generation}`} d={d} next={next} locale={locale} initialEmail={handedEmail} onExists={handToSignIn} />
                )}
              </>
            )}
          </div>

          <p className="mt-4 text-center text-xs font-semibold">
            <a href={MORADA_URL} className="text-ink-soft hover:text-brand-700">
              {d.auth.backToMorada}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Se connecter ------------------------------- */

function SignInForm({ d, next, initialEmail }: { d: Dict; next: string; initialEmail: string }) {
  const [state, setState] = useState<"idle" | "working" | Exclude<SignInOutcome, "ok">>("idle");
  const [forgot, setForgot] = useState<"idle" | "sending" | "sent" | "needEmail" | "failed">("idle");
  const [resend, setResend] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const formRef = useRef<HTMLFormElement>(null);

  // The address as the field holds it right now, autofill included.
  const emailInField = (): string => (formRef.current ? readField(new FormData(formRef.current), "email") : "");

  const signIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = readField(data, "email");
    const password = readField(data, "password", { trim: false });
    if (email === "" || password === "") {
      setState("invalid");
      return;
    }
    setState("working");
    setResend("idle");
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email, password });
      const outcome = signInOutcome(error);
      if (outcome === "ok") {
        window.location.assign(next);
        return;
      }
      setState(outcome);
    } catch {
      setState("down");
    }
  };

  const sendReset = async () => {
    const email = emailInField();
    if (email === "") {
      setForgot("needEmail");
      return;
    }
    setForgot("sending");
    try {
      const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo: `${MORADA_URL}/auth/reset` });
      setForgot(error ? "failed" : "sent");
    } catch {
      setForgot("failed");
    }
  };

  // The confirmation link again, for an account that never opened its first one.
  const resendConfirmation = async () => {
    const email = emailInField();
    if (email === "") return;
    setResend("sending");
    try {
      const { error } = await getSupabase().auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/connexion?next=${encodeURIComponent(next)}` },
      });
      setResend(error ? "failed" : "sent");
    } catch {
      setResend("failed");
    }
  };

  const message: Record<Exclude<SignInOutcome, "ok">, string> = {
    invalid: d.auth.failed,
    unconfirmed: d.auth.unconfirmed,
    rate_limited: d.auth.rateLimited,
    down: d.auth.unavailable,
    failed: d.auth.genericFailed,
  };

  return (
    <form ref={formRef} id="signin-form" role="tabpanel" aria-labelledby="tab-signin" onSubmit={signIn} className="mt-5 space-y-4">
      <Field label={d.auth.email}>
        <Input
          id="signin-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={160}
          defaultValue={initialEmail}
        />
      </Field>
      <Field label={d.auth.password}>
        <Input id="signin-password" name="password" type="password" autoComplete="current-password" required maxLength={200} />
      </Field>
      {state !== "idle" && state !== "working" && (
        <div role="alert" className="space-y-2">
          <p className="text-xs font-semibold text-red-700" data-testid="signin-message">
            {message[state]}
          </p>
          {state === "unconfirmed" && (
            <p className="text-xs">
              {resend === "sent" ? (
                <span className="font-semibold text-emerald-800">{d.auth.resent}</span>
              ) : resend === "failed" ? (
                <span className="font-semibold text-amber-800">{d.auth.resendFailed}</span>
              ) : (
                <button type="button" onClick={resendConfirmation} disabled={resend === "sending"} className="font-semibold text-brand-700 hover:underline disabled:opacity-60">
                  {resend === "sending" ? d.auth.resendSending : d.auth.resend}
                </button>
              )}
            </p>
          )}
        </div>
      )}
      <Button type="submit" className="w-full" disabled={state === "working"}>
        {state === "working" ? d.auth.working : d.auth.accessSpace}
      </Button>
      <div className="text-center">
        <button
          type="button"
          onClick={sendReset}
          disabled={forgot === "sending"}
          className="text-xs font-semibold text-ink-soft hover:text-brand-700 disabled:opacity-60"
        >
          {forgot === "sending" ? d.auth.forgotSending : d.auth.forgot}
        </button>
        {forgot !== "idle" && forgot !== "sending" && (
          <p
            role="status"
            className={
              "mt-2 rounded-xl px-3 py-2.5 text-left text-xs leading-relaxed " +
              (forgot === "sent" ? "bg-emerald-50 font-semibold text-emerald-800" : "bg-amber-50 font-semibold text-amber-800")
            }
          >
            {forgot === "sent" ? d.auth.forgotSent : forgot === "needEmail" ? d.auth.forgotNeedEmail : d.auth.forgotFailed}
          </p>
        )}
      </div>
    </form>
  );
}

/* ------------------------------ Créer un compte ------------------------------ */

function SignUpForm({
  d,
  next,
  locale,
  initialEmail,
  onExists,
}: {
  d: Dict;
  next: string;
  locale: Locale;
  initialEmail: string;
  onExists: (email: string) => void;
}) {
  const [state, setState] = useState<"idle" | "working" | Exclude<SignUpOutcome, "session">>("idle");
  const [existingEmail, setExistingEmail] = useState("");

  const signUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = readField(data, "email").toLowerCase();
    const password = readField(data, "new-password", { trim: false });
    const first = readField(data, "given-name");
    const last = readField(data, "family-name");
    if (email === "" || password === "") {
      setState("failed");
      return;
    }
    if (password.length < 6) {
      setState("weak_password");
      return;
    }
    setState("working");
    try {
      // Mirrors morada.lu's registration exactly, metadata keys included, so
      // the same profile trigger runs and the account works in all three
      // spaces from the first minute.
      const { data: answer, error } = await getSupabase().auth.signUp({
        email,
        password,
        options: {
          data: { first_name: first, last_name: last, phone: "", preferred_language: locale },
          emailRedirectTo: `${window.location.origin}/connexion?next=${encodeURIComponent(next)}`,
        },
      });
      const outcome = signUpOutcome(answer, error);
      if (outcome === "session") {
        window.location.assign(next);
        return;
      }
      if (outcome === "exists") setExistingEmail(email);
      setState(outcome);
    } catch {
      setState("down");
    }
  };

  if (state === "confirm") {
    return (
      <p role="status" className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-800" data-testid="signup-confirm">
        {d.auth.signupConfirmSent}
      </p>
    );
  }

  const message: Record<Exclude<SignUpOutcome, "session" | "confirm">, string> = {
    exists: d.auth.exists,
    weak_password: d.auth.weakPassword,
    rate_limited: d.auth.rateLimited,
    down: d.auth.unavailable,
    failed: d.auth.signupFailed,
  };

  return (
    <form id="signup-form" role="tabpanel" aria-labelledby="tab-signup" onSubmit={signUp} className="mt-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label={d.auth.firstName}>
          <Input id="signup-first-name" name="given-name" autoComplete="given-name" required maxLength={60} />
        </Field>
        <Field label={d.auth.lastName}>
          <Input id="signup-last-name" name="family-name" autoComplete="family-name" required maxLength={60} />
        </Field>
      </div>
      <Field label={d.auth.email}>
        <Input
          id="signup-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={160}
          defaultValue={initialEmail}
        />
      </Field>
      <Field label={d.auth.password} hint={d.auth.passwordHint}>
        <Input id="signup-password" name="new-password" type="password" autoComplete="new-password" required minLength={6} maxLength={200} />
      </Field>
      {state !== "idle" && state !== "working" && (
        <div role="alert" className="space-y-2" data-testid="signup-message">
          <p className={"text-xs font-semibold " + (state === "exists" ? "text-amber-800" : "text-red-700")}>{message[state]}</p>
          {state === "exists" && (
            <button type="button" onClick={() => onExists(existingEmail)} className="text-xs font-semibold text-brand-700 hover:underline" data-testid="signup-exists-signin">
              {d.auth.existsSignIn}
            </button>
          )}
        </div>
      )}
      <Button type="submit" className="w-full" disabled={state === "working"}>
        {state === "working" ? d.auth.signupWorking : d.auth.signupSubmit}
      </Button>
    </form>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
    </svg>
  );
}

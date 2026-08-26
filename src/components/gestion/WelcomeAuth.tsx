"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import { getSupabase } from "@/lib/supabase/browser";
import { MORADA_URL } from "@/lib/constants";
import type { Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";

/**
 * The single door into Morada Gestion: what the product is and how to get in,
 * on one page. Both actions run against the Morada account system — the same
 * `auth.users`, the same sign-up shape as morada.lu (first/last name in the
 * user metadata, e-mail confirmation) — so there is no second account system
 * and no page between here and the existing dashboard.
 */
export default function WelcomeAuth({ d, next, locale }: { d: Dict; next: string; locale: Locale }) {
  const [tab, setTab] = useState<"signin" | "signup">("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");

  const [state, setState] = useState<
    "idle" | "working" | "failed" | "down" | "confirmSent" | "signupFailed"
  >("idle");
  const [forgot, setForgot] = useState<"idle" | "sending" | "sent" | "needEmail" | "failed">("idle");

  // The e-mail confirmation link returns here with the session in the URL
  // fragment; the client picks it up and the visitor lands in their space
  // without touching the form.
  useEffect(() => {
    const { data: sub } = getSupabase().auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        window.location.assign(next);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [next]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("working");
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email, password });
      if (error) {
        const unreachable = error.name === "AuthRetryableFetchError" || !error.status;
        setState(unreachable ? "down" : "failed");
        return;
      }
      window.location.assign(next);
    } catch {
      setState("down");
    }
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("working");
    try {
      // Mirrors morada.lu's registration exactly, metadata keys included, so
      // the same profile trigger runs and the account works in all three
      // spaces from the first minute.
      const { data, error } = await getSupabase().auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            first_name: first.trim(),
            last_name: last.trim(),
            phone: "",
            preferred_language: locale,
          },
          emailRedirectTo: `${window.location.origin}/connexion?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        const unreachable = error.name === "AuthRetryableFetchError" || !error.status;
        setState(unreachable ? "down" : "signupFailed");
        return;
      }
      if (data.session) {
        window.location.assign(next);
        return;
      }
      setState("confirmSent");
    } catch {
      setState("down");
    }
  };

  const sendReset = async () => {
    if (email.trim() === "") {
      setForgot("needEmail");
      return;
    }
    setForgot("sending");
    const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${MORADA_URL}/auth/reset`,
    });
    setForgot(error ? "failed" : "sent");
  };

  const pick = (t: "signin" | "signup") => {
    setTab(t);
    setState("idle");
    setForgot("idle");
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                  </svg>
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
            <div
              role="tablist"
              aria-label={d.auth.title}
              className="grid grid-cols-2 gap-1 rounded-xl border border-sand-200 bg-sand-50 p-1"
            >
              {(["signin", "signup"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
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

            {state === "confirmSent" ? (
              <p role="status" className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-800">
                {d.auth.signupConfirmSent}
              </p>
            ) : tab === "signin" ? (
              <form onSubmit={signIn} className="mt-5 space-y-4">
                <Field label={d.auth.email}>
                  <Input
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus
                    maxLength={160}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label={d.auth.password}>
                  <Input
                    type="password"
                    required
                    autoComplete="current-password"
                    maxLength={200}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                {(state === "failed" || state === "down") && (
                  <p role="alert" className="text-xs font-semibold text-red-700">
                    {state === "failed" ? d.auth.failed : d.auth.unavailable}
                  </p>
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
                        (forgot === "sent"
                          ? "bg-emerald-50 font-semibold text-emerald-800"
                          : "bg-amber-50 font-semibold text-amber-800")
                      }
                    >
                      {forgot === "sent"
                        ? d.auth.forgotSent
                        : forgot === "needEmail"
                          ? d.auth.forgotNeedEmail
                          : d.auth.forgotFailed}
                    </p>
                  )}
                </div>
              </form>
            ) : (
              <form onSubmit={signUp} className="mt-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={d.auth.firstName}>
                    <Input
                      required
                      autoComplete="given-name"
                      maxLength={60}
                      value={first}
                      onChange={(e) => setFirst(e.target.value)}
                    />
                  </Field>
                  <Field label={d.auth.lastName}>
                    <Input
                      required
                      autoComplete="family-name"
                      maxLength={60}
                      value={last}
                      onChange={(e) => setLast(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label={d.auth.email}>
                  <Input
                    type="email"
                    required
                    autoComplete="email"
                    maxLength={160}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label={d.auth.password}>
                  <Input
                    type="password"
                    required
                    autoComplete="new-password"
                    minLength={6}
                    maxLength={200}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                {(state === "signupFailed" || state === "down") && (
                  <p role="alert" className="text-xs font-semibold text-red-700">
                    {state === "signupFailed" ? d.auth.signupFailed : d.auth.unavailable}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={state === "working"}>
                  {state === "working" ? d.auth.signupWorking : d.auth.signupSubmit}
                </Button>
              </form>
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

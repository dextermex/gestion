"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/pro/ui";
import GestionLogo from "@/components/gestion/GestionLogo";
import { getSupabase } from "@/lib/supabase/browser";
import { MORADA_URL } from "@/lib/constants";
import type { Dict } from "@/lib/i18n/fr";

/**
 * Sign-in with the Morada account. Same project, same `auth.users`, same
 * credentials as morada.lu: this creates no second account and no second
 * identity. Once the shared cookie is live on .morada.lu, an already
 * signed-in visitor never reaches this screen at all.
 */
export default function SignIn({ d, next }: { d: Dict; next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "working" | "failed" | "down">("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("working");
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email, password });
      if (error) {
        // supabase-js does not throw when the network is the problem: it
        // returns a retryable error instead. Reporting that as "wrong
        // password" sends people hunting for a typo that isn't there, so the
        // two cases are told apart here.
        const unreachable = error.name === "AuthRetryableFetchError" || !error.status;
        setState(unreachable ? "down" : "failed");
        return;
      }
      // A full reload, not a client transition: the server must re-read the
      // session cookie to resolve the workspace.
      window.location.assign(next);
    } catch {
      setState("down");
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-sand-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <GestionLogo />
        </div>
        <h1 className="mt-7 text-balance text-center font-display text-2xl font-bold tracking-tight text-ink">
          {d.auth.title}
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-relaxed text-ink-soft">{d.auth.sub}</p>

        <form onSubmit={submit} className="mt-7 space-y-4 rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">
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
            {state === "working" ? d.auth.working : d.auth.submit}
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-between text-xs font-semibold">
          <a href={`${MORADA_URL}/auth/reset`} className="text-ink-soft hover:text-brand-700">
            {d.auth.forgot}
          </a>
          <a href={MORADA_URL} className="text-ink-soft hover:text-brand-700">
            {d.auth.backToMorada}
          </a>
        </div>
      </div>
      <button type="button" hidden onClick={() => router.refresh()} aria-hidden />
    </div>
  );
}

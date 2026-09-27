import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";

/** Activate the new entry only after SMS and CAPTCHA are configured. */
export default async function Home() {
  const signupReady = process.env.NEXT_PUBLIC_PHONE_SIGNUP_ENABLED === "1" && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  redirect((await getSession()) ? "/app" : signupReady ? "/inscription" : "/connexion");
}

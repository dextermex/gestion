"use client";
import { useState } from "react";

/** One-use CAPTCHA tokens for the existing email auth forms. */
export function useAuthChallenge() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const required = process.env.NEXT_PUBLIC_PHONE_SIGNUP_ENABLED === "1" && !!siteKey;
  const [token, setToken] = useState("");
  const [generation, setGeneration] = useState(0);
  const consume = () => { setToken(""); setGeneration((value) => value + 1); };
  return { siteKey, required, token, setToken, generation, consume, blocked: required && !token };
}

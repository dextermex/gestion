"use client";
import Image from "next/image";
import type { SignupCopy } from "@/lib/i18n/signup";
import type { SocialProvider } from "@/lib/signup/social";

export default function SocialButtons({ providers, copy, disabled, onContinue }: {
  providers: SocialProvider[]; copy: SignupCopy; disabled: boolean; onContinue: (provider: SocialProvider) => void;
}) {
  if (!providers.length) return null;
  return <div className="signup-social">
    <div className="signup-divider"><span>{copy.or}</span></div>
    {providers.map((provider) => <button key={provider} type="button" className="signup-provider" data-provider={provider} disabled={disabled} onClick={() => onContinue(provider)}>
      {provider === "google" ? <Image src="/auth/google-g.png" alt="" width={20} height={20} /> : <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M17.05 12.54c.02 3.11 2.73 4.15 2.76 4.16-.02.07-.43 1.48-1.43 2.94-.87 1.26-1.78 2.52-3.2 2.55-1.39.03-1.84-.83-3.43-.83-1.59 0-2.09.8-3.41.86-1.37.05-2.41-1.37-3.28-2.63-1.79-2.58-3.15-7.3-1.31-10.49.91-1.58 2.54-2.58 4.3-2.61 1.34-.02 2.61.91 3.43.91.83 0 2.37-1.13 4-0.96.68.03 2.58.28 3.8 2.07-.1.06-2.27 1.33-2.23 4.03ZM14.43 4.69c.72-.87 1.21-2.07 1.08-3.27-1.04.04-2.3.69-3.05 1.56-.67.77-1.25 2-1.09 3.18 1.16.09 2.34-.59 3.06-1.47Z" /></svg>}
      <span>{copy[provider]}</span>
    </button>)}
  </div>;
}

import type { Locale } from "@/lib/i18n/config";
import type { DocumentKind } from "../kinds";
import { fr, type KindWording, type Wording } from "./fr";

/**
 * The templates that exist, by language. A language without an entry has
 * no template: nothing is translated on the fly, and the settings screen
 * offers only the languages listed here. Each kind carries its own version;
 * an org validates a (kind, language, version) and a changed version asks
 * for validation again.
 */
export const WORDING: Partial<Record<Locale, Wording>> = { fr };

export function wordingFor(lang: Locale): Wording | null {
  return WORDING[lang] ?? null;
}

export function templateFor(kind: DocumentKind, lang: Locale): KindWording | null {
  return WORDING[lang]?.kinds[kind] ?? null;
}

export function templateVersion(kind: DocumentKind, lang: Locale): string | null {
  return templateFor(kind, lang)?.version ?? null;
}

export function availableLanguages(kind: DocumentKind): Locale[] {
  return (Object.keys(WORDING) as Locale[]).filter((lang) => Boolean(WORDING[lang]?.kinds[kind]));
}

export type { KindWording, Wording } from "./fr";

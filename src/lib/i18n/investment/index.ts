import { investmentFr } from "./fr";
import { investmentEn } from "./en";
import { investmentDe } from "./de";
import { investmentLu } from "./lu";
import type { Locale } from "../config";
export const investmentCopy = { fr: investmentFr, en: investmentEn, de: investmentDe, lu: investmentLu };
export function getInvestmentCopy(locale: Locale) { return investmentCopy[locale]; }

import { addMonths } from "@/domain/dates";

/**
 * The months a manager can page through around today: four back, this one,
 * and the next. Accueil and Loyers read the same list, so a month shown on
 * one always opens on the other (Accueil stops at this month: nothing has
 * come in for the next one yet).
 */
export function monthWindow(liveMonth: string): string[] {
  return [-4, -3, -2, -1, 0, 1].map((k) => addMonths(`${liveMonth}-01`, k).slice(0, 7));
}

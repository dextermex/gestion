/**
 * Arrears ladder (strategy §4.3) — aligned with law, never ahead of it:
 *
 *   D+3   friendly reminder (email/portal)
 *   D+10  formal reminder
 *   D+24  mise en demeure by REGISTERED LETTER with AR — manager-confirmed,
 *         never auto-sent; its legal effect runs from the AR date
 *   D+45  one-click justice-de-paix dossier export
 *
 * A live payment plan pauses the ladder. There is NO utility-cutoff workflow
 * anywhere in the product — cutting a tenant's utilities is unlawful.
 */

import { Cents } from "@/domain/money";
import { ISODate, addDays, diffDays } from "@/domain/dates";

export type ArrearsStage =
  | "none"
  | "friendly"
  | "formal"
  | "mise_en_demeure"
  | "justice_dossier";

export interface ArrearsStep {
  stage: Exclude<ArrearsStage, "none">;
  dueFrom: ISODate;
  autoSend: boolean;
  requiresRegisteredLetter: boolean;
  description: string;
}

export const LADDER_OFFSETS: Record<Exclude<ArrearsStage, "none">, number> = {
  friendly: 3,
  formal: 10,
  mise_en_demeure: 24,
  justice_dossier: 45,
};

export interface ArrearsCase {
  invoiceId: string;
  dueDate: ISODate;
  openAmount: Cents;
  paymentPlanActive: boolean;
  /** Stages already executed (with their dates). */
  executed: Partial<Record<Exclude<ArrearsStage, "none">, ISODate>>;
  miseEnDemeureArDate: ISODate | null;
}

export interface ArrearsAssessment {
  daysOverdue: number;
  currentStage: ArrearsStage;
  nextStep: ArrearsStep | null;
  paused: boolean;
  notes: string[];
}

export function assessArrears(c: ArrearsCase, asOf: ISODate): ArrearsAssessment {
  const daysOverdue = Math.max(0, diffDays(c.dueDate, asOf));
  const notes: string[] = [];

  if (c.openAmount <= 0) {
    return { daysOverdue: 0, currentStage: "none", nextStep: null, paused: false, notes: ["Nothing open."] };
  }

  if (c.paymentPlanActive) {
    return {
      daysOverdue,
      currentStage: latestExecuted(c),
      nextStep: null,
      paused: true,
      notes: ["Payment plan active — ladder paused. A missed instalment reactivates it."],
    };
  }

  const order: Array<Exclude<ArrearsStage, "none">> = [
    "friendly",
    "formal",
    "mise_en_demeure",
    "justice_dossier",
  ];

  for (const stage of order) {
    if (c.executed[stage]) continue;
    const threshold = LADDER_OFFSETS[stage];
    if (daysOverdue >= threshold) {
      const step: ArrearsStep = {
        stage,
        dueFrom: addDays(c.dueDate, threshold),
        autoSend: stage === "friendly" || stage === "formal",
        requiresRegisteredLetter: stage === "mise_en_demeure",
        description: describeStage(stage),
      };
      if (stage === "mise_en_demeure") {
        notes.push(
          "Mise en demeure requires manager confirmation and a registered letter with AR — the legal effect date is the AR date, not the send date.",
        );
      }
      if (stage === "justice_dossier" && !c.miseEnDemeureArDate) {
        notes.push("Justice-de-paix dossier needs the mise en demeure AR evidence first.");
        return { daysOverdue, currentStage: latestExecuted(c), nextStep: null, paused: false, notes };
      }
      return { daysOverdue, currentStage: latestExecuted(c), nextStep: step, paused: false, notes };
    }
    // Stage not yet due — nothing further down the ladder can be due either.
    return {
      daysOverdue,
      currentStage: latestExecuted(c),
      nextStep: {
        stage,
        dueFrom: addDays(c.dueDate, threshold),
        autoSend: stage === "friendly" || stage === "formal",
        requiresRegisteredLetter: stage === "mise_en_demeure",
        description: `${describeStage(stage)} (from ${addDays(c.dueDate, threshold)})`,
      },
      paused: false,
      notes,
    };
  }

  return { daysOverdue, currentStage: latestExecuted(c), nextStep: null, paused: false, notes };
}

function latestExecuted(c: ArrearsCase): ArrearsStage {
  if (c.executed.justice_dossier) return "justice_dossier";
  if (c.executed.mise_en_demeure) return "mise_en_demeure";
  if (c.executed.formal) return "formal";
  if (c.executed.friendly) return "friendly";
  return "none";
}

function describeStage(stage: Exclude<ArrearsStage, "none">): string {
  switch (stage) {
    case "friendly":
      return "Friendly reminder — portal notification + email.";
    case "formal":
      return "Formal reminder — written demand with the account statement.";
    case "mise_en_demeure":
      return "Mise en demeure — registered letter with AR (manager confirms before dispatch).";
    case "justice_dossier":
      return "Justice de paix dossier — export the complete evidence pack (lease, statement, letters, AR proofs).";
  }
}

import { describe, expect, it } from "vitest";
import { apiProblem, networkProblem, readApiProblem, signInHref, type ApiErrorCopy } from "@/lib/api-errors";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";
import { de } from "@/lib/i18n/de";
import { lu } from "@/lib/i18n/lu";

/**
 * A refused request is told in words that fit the refusal: the session, the
 * subscription, the role, the conflict, the file, the field, a feature the
 * base does not carry yet. The general line is kept for what is left.
 */
const copies: Record<string, ApiErrorCopy> = { fr: fr.apiErrors, en: en.apiErrors, de: de.apiErrors, lu: lu.apiErrors };
const c = fr.apiErrors;

describe("what a refusal says", () => {
  it("401: the session ended, with the way back in", () => {
    const p = apiProblem(401, { error: "unauthenticated" }, c, { returnTo: "/app/biens/p-1?onglet=lots" });
    expect(p.kind).toBe("session");
    expect(p.message).toBe(c.session);
    expect(p.link).toEqual({ href: "/connexion?next=%2Fapp%2Fbiens%2Fp-1%3Fonglet%3Dlots", label: c.signIn, newTab: false });
  });

  it("401 on a form that still holds what was typed: signing in opens beside it", () => {
    const p = apiProblem(401, { error: "session_expired" }, c, { returnTo: "/app", keepsInput: true });
    expect(p.message).toBe(c.sessionKeep);
    expect(p.link?.newTab).toBe(true);
  });

  it("402: a subscription is needed, with the page that offers one", () => {
    const p = apiProblem(402, { error: "subscription_required" }, c);
    expect(p.kind).toBe("subscription");
    expect(p.message).toBe(c.subscription);
    expect(p.link?.href).toBe("/app/abonnement");
  });

  it("403: the role does not allow it; sample data says it is sample data", () => {
    expect(apiProblem(403, { error: "forbidden" }, c).message).toBe(c.forbidden);
    expect(apiProblem(403, { error: "no_workspace" }, c).kind).toBe("forbidden");
    expect(apiProblem(403, { error: "sample_read_only" }, c).message).toBe(c.sample);
  });

  it("404: the item is gone", () => {
    expect(apiProblem(404, { error: "not_found" }, c).message).toBe(c.notFound);
  });

  it("409: says what conflicts, by the route's code", () => {
    expect(apiProblem(409, { error: "email_taken" }, c).message).toBe(c.conflicts.email_taken);
    expect(apiProblem(409, { error: "already_let" }, c).message).toBe(c.conflicts.already_let);
    expect(apiProblem(409, { error: "changed" }, c).message).toBe(c.conflicts.changed);
    expect(apiProblem(409, { error: "lease_ended" }, c).message).toBe(c.conflicts.lease_ended);
    // Two names for one state.
    expect(apiProblem(409, { error: "lease_not_live" }, c).message).toBe(c.conflicts.not_live);
    expect(apiProblem(409, { error: "no_live_lease" }, c).message).toBe(c.conflicts.not_live);
    // A code this module does not know still reads as a conflict, never as "try again".
    const unknown = apiProblem(409, { error: "some_new_code" }, c);
    expect(unknown.kind).toBe("conflict");
    expect(unknown.message).toBe(c.conflict);
  });

  it("409: a form's own sentence for a code wins", () => {
    expect(apiProblem(409, { error: "refused" }, c, { codes: { refused: "La loi ne permet pas d'ajustement pour l'instant." } }).message).toBe(
      "La loi ne permet pas d'ajustement pour l'instant.",
    );
  });

  it("413: the file is too large, with the limit when it is known", () => {
    expect(apiProblem(413, { error: "too_large" }, c).message).toBe(c.tooLarge);
    expect(apiProblem(413, { error: "too_large" }, c, { maxMb: 25 }).message).toBe("Le fichier est trop volumineux : 25 Mo au maximum.");
    expect(apiProblem(413, { error: "too_large", maxMb: 10 }, c).message).toContain("10 Mo");
    // A proxy that cuts the upload answers 413 with a page, not with JSON.
    expect(apiProblem(413, null, c, { maxMb: 8 }).message).toContain("8 Mo");
  });

  it("415: the type of file is not accepted", () => {
    expect(apiProblem(415, { error: "unsupported_type" }, c).message).toBe(c.unsupportedType);
  });

  it("400 and 422: names the field when the route does and the form knows it", () => {
    expect(apiProblem(400, { error: "invalid" }, c).message).toBe(c.invalid);
    expect(apiProblem(400, { error: "invalid", field: "birthDate" }, c, { fields: { birthDate: "Date de naissance" } }).message).toBe(
      "Le champ « Date de naissance » n'est pas valide.",
    );
    // The settings route names it as `problem`.
    expect(apiProblem(400, { error: "invalid", problem: "iban" }, c, { fields: { iban: "IBAN" } }).message).toBe("Le champ « IBAN » n'est pas valide.");
    // A field the form has no label for is not printed as a raw name.
    expect(apiProblem(422, { error: "invalid", field: "rent_cents" }, c).message).toBe(c.invalid);
    expect(apiProblem(400, { error: "nothing_to_update" }, c).message).toBe(c.nothing);
    expect(apiProblem(400, { error: "invalid_iban" }, c, { codes: { invalid_iban: "IBAN invalide." } }).message).toBe("IBAN invalide.");
  });

  it("503 schema_outdated: the feature is not available yet", () => {
    expect(apiProblem(503, { error: "schema_outdated" }, c).message).toBe(c.unavailable);
    expect(apiProblem(503, { error: "schema_unexposed" }, c).kind).toBe("unavailable");
    // Another 503 is not a missing feature.
    expect(apiProblem(503, { error: "not_configured" }, c).kind).toBe("generic");
  });

  it("keeps the general line for the rest, or the form's own", () => {
    expect(apiProblem(502, { error: "storage_failed" }, c).message).toBe(c.generic);
    expect(apiProblem(500, "<html>", c).message).toBe(c.generic);
    expect(apiProblem(502, { error: "storage_failed" }, c, { fallback: "L'enregistrement n'a pas abouti." }).message).toBe("L'enregistrement n'a pas abouti.");
    // The form's line never replaces a refusal that has a reason.
    expect(apiProblem(403, { error: "forbidden" }, c, { fallback: "L'enregistrement n'a pas abouti." }).message).toBe(c.forbidden);
  });

  it("a request that never arrived is the network, not the server", () => {
    const p = networkProblem(c);
    expect(p.kind).toBe("network");
    expect(p.status).toBe(0);
    expect(p.message).toBe(c.network);
  });

  it("reads a response once, JSON or not", async () => {
    const json = new Response(JSON.stringify({ error: "email_taken" }), { status: 409, headers: { "Content-Type": "application/json" } });
    expect((await readApiProblem(json, c)).message).toBe(c.conflicts.email_taken);
    const page = new Response("<html>Bad gateway</html>", { status: 502 });
    expect((await readApiProblem(page, c)).message).toBe(c.generic);
  });

  it("builds the sign-in address with the return path encoded", () => {
    expect(signInHref("/app/biens/etat-des-lieux?bail=l-1")).toBe("/connexion?next=%2Fapp%2Fbiens%2Fetat-des-lieux%3Fbail%3Dl-1");
  });
});

describe("the sentences in the four languages", () => {
  const flat = (o: Record<string, unknown>, prefix = ""): Array<[string, string]> =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[prefix + k, v] as [string, string]] : flat(v as Record<string, unknown>, `${prefix}${k}.`)));

  it("say every refusal in each of them", () => {
    for (const [lang, copy] of Object.entries(copies)) {
      const statuses: Array<[number, string]> = [
        [401, "unauthenticated"],
        [402, "subscription_required"],
        [403, "forbidden"],
        [403, "sample_read_only"],
        [404, "not_found"],
        [409, "changed"],
        [409, "anything"],
        [413, "too_large"],
        [415, "unsupported_type"],
        [400, "invalid"],
        [400, "nothing_to_update"],
        [503, "schema_outdated"],
        [502, "storage_failed"],
        [0, ""],
      ];
      const said = statuses.map(([status, error]) => apiProblem(status, { error }, copy, { returnTo: "/app" }).message);
      for (const line of said) expect(line.length, lang).toBeGreaterThan(10);
      // Each refusal has its own sentence.
      expect(new Set(said).size, lang).toBe(statuses.length);
    }
  });

  it("carry the same placeholders and none of the marks the house style forbids", () => {
    const reference = flat(fr.apiErrors);
    for (const [lang, copy] of Object.entries(copies)) {
      const lines = flat(copy);
      expect(lines.map(([k]) => k), lang).toEqual(reference.map(([k]) => k));
      for (const [key, line] of lines) {
        expect(line, `${lang}.${key}`).not.toMatch(/[—→]/);
        const ref = reference.find(([k]) => k === key)![1];
        expect(line.match(/\{\w+\}/g) ?? [], `${lang}.${key}`).toEqual(ref.match(/\{\w+\}/g) ?? []);
      }
    }
  });
});

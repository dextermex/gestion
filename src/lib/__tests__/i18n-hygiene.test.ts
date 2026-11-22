import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";
import { de } from "@/lib/i18n/de";
import { lu } from "@/lib/i18n/lu";
import { signupCopy } from "@/lib/i18n/signup";
import { fmt } from "@/lib/i18n/config";
import { buildRealDataFrom } from "@/lib/demo/data-real";
import { orgFromWorkspace } from "@/lib/demo/data-empty";
import { FakeDb } from "./helpers/fake-postgrest";

/**
 * What a person reads is written in their language and in the product's
 * typography: no em dash, no en dash, no arrow (periods, commas, colons,
 * parentheses; a middot joins entity labels), and no sentence typed into a
 * component instead of the dictionaries. The one dash allowed is the empty
 * cell's placeholder, `common.none`.
 */

const DICTS = { fr, en, de, lu } as const;
const FORBIDDEN = /[—–→←⇒➔]|->/;

/** Every string leaf of a dictionary, with its path. */
function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

describe("the dictionaries", () => {
  it("carry no dash and no arrow, but the empty cell's placeholder", () => {
    for (const [lang, dict] of Object.entries(DICTS)) {
      const bad = leaves(dict).filter(([path, text]) => path !== "common.none" && FORBIDDEN.test(text));
      expect(bad, lang).toEqual([]);
    }
    for (const [lang, copy] of Object.entries(signupCopy)) {
      expect(leaves(copy).filter(([, text]) => FORBIDDEN.test(text)), lang).toEqual([]);
    }
  });

  it("name the tab and describe the product in each language", () => {
    for (const dict of Object.values(DICTS)) {
      expect(dict.meta.title.startsWith("Morada Gestion · ")).toBe(true);
      expect(dict.meta.description.length).toBeGreaterThan(40);
    }
    expect(new Set(Object.values(DICTS).map((d) => d.meta.title)).size).toBe(4);
  });

  it("write the last message of a thread with each language's colon", () => {
    expect(fmt(fr.baux.lastMessage, { from: fr.messages.systemSender, body: "Attestation générée" })).toBe("Système : Attestation générée");
    expect(fmt(en.baux.lastMessage, { from: en.messages.systemSender, body: "Certificate issued" })).toBe("System: Certificate issued");
  });
});

/**
 * Keys no screen reads today, kept on purpose: an area still at work on the
 * screen they belong to (a former tenant's balance and the request steps on
 * the tenant side, the bank's automatic assignment, the indexation letter,
 * the charges statement, the guided rental, a property's past leases, a
 * contact's note), or a key the dashboard of another branch still names
 * until the branches meet.
 * Anything else a screen stops reading leaves the four dictionaries with it.
 */
const KEPT_UNREAD = new Set([
  "home.arrearsSub", "shell.fieldNote",
  "tenant.stepPlanned", "tenant.stepVisitAt", "tenant.stepOn", "tenant.threadManager",
  "tenant.payOutstandingTitle", "tenant.payOutstandingBody", "tenant.rentOutstanding", "tenant.pastOpen",
  "banque.kpiAutoSub", "banque.kpiReviewSub", "banque.accountCamt", "banque.colTier", "banque.autoAssign", "banque.autoAssignDone",
  "indexation.lagSend", "indexation.lagSent", "indexation.capitalTitle",
  "charges.colYear", "charges.sourceSyndic",
  "location.reviewNote", "location.createRental", "location.activated",
  "bien.pastLeases",
]);

describe("every key of the dictionaries", () => {
  it("is read by the code, by name or through a key the code builds", () => {
    const root = join(process.cwd(), "src");
    const dictionaries = new Set(["fr", "en", "de", "lu"].map((l) => join(root, "lib", "i18n", `${l}.ts`)));
    const code = [...sources(root), ...sources(join(process.cwd(), "e2e"))]
      .filter((f) => !dictionaries.has(f))
      .map((f) => uncommented(readFileSync(f, "utf8")))
      .join("\n");
    // A key built from a prefix (`kind_${x}`, "col" + name) counts for every key that starts with it.
    const prefixes = [...code.matchAll(/`([A-Za-z_]\w+)\$\{|["']([A-Za-z_]\w+)["']\s*\+/g)].map((m) => m[1] ?? m[2]);
    const unread = leaves(fr)
      .map(([path]) => path.replace(/(\[\d+\])+$/, ""))
      .filter((path, i, all) => all.indexOf(path) === i && !KEPT_UNREAD.has(path))
      .filter((path) => {
        const leaf = path.split(".").pop()!;
        const e = leaf.replace(/\$/g, "\\$");
        const read = new RegExp(`(?:\\.${e}\\b|["'\`]${e}["'\`]|[{,]\\s*${e}\\s*[,}:=])`).test(code);
        return !read && !prefixes.some((p) => leaf.startsWith(p));
      });
    expect(unread).toEqual([]);
  }, 30_000); // It reads every source file of the app and the browser tests: slow under a full parallel run, never wrong.

  it("kept unread on purpose still exists, so the list says what is true", () => {
    const paths = new Set(leaves(fr).map(([path]) => path));
    for (const key of KEPT_UNREAD) expect(paths.has(key), key).toBe(true);
  });
});

/** The application's own source, outside tests: pages, components, libraries. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The text of a file without its comments, as far as a reader of UI strings needs. */
const uncommented = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("screens and components", () => {
  const root = join(process.cwd(), "src");
  // The pages and components a person sees. The API routes write records, not screens; the
  // investment workspace keeps its own copy files (src/lib/i18n/investment).
  const files = [...sources(join(root, "app")), ...sources(join(root, "components"))].filter(
    (f) => !f.includes(join("app", "api")) && !f.includes(join("components", "gestion", "investment")),
  );

  it("type no em dash and no arrow of their own: the placeholder is the dictionary's", () => {
    const found: string[] = [];
    for (const file of files) {
      const lines = uncommented(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        // A stored floor written as a dash is data being compared, not text being shown.
        if (/floor (?:!==|===) "—"/.test(line)) return;
        if (/[—→←]/.test(line)) found.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("hide a spinner beside words that say it, and name one that stands alone in the caller's words", async () => {
    const { Spinner } = await import("@/components/pro/ui");
    const quiet = renderToString(createElement(Spinner));
    expect(quiet).toContain('aria-hidden="true"');
    expect(quiet).not.toContain("aria-label");
    const said = renderToString(createElement(Spinner, { label: en.common.loading }));
    expect(said).toContain('role="img"');
    expect(said).toContain(`aria-label="${en.common.loading}"`);
  });

  it("give no kit component a French label of its own", () => {
    const kit = uncommented(readFileSync(join(root, "components", "pro", "ui.tsx"), "utf8"));
    expect(kit).not.toMatch(/"(Chargement|Fermer|Réessayer|Une erreur est survenue)/);
  });
});

describe("a message the product posts", () => {
  it("has no author written in one language: the screens name it in the reader's", async () => {
    const db = new FakeDb("2026-11-20");
    const org = "0f0f0f0f-0000-4000-8000-00000000c0de";
    const conversation = db.insertRow("conversations", { org_id: org, scope_type: "general", scope_id: null, subject: "Bail", last_message_at: "2026-11-02T09:00:00Z", created_at: "2026-11-01T09:00:00Z" });
    db.insertRow("messages", { org_id: org, conversation_id: conversation.id, sender_kind: "system", sender_contact_id: null, sender_user_id: null, body: "Attestation générée", sent_at: "2026-11-01T09:00:00Z", read_at: null, ticket_id: null });
    db.insertRow("messages", { org_id: org, conversation_id: conversation.id, sender_kind: "manager", sender_contact_id: null, sender_user_id: null, body: "Bonjour", sent_at: "2026-11-02T09:00:00Z", read_at: null, ticket_id: null });
    const data = await buildRealDataFrom(db.client(), orgFromWorkspace({ id: org, name: "Cabinet Test", kind: "owner" }), async () => new Map(), { conversationId: String(conversation.id) });
    const messages = data.CONVERSATIONS.find((c) => c.id === conversation.id)?.messages ?? [];
    expect(messages.map((m) => [m.kind, m.from])).toEqual([
      ["system", ""],
      ["manager", "Cabinet Test"],
    ]);
  });
});

// The root layout brings the stylesheet: the tab's name does not need it.
vi.mock("../../app/globals.css", () => ({}));

vi.mock("@/lib/i18n", async () => {
  const config = await import("@/lib/i18n/config");
  const dicts = { fr, en, de, lu };
  let locale: keyof typeof dicts = "fr";
  return {
    getLocale: async () => locale,
    getDict: (l: keyof typeof dicts) => dicts[l],
    getI18n: async () => ({ locale, d: dicts[locale] }),
    __setLocale: (l: keyof typeof dicts) => {
      locale = l;
    },
    DEFAULT_LOCALE: config.DEFAULT_LOCALE,
  };
});

describe("the tab's name", () => {
  const setLocale = async (l: "fr" | "en" | "de" | "lu") => ((await import("@/lib/i18n")) as unknown as { __setLocale: (l: string) => void }).__setLocale(l);

  it("is the dictionary's, in the person's language", async () => {
    const { generateMetadata } = await import("@/app/layout");
    for (const l of ["fr", "en", "de", "lu"] as const) {
      await setLocale(l);
      const meta = await generateMetadata();
      expect(meta.title).toBe(DICTS[l].meta.title);
      expect(meta.description).toBe(DICTS[l].meta.description);
    }
  });

  it("names the tenant space and the invitation in the person's language", async () => {
    const { generateMetadata: tenant } = await import("@/app/locataire/layout");
    const { generateMetadata: invitation } = await import("@/app/invitation/[token]/page");
    await setLocale("de");
    expect((await tenant()).title).toBe(`Morada Gestion · ${de.tenant.space}`);
    expect((await invitation()).title).toBe(`Morada Gestion · ${de.meta.invitation}`);
    await setLocale("fr");
  });
});

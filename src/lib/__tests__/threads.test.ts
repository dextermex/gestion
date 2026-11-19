import { beforeEach, describe, expect, it } from "vitest";
import type { OrgContext } from "@/lib/gestion/api";
import { addManagerMessage, readConversation } from "@/lib/gestion/requests";
import { byMostRecent, lastSpokenAt, mergeLines, mostRecent, threadMessageLine } from "@/lib/gestion/threads";
import { dayKey, timeOfDay, whenShort } from "@/lib/portal/format";
import { formatDateTime } from "@/lib/types";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, OTHER_ORG, ctxFor, hydrate, letTo, linkAccount, seedProperty } from "./helpers/tenancy";

/**
 * Which conversation is "the most recent", how one is read for the screen,
 * and what clock its hours are printed on. The loader chooses the
 * conversation it reads in full and the screen orders its list with the
 * same rule, so the conversation the screen opens is the one that was read.
 */

const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };
const LUC = { firstName: "Luc", lastName: "Weber", email: "luc.weber@example.lu" };
const anna = { id: "user-anna", email: "anna.weber@example.lu" };
const today = new Date().toISOString().slice(0, 10);
const at = (hour: number, minute = 0): string => `${today}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

describe("the most recent conversation", () => {
  it("is the one whose last message is the latest, whatever the row's own clock says", () => {
    const threads = [
      { id: "a", lastMessageAt: "2026-11-19T10:00:00+00:00" },
      { id: "b", lastMessageAt: "2026-11-19T12:00:00.250+00:00" },
      { id: "c", lastMessageAt: "2026-11-19T11:59:59Z" },
    ];
    expect([...threads].sort(byMostRecent).map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(mostRecent(threads)?.id).toBe("b");
    expect(mostRecent([])).toBeNull();
    // The same instant written two ways is the same instant; the id then decides, the same way for every reader.
    const tie = [
      { id: "z", lastMessageAt: "2026-11-19T12:00:00Z" },
      { id: "y", lastMessageAt: "2026-11-19T13:00:00+01:00" },
    ];
    expect([...tie].sort(byMostRecent).map((t) => t.id)).toEqual(["y", "z"]);
    expect([...tie].reverse().sort(byMostRecent).map((t) => t.id)).toEqual(["y", "z"]);
  });

  it("takes a conversation's time from its last message, then its row's clock, then its creation", () => {
    expect(lastSpokenAt({ lastSentAt: "s", lastMessageAt: "m", createdAt: "c" })).toBe("s");
    expect(lastSpokenAt({ lastSentAt: null, lastMessageAt: "m", createdAt: "c" })).toBe("m");
    expect(lastSpokenAt({ lastSentAt: "", lastMessageAt: null, createdAt: "c" })).toBe("c");
  });

  it("keeps each message once, in the order they were written, across several readings", () => {
    const line = (id: string, t: string, body = id) => ({ id, at: t, body });
    const merged = mergeLines([line("2", at(9)), line("3", at(10), "old")], [line("1", at(8))], [line("3", at(10), "new"), line("4", at(11))]);
    expect(merged.map((l) => [l.id, l.body])).toEqual([["1", "1"], ["2", "2"], ["3", "new"], ["4", "4"]]);
  });
});

describe("the conversation the desk's screen opens on", () => {
  let db: FakeDb;
  let ctx: OrgContext;
  let convA: string;
  let convB: string;
  let leaseA: string;

  beforeEach(async () => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
    db.insertRow("agencies", { id: ORG, name: "Cabinet Test" });
    db.insertRow("crm_members", { agency_id: ORG, user_id: "user-owner", role: "owner", status: "active", email: "owner@cabinet-test.lu" });
    const a = seedProperty(db);
    const b = seedProperty(db, ORG, "Résidence Beaulieu");
    const rentalA = await letTo(ctx, a.unitId, [ANNA]);
    leaseA = rentalA.leaseId;
    await linkAccount(db, ctx, rentalA, anna);
    const leaseB = (await letTo(ctx, b.unitId, [LUC], "980")).leaseId;
    const first = await addManagerMessage(ctx, { leaseId: leaseA }, "Bonjour Anna");
    const second = await addManagerMessage(ctx, { leaseId: leaseB }, "Bonjour Luc");
    if ("error" in first || "error" in second) throw new Error("seed");
    convA = first.conversationId;
    convB = second.conversationId;
    db.table("messages").find((m) => m.id === first.id)!.sent_at = at(8);
    db.table("messages").find((m) => m.id === second.id)!.sent_at = at(9);
    // The rows' own clocks, as a database without the trigger keeps them: only the desk's writes moved them.
    db.table("conversations").find((c) => c.id === convA)!.last_message_at = at(8);
    db.table("conversations").find((c) => c.id === convB)!.last_message_at = at(9);
  });

  it("is chosen by the last message, the rule the list is ordered with: a tenant's word counts", async () => {
    // Anna answers on hers; the row's clock still says the desk's conversation with Luc is the latest.
    db.insertRow("messages", { org_id: ORG, conversation_id: convA, sender_kind: "tenant", sender_user_id: anna.id, body: "Une question sur les charges", sent_at: at(10) });
    db.table("conversations").find((c) => c.id === convA)!.last_message_at = at(8);
    const demo = await hydrate(db, ORG, { conversationId: "latest" });
    const listed = [...demo.CONVERSATIONS].sort(byMostRecent);
    // The screen opens the first of its list; that is the one the loader read in full.
    expect(listed[0].id).toBe(convA);
    expect(listed.map((c) => [c.id, c.loaded])).toEqual([[convA, true], [convB, false]]);
    expect(listed[0].messages.map((m) => m.body)).toEqual(["Bonjour Anna", "Une question sur les charges"]);
  });

  it("reads any other conversation by its own request: newest page, names, order, the page before", async () => {
    for (let i = 0; i < 5; i++) db.insertRow("messages", { org_id: ORG, conversation_id: convA, sender_kind: i % 2 ? "manager" : "tenant", sender_user_id: i % 2 ? "user-owner" : anna.id, body: `mot ${i}`, sent_at: at(10, i) });
    const whole = await readConversation(ctx, convA);
    if ("error" in whole) throw new Error(whole.error);
    expect(whole.earlier).toBe(false);
    expect(whole.messages.map((m) => [m.kind, m.from, m.body])).toEqual([
      ["manager", "Cabinet Test", "Bonjour Anna"],
      ["tenant", "Anna Weber", "mot 0"],
      ["manager", "Cabinet Test", "mot 1"],
      ["tenant", "Anna Weber", "mot 2"],
      ["manager", "Cabinet Test", "mot 3"],
      ["tenant", "Anna Weber", "mot 4"],
    ]);
    // A long history is read from its end; the page before is asked for by the moment of the first line shown.
    const tail = await readConversation(ctx, convA, { limit: 2 });
    if ("error" in tail) throw new Error(tail.error);
    expect([tail.messages.map((m) => m.body), tail.earlier]).toEqual([["mot 3", "mot 4"], true]);
    const before = await readConversation(ctx, convA, { limit: 2, before: tail.messages[0].at });
    if ("error" in before) throw new Error(before.error);
    expect([before.messages.map((m) => m.body), before.earlier]).toEqual([["mot 1", "mot 2"], true]);
    const start = await readConversation(ctx, convA, { limit: 4, before: before.messages[0].at });
    if ("error" in start) throw new Error(start.error);
    expect([start.messages.map((m) => m.body), start.earlier]).toEqual([["Bonjour Anna", "mot 0"], false]);
    // The loader and the read route name and order the messages alike.
    const demo = await hydrate(db, ORG, { conversationId: convA });
    expect(demo.CONVERSATIONS.find((c) => c.id === convA)!.messages.map((m) => [m.kind, m.from, m.body, m.at])).toEqual(whole.messages.map((m) => [m.kind, m.from, m.body, m.at]));
  });

  it("answers nothing for a conversation of another workspace", async () => {
    expect(await readConversation(ctxFor(db, OTHER_ORG), convA)).toEqual({ error: "not_found" });
    expect(await readConversation(ctx, "00000000-0000-4000-8000-000000000000")).toEqual({ error: "not_found" });
  });
});

describe("the hour of a message", () => {
  it("is Luxembourg's, whatever clock the server keeps", () => {
    // 12:05 UTC is 13:05 in Luxembourg in winter and 14:05 in summer.
    expect(timeOfDay("2026-01-15T12:05:00Z", "fr")).toBe("13:05");
    expect(timeOfDay("2026-07-15T12:05:00+00:00", "fr")).toBe("14:05");
    expect(timeOfDay("2026-07-15T12:05:00.123456+00:00", "de")).toBe("14:05");
    // A sample cabinet's timestamps name no zone: they are read as written.
    expect(timeOfDay("2026-08-19T08:12:00", "fr")).toBe("08:12");
    expect(timeOfDay("pas une heure", "fr")).toBe("");
  });

  it("files a message written after midnight in Luxembourg under that day", () => {
    // 23:30 UTC on 31 January is 00:30 on 1 February in Luxembourg.
    expect(dayKey("2026-01-31T23:30:00Z")).toBe("2026-02-01");
    expect(dayKey("2026-08-19T23:30:00")).toBe("2026-08-19");
    expect(dayKey("2026-08-19")).toBe("2026-08-19");
    const line = threadMessageLine({ id: "m", from: "Anna", kind: "tenant", body: "Bonsoir", at: "2026-01-31T23:30:00Z", ticketId: null }, "fr");
    expect([line.timeLabel, line.dayLabel]).toEqual(["00:30", "1 févr. 2026"]);
  });

  it("shows the hour for today's last word in a list, the day otherwise, on the same clock", () => {
    expect(whenShort("2026-01-31T23:30:00Z", "fr", "2026-02-01")).toBe("00:30");
    expect(whenShort("2026-01-31T23:30:00Z", "fr", "2026-01-31")).toBe("1 févr.");
    expect(whenShort("2026-01-31T12:00:00Z", "en", "2026-02-01")).toBe("31 Jan");
  });

  it("prints the journal's moments on the same clock", () => {
    expect(formatDateTime("2026-07-15T12:05:00Z", "fr")).toContain("14:05");
    expect(formatDateTime("2026-01-31T23:30:00Z", "fr")).toMatch(/^1 févr\. 2026/);
    expect(formatDateTime("2026-08-19T08:12:00", "fr")).toContain("08:12");
    expect(formatDateTime(null, "fr")).toBe("—");
  });
});

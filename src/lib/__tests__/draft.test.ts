import { afterEach, describe, expect, it } from "vitest";
import { clearDraft, memoryDraftBackend, readDraft, setDraftBackend, writeDraft } from "@/lib/draft";

/**
 * A draft kept on the device: written, read back by the same version of the
 * wizard, cleared once the work is saved. Another version's draft is
 * ignored, and a browser without a store keeps nothing and breaks nothing.
 */
describe("drafts on the device", () => {
  afterEach(() => setDraftBackend(null));

  it("writes, reads back and clears", async () => {
    setDraftBackend(memoryDraftBackend());
    await writeDraft("edl:l1:exit", 1, { rooms: ["Entrée"], step: 2 });
    const draft = await readDraft<{ rooms: string[]; step: number }>("edl:l1:exit", 1);
    expect(draft?.data).toEqual({ rooms: ["Entrée"], step: 2 });
    expect(typeof draft?.savedAt).toBe("number");
    await clearDraft("edl:l1:exit");
    expect(await readDraft("edl:l1:exit", 1)).toBeNull();
  });

  it("ignores a draft written by another version of the wizard", async () => {
    setDraftBackend(memoryDraftBackend());
    await writeDraft("bien:nouveau", 1, { name: "Résidence" });
    expect(await readDraft("bien:nouveau", 2)).toBeNull();
    expect((await readDraft<{ name: string }>("bien:nouveau", 1))?.data.name).toBe("Résidence");
  });

  it("keeps nothing, and throws nothing, without a store", async () => {
    // Node has no IndexedDB: the device's store resolves to the one that keeps nothing.
    setDraftBackend(null);
    await expect(writeDraft("k", 1, { a: 1 })).resolves.toBeUndefined();
    expect(await readDraft("k", 1)).toBeNull();
    await expect(clearDraft("k")).resolves.toBeUndefined();
  });
});

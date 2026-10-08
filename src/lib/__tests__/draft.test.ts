import { afterEach, describe, expect, it } from "vitest";
import { clearDraft, freeze, memoryDraftBackend, readDraft, setDraftBackend, writeDraft } from "@/lib/draft";

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

  it("keeps a photograph as bytes and hands it back as a File", async () => {
    setDraftBackend(memoryDraftBackend());
    const file = new File([new Uint8Array([1, 2, 3, 4])], "salon.jpg", { type: "image/jpeg", lastModified: 1_700_000_000_000 });
    await writeDraft("edl:l1:exit", 1, { step: 2, photos: { paint: [file] }, rooms: [{ name: "Salon", items: { paint: { condition: "good" } } }] });
    const draft = await readDraft<{ step: number; photos: Record<string, File[]>; rooms: Array<{ name: string }> }>("edl:l1:exit", 1);
    const back = draft!.data.photos.paint[0];
    expect(back).toBeInstanceOf(File);
    expect(back.name).toBe("salon.jpg");
    expect(back.type).toBe("image/jpeg");
    expect(back.lastModified).toBe(1_700_000_000_000);
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(draft!.data.rooms[0].name).toBe("Salon");
    // What the store holds is plain data: no File object in it.
    const stored = await freeze(draft!.data);
    expect(JSON.stringify(stored)).not.toContain("[object File]");
    expect((stored as { photos: { paint: Array<{ __file: boolean }> } }).photos.paint[0].__file).toBe(true);
  });

  it("keeps nothing, and throws nothing, without a store", async () => {
    // Node has no IndexedDB: the device's store resolves to the one that keeps nothing.
    setDraftBackend(null);
    await expect(writeDraft("k", 1, { a: 1 })).resolves.toBeUndefined();
    expect(await readDraft("k", 1)).toBeNull();
    await expect(clearDraft("k")).resolves.toBeUndefined();
  });
});

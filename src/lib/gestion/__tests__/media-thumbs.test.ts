import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signThumbnails, THUMB_WIDTH } from "@/lib/gestion/media";
import { signedDocumentUrl } from "@/lib/gestion/documents";

/**
 * Card-sized renders are signed one path at a time, with the render asked
 * for; a path the storage refuses is left out rather than breaking the
 * others. A document link is a download, unless it is to be shown in the
 * tab (a phone).
 */
type Call = { path: string; ttl: number; options: unknown };
function storage(fail: Set<string> = new Set()) {
  const calls: Call[] = [];
  const client = {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, ttl: number, options: unknown) => {
          calls.push({ path, ttl, options });
          if (fail.has(path)) return { data: null, error: { message: "render refused" } };
          return { data: { signedUrl: `https://x.supabase.co/storage/v1/render/image/sign/gestion-media/${path}?token=t` }, error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("card-sized renders of the photographs", () => {
  it("signs each path once, as a cover render of the card's width, and skips the ones refused", async () => {
    const { client, calls } = storage(new Set(["org/b.jpg"]));
    const out = await signThumbnails(client, ["org/a.jpg", "org/b.jpg", "org/a.jpg", "", "https://already.signed/x.jpg"]);
    expect([...out.keys()]).toEqual(["org/a.jpg"]);
    expect(out.get("org/a.jpg")).toContain("/render/image/sign/");
    expect(calls.map((c) => c.path)).toEqual(["org/a.jpg", "org/b.jpg"]);
    expect(calls[0].options).toEqual({ transform: { width: THUMB_WIDTH, height: 480, resize: "cover", quality: 75 } });
  });

  it("asks nothing of the storage without a path", async () => {
    const { client, calls } = storage();
    expect((await signThumbnails(client, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("the link to a document's file", () => {
  it("is a download named as the register names it, or shown in the tab when asked", async () => {
    const { client, calls } = storage();
    await signedDocumentUrl(client, "org/bail.pdf", "Bail Apt 3B.pdf");
    await signedDocumentUrl(client, "org/bail.pdf", "Bail Apt 3B.pdf", true);
    expect(calls[0].options).toEqual({ download: "Bail Apt 3B.pdf" });
    expect(calls[1].options).toBeUndefined();
  });
});

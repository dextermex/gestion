import { describe, expect, it } from "vitest";
import { PHOTO_MAX_EDGE, fitWithin, jpegName, shrinkPhoto } from "@/lib/photo";

describe("a photograph brought down to the upload size", () => {
  it("scales the longest edge to the limit and keeps the proportions", () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536, scaled: true });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048, scaled: true });
    expect(fitWithin(1600, 1200, 2048)).toEqual({ width: 1600, height: 1200, scaled: false });
    expect(fitWithin(2048, 10, 2048)).toEqual({ width: 2048, height: 10, scaled: false });
    expect(PHOTO_MAX_EDGE).toBe(2048);
  });

  it("names the re-encoded file as a JPEG", () => {
    expect(jpegName("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(jpegName("salon")).toBe("salon.jpg");
    expect(jpegName(".png")).toBe("photo.jpg");
  });

  it("sends a small photograph, and anything that is not an image, as it is", async () => {
    const small = new File([new Uint8Array(1024)], "petit.jpg", { type: "image/jpeg" });
    expect(await shrinkPhoto(small)).toBe(small);
    const pdf = new File([new Uint8Array(4 * 1024 * 1024)], "bail.pdf", { type: "application/pdf" });
    expect(await shrinkPhoto(pdf)).toBe(pdf);
  });

  it("sends the photograph as it is when it cannot be decoded here", async () => {
    // Node decodes nothing: the file goes up unchanged rather than not at all.
    const big = new File([new Uint8Array(3 * 1024 * 1024)], "grand.jpg", { type: "image/jpeg" });
    expect(await shrinkPhoto(big)).toBe(big);
  });
});

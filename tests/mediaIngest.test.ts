import { describe, it, expect } from "vitest";
import { normalizeGoogleDriveUrl } from "@/lib/mediaIngest";

const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456";
const DIRECT = `https://drive.google.com/uc?export=download&id=${FILE_ID}`;

describe("normalizeGoogleDriveUrl", () => {
  it("normalizes /file/d/FILE_ID/view share links", () => {
    expect(
      normalizeGoogleDriveUrl(
        `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`
      )
    ).toBe(DIRECT);
  });

  it("normalizes /file/d/FILE_ID (no /view) links", () => {
    expect(
      normalizeGoogleDriveUrl(`https://drive.google.com/file/d/${FILE_ID}`)
    ).toBe(DIRECT);
  });

  it("normalizes open?id=FILE_ID links", () => {
    expect(
      normalizeGoogleDriveUrl(`https://drive.google.com/open?id=${FILE_ID}`)
    ).toBe(DIRECT);
  });

  it("normalizes uc?export=download&id=FILE_ID links", () => {
    expect(
      normalizeGoogleDriveUrl(
        `https://drive.google.com/uc?export=download&id=${FILE_ID}`
      )
    ).toBe(DIRECT);
  });

  it("normalizes uc?id=FILE_ID&export=view (reorders / rewrites export)", () => {
    expect(
      normalizeGoogleDriveUrl(
        `https://drive.google.com/uc?id=${FILE_ID}&export=view`
      )
    ).toBe(DIRECT);
  });

  it("normalizes drive.usercontent.google.com/download links", () => {
    expect(
      normalizeGoogleDriveUrl(
        `https://drive.usercontent.google.com/download?id=${FILE_ID}&export=download&confirm=t`
      )
    ).toBe(DIRECT);
  });

  it("normalizes docs.google.com /d/FILE_ID links", () => {
    expect(
      normalizeGoogleDriveUrl(
        `https://docs.google.com/document/d/${FILE_ID}/edit`
      )
    ).toBe(DIRECT);
  });

  it("returns null for a non-Drive direct media URL", () => {
    expect(
      normalizeGoogleDriveUrl(
        "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg"
      )
    ).toBeNull();
  });

  it("returns null for a Drive URL with no discernible file id", () => {
    expect(normalizeGoogleDriveUrl("https://drive.google.com/")).toBeNull();
  });

  it("returns null for a non-Drive Google host", () => {
    expect(
      normalizeGoogleDriveUrl("https://photos.google.com/share/abc")
    ).toBeNull();
  });

  it("returns null for a malformed / non-URL string", () => {
    expect(normalizeGoogleDriveUrl("not a url")).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import sharp from "sharp";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  validateImageFile,
  processImageForInstagram,
} from "@/media/processImage";

let tmpDir: string;
let squareJpeg: string; // 1200x1200 -> should downscale to 1080x1080
let tallImage: string; // very tall portrait -> should be cropped to 4:5
let wideImage: string; // very wide landscape -> should be cropped to 1.91:1
let notAnImage: string; // text file with .jpg extension
let emptyFile: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "img-test-"));

  squareJpeg = path.join(tmpDir, "square.jpg");
  await sharp({
    create: {
      width: 1200,
      height: 1200,
      channels: 3,
      background: { r: 100, g: 100, b: 100 },
    },
  })
    .jpeg()
    .toFile(squareJpeg);

  tallImage = path.join(tmpDir, "tall.jpg");
  await sharp({
    create: {
      width: 600,
      height: 1600, // aspect 0.375, well below 4:5 (0.8)
      channels: 3,
      background: { r: 20, g: 120, b: 200 },
    },
  })
    .jpeg()
    .toFile(tallImage);

  wideImage = path.join(tmpDir, "wide.jpg");
  await sharp({
    create: {
      width: 2000,
      height: 500, // aspect 4.0, well above 1.91
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .jpeg()
    .toFile(wideImage);

  notAnImage = path.join(tmpDir, "fake.jpg");
  await fs.writeFile(notAnImage, "this is definitely not an image");

  emptyFile = path.join(tmpDir, "empty.jpg");
  await fs.writeFile(emptyFile, "");
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("validateImageFile", () => {
  it("validates a real JPEG and returns metadata", async () => {
    const result = await validateImageFile(squareJpeg);
    expect(result.valid).toBe(true);
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.format).toBe("jpeg");
    expect(result.metadata!.width).toBe(1200);
    expect(result.metadata!.height).toBe(1200);
  });

  it("fails for a nonexistent file", async () => {
    const result = await validateImageFile(path.join(tmpDir, "nope.jpg"));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/does not exist/i);
  });

  it("fails for an empty file", async () => {
    const result = await validateImageFile(emptyFile);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it("fails for a non-image file", async () => {
    const result = await validateImageFile(notAnImage);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not a valid image/i);
  });
});

describe("processImageForInstagram", () => {
  it("downscales a 1200x1200 image to max 1080 wide and outputs a valid JPEG", async () => {
    const result = await processImageForInstagram(squareJpeg, tmpDir, "post1", 0);

    // File exists on disk
    const stat = await fs.stat(result.outputPath);
    expect(stat.size).toBeGreaterThan(0);
    expect(result.sizeBytes).toBe(stat.size);

    expect(result.width).toBeLessThanOrEqual(1080);
    expect(result.format).toBe("jpeg");

    // Output metadata should be a readable JPEG at <= 1080 wide
    const meta = await sharp(result.outputPath).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBeLessThanOrEqual(1080);
    // square input downscales to 1080x1080
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
  });

  it("names the output using postId and index", async () => {
    const result = await processImageForInstagram(squareJpeg, tmpDir, "abc", 2);
    expect(path.basename(result.outputPath)).toBe("abc_2.jpg");
  });

  it("crops an overly tall image to the 4:5 minimum aspect ratio", async () => {
    const result = await processImageForInstagram(tallImage, tmpDir, "tall", 0);
    const aspect = result.width / result.height;
    // 4:5 = 0.8 ; allow a small rounding tolerance
    expect(aspect).toBeGreaterThanOrEqual(0.8 - 0.02);
    expect(aspect).toBeLessThan(1);
    expect(result.width).toBeLessThanOrEqual(1080);
  });

  it("crops an overly wide image to the 1.91:1 maximum aspect ratio", async () => {
    const result = await processImageForInstagram(wideImage, tmpDir, "wide", 0);
    const aspect = result.width / result.height;
    expect(aspect).toBeLessThanOrEqual(1.91 + 0.02);
    expect(aspect).toBeGreaterThan(1);
    expect(result.width).toBeLessThanOrEqual(1080);
  });

  it("throws for an invalid image input", async () => {
    await expect(
      processImageForInstagram(notAnImage, tmpDir, "bad", 0)
    ).rejects.toThrow(/invalid image file/i);
  });
});

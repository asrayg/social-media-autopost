import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { getVideoMetadata, validateVideoFile } from "@/media/processVideo";

ffmpeg.setFfmpegPath(ffmpegPath);

let tmpDir: string;
let sampleMp4: string;
let emptyFile: string;

/**
 * Generate a small, self-contained H.264 test video with ffmpeg so the suite
 * doesn't depend on any file in uploads/ (which is gitignored and absent in CI).
 */
async function generateSampleMp4(outPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input("testsrc=size=320x240:rate=15:duration=1")
      .inputFormat("lavfi")
      .outputOptions(["-c:v libx264", "-pix_fmt yuv420p", "-movflags +faststart"])
      .output(outPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vid-test-"));

  sampleMp4 = path.join(tmpDir, "sample.mp4");
  await generateSampleMp4(sampleMp4);

  emptyFile = path.join(tmpDir, "empty.mp4");
  await fs.writeFile(emptyFile, "");
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("getVideoMetadata", () => {
  it("returns ffprobe metadata with a video stream having width/height/duration", async () => {
    const meta = await getVideoMetadata(sampleMp4);

    expect(meta.streams.length).toBeGreaterThan(0);
    const video = meta.streams.find((s) => s.codec_type === "video");
    expect(video).toBeDefined();
    expect(video!.width).toBeGreaterThan(0);
    expect(video!.height).toBeGreaterThan(0);

    const duration = parseFloat(String(meta.format.duration));
    expect(Number.isNaN(duration)).toBe(false);
    expect(duration).toBeGreaterThan(0);
  });

  it("rejects for a nonexistent file", async () => {
    await expect(
      getVideoMetadata(path.join(tmpDir, "does-not-exist.mp4"))
    ).rejects.toThrow(/ffprobe failed/i);
  });
});

describe("validateVideoFile", () => {
  it("returns valid=true with a duration for a normal mp4 on instagram", async () => {
    const result = await validateVideoFile(sampleMp4, "instagram");
    expect(result.valid).toBe(true);
    expect(result.durationSecs).toBeGreaterThan(0);
  });

  it("returns valid=true for tiktok too", async () => {
    const result = await validateVideoFile(sampleMp4, "tiktok");
    expect(result.valid).toBe(true);
    expect(result.durationSecs).toBeGreaterThan(0);
  });

  it("fails for a nonexistent file", async () => {
    const result = await validateVideoFile(
      path.join(tmpDir, "nope.mp4"),
      "instagram"
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/does not exist/i);
  });

  it("fails for an empty file", async () => {
    const result = await validateVideoFile(emptyFile, "instagram");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it("fails for an unknown platform", async () => {
    const result = await validateVideoFile(sampleMp4, "myspace");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/unknown platform/i);
  });
});

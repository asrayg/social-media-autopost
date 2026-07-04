import ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'
import fs from 'fs/promises'
import path from 'path'

// Configure ffmpeg and ffprobe binary paths.
// Both must be set explicitly: fluent-ffmpeg otherwise resolves ffprobe from the
// system PATH, which may be missing or broken on the host machine.
ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath)

export interface VideoProcessingResult {
  outputPath: string
  width: number
  height: number
  durationSecs: number
  sizeBytes: number
  codec: string
}

// Platform constraints
const PLATFORM_LIMITS = {
  instagram: {
    maxSizeBytes: 650 * 1024 * 1024, // 650MB
    maxDurationSecs: 90,              // Reels max 90 seconds
    validAspectRatios: [
      { label: '9:16', ratio: 9 / 16 },
      { label: '1:1', ratio: 1 },
    ],
  },
  tiktok: {
    maxSizeBytes: 500 * 1024 * 1024, // 500MB
    maxDurationSecs: 600,             // 10 minutes
    validAspectRatios: [
      { label: '9:16', ratio: 9 / 16 },
    ],
  },
  twitter: {
    maxSizeBytes: 512 * 1024 * 1024,
    maxDurationSecs: 140,
    validAspectRatios: [
      { label: '16:9', ratio: 16 / 9 },
      { label: '1:1', ratio: 1 },
      { label: '9:16', ratio: 9 / 16 },
    ],
  },
  linkedin: {
    maxSizeBytes: 5 * 1024 * 1024 * 1024,
    maxDurationSecs: 600,
    validAspectRatios: [
      { label: '16:9', ratio: 16 / 9 },
      { label: '1:1', ratio: 1 },
      { label: '9:16', ratio: 9 / 16 },
    ],
  },
  reddit: {
    maxSizeBytes: 1 * 1024 * 1024 * 1024,
    maxDurationSecs: 15 * 60,
    validAspectRatios: [
      { label: '16:9', ratio: 16 / 9 },
      { label: '1:1', ratio: 1 },
      { label: '9:16', ratio: 9 / 16 },
    ],
  },
  youtube: {
    maxSizeBytes: 256 * 1024 * 1024 * 1024,
    maxDurationSecs: 12 * 60 * 60,
    validAspectRatios: [
      { label: '16:9', ratio: 16 / 9 },
      { label: '9:16', ratio: 9 / 16 },
    ],
  },
  youtube_short: {
    maxSizeBytes: 256 * 1024 * 1024 * 1024,
    maxDurationSecs: 60,
    validAspectRatios: [
      { label: '9:16', ratio: 9 / 16 },
    ],
  },
} as const

export type VideoPlatform = keyof typeof PLATFORM_LIMITS

// Tolerance for aspect ratio comparison
const ASPECT_RATIO_TOLERANCE = 0.05

export async function processVideoForPlatform(
  inputPath: string,
  outputDir: string,
  postId: string,
  platform: VideoPlatform
): Promise<VideoProcessingResult> {
  // Validate before processing
  const validation = await validateVideoFile(inputPath, platform)
  if (!validation.valid) {
    throw new Error(`Invalid video file: ${validation.error}`)
  }

  const inputMeta = await getVideoMetadata(inputPath)
  const videoStream = inputMeta.streams.find((s: ffmpeg.FfprobeStream) => s.codec_type === 'video')

  if (!videoStream) {
    throw new Error('No video stream found in input file')
  }

  const inputWidth = videoStream.width ?? 0
  const inputHeight = videoStream.height ?? 0

  if (inputWidth === 0 || inputHeight === 0) {
    throw new Error('Could not determine video dimensions')
  }

  const limits = PLATFORM_LIMITS[platform]

  // Determine target dimensions based on platform aspect ratio requirements
  const { targetWidth, targetHeight } = resolveTargetDimensions(
    inputWidth,
    inputHeight,
    platform
  )

  const outputFilename = `${postId}_${platform}.mp4`
  const outputPath = path.join(outputDir, outputFilename)

  await runFfmpeg(inputPath, outputPath, targetWidth, targetHeight, platform)

  // Read output metadata
  const outputMeta = await getVideoMetadata(outputPath)
  const outputVideoStream = outputMeta.streams.find((s: ffmpeg.FfprobeStream) => s.codec_type === 'video')
  const stat = await fs.stat(outputPath)

  const durationSecs = outputMeta.format.duration
    ? parseFloat(String(outputMeta.format.duration))
    : (validation.durationSecs ?? 0)

  return {
    outputPath,
    width: outputVideoStream?.width ?? targetWidth,
    height: outputVideoStream?.height ?? targetHeight,
    durationSecs,
    sizeBytes: stat.size,
    codec: 'h264',
  }
}

function resolveTargetDimensions(
  inputWidth: number,
  inputHeight: number,
  platform: VideoPlatform
): { targetWidth: number; targetHeight: number } {
  const inputAspect = inputWidth / inputHeight

  if (platform === 'tiktok' || platform === 'youtube_short') {
    // TikTok and YouTube Shorts are normalized to 9:16.
    return dimensionsFor916(inputWidth, inputHeight, inputAspect)
  }

  // Instagram supports 9:16 and 1:1
  const nineBy16Ratio = 9 / 16
  const oneBy1Ratio = 1

  const distTo916 = Math.abs(inputAspect - nineBy16Ratio)
  const distTo1x1 = Math.abs(inputAspect - oneBy1Ratio)

  if (distTo916 <= distTo1x1) {
    // Closer to 9:16
    return dimensionsFor916(inputWidth, inputHeight, inputAspect)
  } else {
    // Closer to 1:1 — crop/pad to square using smaller dimension
    const side = Math.min(inputWidth, inputHeight)
    return { targetWidth: side, targetHeight: side }
  }
}

function dimensionsFor916(
  inputWidth: number,
  inputHeight: number,
  inputAspect: number
): { targetWidth: number; targetHeight: number } {
  const target916 = 9 / 16
  if (Math.abs(inputAspect - target916) < ASPECT_RATIO_TOLERANCE) {
    // Already close enough — keep original size, just ensure divisible by 2
    return {
      targetWidth: makeEven(inputWidth),
      targetHeight: makeEven(inputHeight),
    }
  }

  // Portrait source: fix width, derive height
  if (inputWidth <= inputHeight) {
    const w = makeEven(inputWidth)
    const h = makeEven(Math.round(w / target916))
    return { targetWidth: w, targetHeight: h }
  }

  // Landscape source: fix height, derive width
  const h = makeEven(inputHeight)
  const w = makeEven(Math.round(h * target916))
  return { targetWidth: w, targetHeight: h }
}

function makeEven(n: number): number {
  return n % 2 === 0 ? n : n - 1
}

function runFfmpeg(
  inputPath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number,
  platform: VideoPlatform
): Promise<void> {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-movflags +faststart',
        '-pix_fmt yuv420p',
        '-preset fast',
        '-crf 23',
      ])
      // Scale and crop/pad to target aspect ratio
      .videoFilter(
        `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black,` +
        `crop=${targetWidth}:${targetHeight}`
      )
      .format('mp4')

    if (platform === 'tiktok' || platform === 'youtube_short') {
      command = command.outputOptions(['-t', String(PLATFORM_LIMITS[platform].maxDurationSecs)])
    }

    command
      .on('error', (err: Error) => {
        reject(new Error(`FFmpeg processing failed: ${err.message}`))
      })
      .on('end', () => {
        resolve()
      })
      .save(outputPath)
  })
}

export function getVideoMetadata(filePath: string): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: Error | null, data: ffmpeg.FfprobeData) => {
      if (err) {
        reject(new Error(`FFprobe failed for "${filePath}": ${err.message}`))
      } else {
        resolve(data)
      }
    })
  })
}

export async function validateVideoFile(
  filePath: string,
  platform: string
): Promise<{
  valid: boolean
  error?: string
  durationSecs?: number
}> {
  // Check file exists
  try {
    await fs.access(filePath)
  } catch {
    return { valid: false, error: `File does not exist: ${filePath}` }
  }

  // Check file size
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(filePath)
  } catch (err) {
    return { valid: false, error: `Could not stat file: ${(err as Error).message}` }
  }

  if (stat.size === 0) {
    return { valid: false, error: 'File is empty' }
  }

  const platformKey = platform as VideoPlatform
  const limits = PLATFORM_LIMITS[platformKey]

  if (!limits) {
    return { valid: false, error: `Unknown platform: ${platform}` }
  }

  if (stat.size > limits.maxSizeBytes) {
    const sizeMB = (stat.size / 1024 / 1024).toFixed(2)
    const limitMB = (limits.maxSizeBytes / 1024 / 1024).toFixed(0)
    return {
      valid: false,
      error: `File size ${sizeMB}MB exceeds ${limitMB}MB limit for ${platform}`,
    }
  }

  // Probe with ffprobe
  let metadata: ffmpeg.FfprobeData
  try {
    metadata = await getVideoMetadata(filePath)
  } catch (err) {
    return {
      valid: false,
      error: `Could not read video metadata: ${(err as Error).message}`,
    }
  }

  const videoStream = metadata.streams.find((s: ffmpeg.FfprobeStream) => s.codec_type === 'video')
  if (!videoStream) {
    return { valid: false, error: 'No video stream found in file' }
  }

  // Check codec — we accept common input codecs that ffmpeg can transcode
  const supportedInputCodecs = [
    'h264', 'h265', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4',
    'mpeg2video', 'theora', 'wmv2', 'wmv3', 'prores',
  ]
  const codec = videoStream.codec_name?.toLowerCase() ?? ''
  if (codec && !supportedInputCodecs.includes(codec)) {
    return {
      valid: false,
      error: `Unsupported codec "${codec}". Supported: ${supportedInputCodecs.join(', ')}`,
    }
  }

  // Check duration
  const durationSecs = metadata.format.duration
    ? parseFloat(String(metadata.format.duration))
    : null

  if (durationSecs === null || isNaN(durationSecs)) {
    return { valid: false, error: 'Could not determine video duration' }
  }

  if (durationSecs <= 0) {
    return { valid: false, error: 'Video duration must be greater than 0 seconds' }
  }

  if (durationSecs > limits.maxDurationSecs) {
    const limit =
      limits.maxDurationSecs > 60
        ? `${(limits.maxDurationSecs / 60).toFixed(0)} minutes`
        : `${limits.maxDurationSecs} seconds`
    return {
      valid: false,
      error: `Video duration ${durationSecs.toFixed(1)}s exceeds ${platform} limit of ${limit}`,
    }
  }

  if (platformKey === 'youtube_short') {
    const width = videoStream.width ?? 0
    const height = videoStream.height ?? 0
    if (width >= height) {
      return {
        valid: false,
        error: 'YouTube Shorts require a vertical video',
      }
    }
  }

  return { valid: true, durationSecs }
}

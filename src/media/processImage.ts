import sharp from 'sharp'
import fs from 'fs/promises'
import path from 'path'

export interface ImageProcessingResult {
  outputPath: string
  width: number
  height: number
  sizeBytes: number
  format: string
}

// Instagram aspect ratio constraints:
// Minimum: 4:5 (portrait) = 0.8
// Maximum: 1.91:1 (landscape) ≈ 1.91
const INSTAGRAM_MIN_ASPECT = 4 / 5   // 0.8
const INSTAGRAM_MAX_ASPECT = 1.91
const INSTAGRAM_MAX_WIDTH = 1080
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024 // 8MB

export async function processImageForInstagram(
  inputPath: string,
  outputDir: string,
  postId: string,
  index: number
): Promise<ImageProcessingResult> {
  const validation = await validateImageFile(inputPath)
  if (!validation.valid) {
    throw new Error(`Invalid image file: ${validation.error}`)
  }

  const metadata = validation.metadata!
  const originalWidth = metadata.width ?? 0
  const originalHeight = metadata.height ?? 0

  if (originalWidth === 0 || originalHeight === 0) {
    throw new Error('Could not determine image dimensions')
  }

  let pipeline = sharp(inputPath).rotate() // Auto-rotate based on EXIF

  // Resize to max 1080px width maintaining aspect ratio
  let targetWidth = originalWidth
  let targetHeight = originalHeight

  if (originalWidth > INSTAGRAM_MAX_WIDTH) {
    targetWidth = INSTAGRAM_MAX_WIDTH
    targetHeight = Math.round((originalHeight / originalWidth) * INSTAGRAM_MAX_WIDTH)
  }

  // Enforce Instagram aspect ratio (4:5 to 1.91:1)
  const aspectRatio = targetWidth / targetHeight

  if (aspectRatio < INSTAGRAM_MIN_ASPECT) {
    // Too tall (more portrait than 4:5) — crop height to match 4:5
    targetHeight = Math.round(targetWidth / INSTAGRAM_MIN_ASPECT)
    pipeline = pipeline.resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: 'centre',
    })
  } else if (aspectRatio > INSTAGRAM_MAX_ASPECT) {
    // Too wide (more landscape than 1.91:1) — crop width to match 1.91:1
    targetWidth = Math.round(targetHeight * INSTAGRAM_MAX_ASPECT)
    pipeline = pipeline.resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: 'centre',
    })
  } else {
    // Aspect ratio is valid — just resize to target dimensions
    pipeline = pipeline.resize(targetWidth, targetHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  // Convert to JPEG quality 90
  pipeline = pipeline.jpeg({ quality: 90, progressive: true })

  const outputFilename = `${postId}_${index}.jpg`
  const outputPath = path.join(outputDir, outputFilename)

  await pipeline.toFile(outputPath)

  // Read output metadata
  const outputMetadata = await sharp(outputPath).metadata()
  const stat = await fs.stat(outputPath)

  return {
    outputPath,
    width: outputMetadata.width ?? targetWidth,
    height: outputMetadata.height ?? targetHeight,
    sizeBytes: stat.size,
    format: 'jpeg',
  }
}

export async function validateImageFile(filePath: string): Promise<{
  valid: boolean
  error?: string
  metadata?: sharp.Metadata
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

  if (stat.size > MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size ${(stat.size / 1024 / 1024).toFixed(2)}MB exceeds 8MB limit`,
    }
  }

  if (stat.size === 0) {
    return { valid: false, error: 'File is empty' }
  }

  // Check it is a valid image and get metadata
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(filePath).metadata()
  } catch (err) {
    return {
      valid: false,
      error: `Not a valid image file: ${(err as Error).message}`,
    }
  }

  const supportedFormats = ['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff']
  if (!metadata.format || !supportedFormats.includes(metadata.format)) {
    return {
      valid: false,
      error: `Unsupported image format: ${metadata.format ?? 'unknown'}`,
    }
  }

  if (!metadata.width || !metadata.height) {
    return { valid: false, error: 'Could not read image dimensions' }
  }

  return { valid: true, metadata }
}

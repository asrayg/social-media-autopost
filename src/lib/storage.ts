import fs from 'fs/promises'
import path from 'path'
import { env } from '@/lib/env'

/**
 * Ensures all required application directories exist, creating them if necessary.
 * Safe to call multiple times (idempotent).
 */
export async function ensureDirectoriesExist(): Promise<void> {
  const dirs = [
    env.UPLOAD_DIR,
    env.PROCESSED_DIR,
    env.LOGS_DIR,
    env.SESSIONS_DIR,
  ]

  await Promise.all(
    dirs.map((dir) =>
      fs.mkdir(dir, { recursive: true }).catch((err: NodeJS.ErrnoException) => {
        // EEXIST is fine — directory already present
        if (err.code !== 'EEXIST') {
          throw new Error(`Failed to create directory "${dir}": ${err.message}`)
        }
      })
    )
  )
}

/**
 * Saves a buffer to the uploads directory under the given filename.
 * Creates the uploads directory if it does not exist.
 *
 * @returns Absolute path of the saved file.
 */
export async function saveUploadedFile(
  buffer: Buffer,
  filename: string
): Promise<string> {
  if (!filename || filename.trim().length === 0) {
    throw new Error('Filename must not be empty')
  }

  // Sanitize: strip directory traversal characters
  const safeName = path.basename(filename)
  if (safeName !== filename) {
    throw new Error(
      `Filename "${filename}" contains path separators. Provide a plain filename only.`
    )
  }

  const uploadDir = env.UPLOAD_DIR
  await fs.mkdir(uploadDir, { recursive: true })

  const filePath = path.join(uploadDir, safeName)
  await fs.writeFile(filePath, buffer)
  return filePath
}

/**
 * Returns the absolute path for a file in the uploads directory.
 */
export function getUploadPath(filename: string): string {
  return path.join(env.UPLOAD_DIR, path.basename(filename))
}

/**
 * Returns the absolute path for a processed file scoped to a specific post.
 * The directory `<PROCESSED_DIR>/<postId>/` is NOT created by this function —
 * call `fs.mkdir(..., { recursive: true })` before writing if needed.
 */
export function getProcessedPath(postId: string, filename: string): string {
  return path.join(env.PROCESSED_DIR, postId, path.basename(filename))
}

/**
 * Returns the absolute path to the logs directory.
 */
export function getLogsPath(): string {
  return env.LOGS_DIR
}

/**
 * Returns the absolute path for a platform session directory scoped to a username.
 * Convention: `<SESSIONS_DIR>/<platform>/<username>/`
 *
 * The directory is NOT created by this function.
 */
export function getSessionPath(platform: string, username: string): string {
  if (!platform || !username) {
    throw new Error('Both platform and username are required for getSessionPath')
  }
  // Sanitize to prevent directory traversal
  const safePlatform = path.basename(platform)
  const safeUsername = path.basename(username)
  return path.join(env.SESSIONS_DIR, safePlatform, safeUsername)
}

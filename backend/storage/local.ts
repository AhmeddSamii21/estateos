import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createError } from '../middleware/errorHandler'
import { assertSafeStorageKey } from '../utils/files'

const root = path.resolve(process.env.UPLOAD_PATH || path.join(process.cwd(), 'storage', 'documents'))
const imageRoot = path.join(root, 'property-images')

function target(storageKey: string, kind: 'document' | 'image' = 'document'): string {
  assertSafeStorageKey(storageKey)
  return path.join(kind === 'image' ? imageRoot : root, storageKey)
}

export async function ensureStorage(): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(imageRoot, { recursive: true })
}

export async function writeDocument(storageKey: string, buffer: Buffer): Promise<void> {
  await ensureStorage()
  await fs.writeFile(target(storageKey, 'document'), buffer, { flag: 'wx' })
}

export async function readDocument(storageKey: string): Promise<Buffer> {
  try {
    return await fs.readFile(target(storageKey, 'document'))
  } catch {
    throw createError('Stored document could not be read', 404)
  }
}

export async function removeDocument(storageKey: string): Promise<void> {
  try {
    await fs.unlink(target(storageKey, 'document'))
  } catch {
    // Archive operations never fail because a physical file is already absent.
  }
}

export async function writePropertyImage(storageKey: string, buffer: Buffer): Promise<void> {
  await ensureStorage()
  await fs.writeFile(target(storageKey, 'image'), buffer, { flag: 'wx' })
}

export async function readPropertyImage(storageKey: string): Promise<Buffer> {
  try {
    return await fs.readFile(target(storageKey, 'image'))
  } catch {
    throw createError('Stored image could not be read', 404)
  }
}

export async function removePropertyImage(storageKey: string): Promise<void> {
  try {
    await fs.unlink(target(storageKey, 'image'))
  } catch {
    // Ignore missing files.
  }
}

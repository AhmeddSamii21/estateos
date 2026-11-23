import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createError } from '../middleware/errorHandler'

export const ALLOWED_DOCUMENT_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
}

export const ALLOWED_IMAGE_TYPES: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp']
}

export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024

export interface UploadLikeFile {
  originalname: string
  mimetype: string
  size: number
  buffer?: Buffer
}

export function sanitizeOriginalName(name: string): string {
  const base = path.basename(String(name || 'document')).replace(/[^a-zA-Z0-9._ -]/g, '_').trim()
  return (base || 'document').slice(0, 180)
}

export function validateDocumentFile(file: UploadLikeFile): void {
  if (!file || !file.originalname || !file.mimetype) throw createError('A document file is required', 400)
  if (!Number.isFinite(file.size) || file.size <= 0) throw createError('Document file is empty', 400)
  if (file.size > MAX_DOCUMENT_SIZE) throw createError('Document file exceeds the 10 MB limit', 413)
  const extensions = ALLOWED_DOCUMENT_TYPES[file.mimetype.toLowerCase()]
  if (!extensions) throw createError('Unsupported document type', 415)
  const extension = path.extname(file.originalname).toLowerCase()
  if (!extensions.includes(extension)) throw createError('File extension does not match its content type', 415)
}

function sniffImageMime(buffer?: Buffer): string | null {
  if (!buffer || buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'image/webp'
  return null
}

export function validateImageFile(file: UploadLikeFile): void {
  if (!file || !file.originalname || !file.mimetype) throw createError('An image file is required', 400)
  if (!Number.isFinite(file.size) || file.size <= 0) throw createError('Image file is empty', 400)
  if (file.size > MAX_IMAGE_SIZE) throw createError('Image file exceeds the 5 MB limit', 413)
  const extensions = ALLOWED_IMAGE_TYPES[file.mimetype.toLowerCase()]
  if (!extensions) throw createError('Unsupported image type', 415)
  const extension = path.extname(file.originalname).toLowerCase()
  if (!extensions.includes(extension)) throw createError('File extension does not match its content type', 415)
  const detected = sniffImageMime(file.buffer)
  if (!detected || detected !== file.mimetype.toLowerCase()) {
    throw createError('Image content does not match its declared type', 415)
  }
}

export function createStorageKey(originalName: string): string {
  const extension = path.extname(sanitizeOriginalName(originalName)).toLowerCase()
  return `${randomUUID()}${extension}`
}

export function assertSafeStorageKey(key: string): void {
  if (!/^[a-f0-9-]{36}(\.[a-z0-9]{1,5})?$/i.test(key)) {
    throw createError('Invalid document storage key', 400)
  }
  if (key.includes('..') || key.includes('/') || key.includes('\\')) {
    throw createError('Invalid document storage key', 400)
  }
}

import { PropertyAttachmentKind } from '@prisma/client'
import { createError } from '../middleware/errorHandler'

/** FLOORPLAN and BROCHURE are the two user-facing Package 14 categories. */
export const PROPERTY_ATTACHMENT_KINDS = ['FLOORPLAN', 'BROCHURE'] as const

export function parseAttachmentKind(value: unknown, fallback?: PropertyAttachmentKind): PropertyAttachmentKind {
  if ((value === undefined || value === null || value === '') && fallback) return fallback
  if (typeof value === 'string' && (PROPERTY_ATTACHMENT_KINDS as readonly string[]).includes(value)) {
    return value as PropertyAttachmentKind
  }
  throw createError('kind must be FLOORPLAN or BROCHURE', 400)
}

/** Linked attachments are references only; the server never fetches these URLs. */
export function validateAttachmentUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw createError('A link URL is required', 400)
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw createError('A valid http(s) link URL is required', 400)
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw createError('Only public http(s) links are supported', 400)
  }
  return parsed.toString()
}

export interface SerializableAttachment {
  id: string
  name: string
  url: string
  kind: PropertyAttachmentKind
  mimeType: string | null
  originalName: string | null
  size: number | null
  sortOrder: number
  contentUrl: string | null
}

/** Hides storage keys from clients while exposing a safe preview URL. */
export function serializeAttachment(
  attachment: {
    id: string
    name: string
    url: string
    kind: PropertyAttachmentKind
    mimeType: string | null
    originalName: string | null
    size: number | null
    sortOrder: number
    storageKey: string | null
  },
  contentUrl: string | null
): SerializableAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    url: attachment.storageKey ? '' : attachment.url,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    originalName: attachment.originalName,
    size: attachment.size,
    sortOrder: attachment.sortOrder,
    contentUrl
  }
}

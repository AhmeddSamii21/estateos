import client from '@/api/client'
import type { PropertyAttachment } from '@/types'

/** Opens an authenticated attachment preview in a new tab. */
export async function previewAttachment(attachment: PropertyAttachment): Promise<void> {
  if (!attachment.contentUrl) {
    if (attachment.url) window.open(attachment.url, '_blank', 'noopener')
    return
  }
  const response = await client.get<Blob>(attachment.contentUrl, { responseType: 'blob' })
  const url = URL.createObjectURL(response.data)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function attachmentKindLabel(kind: PropertyAttachment['kind'], arabic: boolean): string {
  if (kind === 'FLOORPLAN') return arabic ? 'مخطط' : 'Floorplan'
  return arabic ? 'كتيّب' : 'Brochure'
}

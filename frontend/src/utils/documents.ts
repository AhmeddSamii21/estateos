import client from '@/api/client'

/** Opens an authenticated inline preview in a new browser tab. */
export async function previewDocument(id: string): Promise<void> {
  const response = await client.get<Blob>(`/documents/${id}/preview`, { responseType: 'blob' })
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

export async function downloadDocument(id: string, fallbackName = 'document'): Promise<void> {
  const response = await client.get<Blob>(`/documents/${id}/download`, { responseType: 'blob' })
  const disposition = response.headers['content-disposition'] as string | undefined
  const match = disposition?.match(/filename="?([^";]+)"?/i)
  const filename = match?.[1] || fallbackName
  const url = URL.createObjectURL(response.data)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

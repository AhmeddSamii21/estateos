import client from '@/api/client'

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

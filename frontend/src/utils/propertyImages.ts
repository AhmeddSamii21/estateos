import client from '@/api/client'

export function propertyImageUrl(propertyId: string, imageId: string): string {
  return `/api/properties/${propertyId}/images/${imageId}/content`
}

export async function loadPropertyImageObjectUrl(propertyId: string, imageId: string): Promise<string> {
  const response = await client.get<Blob>(propertyImageUrl(propertyId, imageId), { responseType: 'blob' })
  return URL.createObjectURL(response.data)
}
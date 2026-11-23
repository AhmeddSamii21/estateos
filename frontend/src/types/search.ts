export interface SearchResult<T = Record<string, unknown>> {
  id: string
  title: string
  type: string
  route: string
  details?: T
}

export interface GlobalSearchResponse {
  success: boolean
  data: {
    properties: SearchResult[]
    owners: SearchResult<{ name: string; email?: string; phone?: string }>[]
    leads: SearchResult<{ name: string; email?: string; phone?: string }>[]
    deals: SearchResult<{ referenceNumber?: string; property?: string; amount?: string }>[]
    documents: SearchResult<{ name: string; category?: string }>[]
    total: number
  }
  total: number
  error?: string
}

export interface SearchFilters {
  q: string
  limit?: number
}

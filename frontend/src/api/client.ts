import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import { GlobalSearchResponse } from '@/types/search'
import type { ApiWarning } from '@/types'
import { demoAdapter, demoMode, ensureDemoDecision } from './demoAdapter'

export { demoMode, demoFetch, resetDemoSession, DEMO_PASSWORD, DEMO_LOGIN_ACCOUNTS } from './demoAdapter'

const TOKEN_KEY = 'estateos.token'

export const tokenStore = {
  get(): string | null {
    return localStorage.getItem(TOKEN_KEY)
  },
  set(token: string): void {
    localStorage.setItem(TOKEN_KEY, token)
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY)
  }
}

const client = axios.create({
  baseURL: '/api',
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
  // In demo mode this answers every request locally. With a reachable /
  // api backend it transparently delegates to the real Axios adapter.
  adapter: demoAdapter
})

/** True when the app is serving the standalone GitHub Pages live demo. */
export function isDemoMode(): boolean {
  return demoMode.value
}

/** Used by bootstrap to avoid a failed /auth/me call in static hosting mode. */
export async function waitForApiMode(): Promise<void> {
  await ensureDemoDecision()
}

client.interceptors.request.use((config) => {
  const token = tokenStore.get()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.headers.delete('Content-Type')
  }
  return config
})

client.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      tokenStore.clear()
    }
    return Promise.reject(error)
  }
)

export interface ApiEnvelope<T> {
  success?: boolean
  data: T
  pagination?: {
    page: number
    limit: number
    total: number
    pages: number
  }
  message?: string
  error?: string | { message: string; issues?: Array<{ field: string; message: string }> }
  warnings?: ApiWarning[]
}

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as ApiEnvelope<unknown> | undefined
    if (data?.error && typeof data.error === 'object') {
      const issues = data.error.issues
      if (issues?.length) return issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')
      return data.error.message
    }
    if (typeof data?.error === 'string') return data.error
    if (data?.message) return data.message
    if (error.code === 'ECONNABORTED') return 'The server took too long to respond.'
    if (!error.response) return 'Cannot reach the API server.'
  }
  return error instanceof Error ? error.message : 'Unexpected error.'
}

export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const response = await client.get<ApiEnvelope<T>>(url, config)
  return response.data
}

export async function apiPost<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const response = await client.post<ApiEnvelope<T>>(url, body, config)
  return response.data
}

export async function apiPatch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const response = await client.patch<ApiEnvelope<T>>(url, body, config)
  return response.data
}

export async function apiDelete<T>(url: string, config?: AxiosRequestConfig): Promise<ApiEnvelope<T>> {
  const response = await client.delete<ApiEnvelope<T>>(url, config)
  return response.data
}

// Search API
export async function apiGlobalSearch(query: string, options: { limit?: number } = {}): Promise<ApiEnvelope<GlobalSearchResponse>> {
  const params: Record<string, string | number> = { q: query }
  if (options.limit) params.limit = options.limit
  const response = await client.get<ApiEnvelope<GlobalSearchResponse>>('/search', { params })
  return response.data
}

export default client

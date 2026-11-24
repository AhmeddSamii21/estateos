import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { apiGet, apiPatch, apiPost, errorMessage, tokenStore } from '@/api/client'
import type {
  AppNotification,
  AuthUser,
  Property,
  PropertyDetail,
  PropertyFilters,
  Role
} from '@/types'

const LANGUAGE_KEY = 'estateos.language'

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  AGENT: 'Agent',
  ACCOUNTANT: 'Accountant',
  TEAM_LEAD: 'Team Lead'
}

export const useStore = defineStore('main', () => {
  // Session
  const token = ref<string | null>(tokenStore.get())
  const user = ref<AuthUser | null>(null)
  const authReady = ref(false)

  // Presentation
  const language = ref<'ar' | 'en'>('en')
  const initialized = ref(false)

  // Property domain
  const properties = ref<Property[]>([])
  const allProperties = ref<Property[]>([])
  const currentProperty = ref<PropertyDetail | null>(null)
  const pagination = ref({ page: 1, limit: 20, total: 0, pages: 0 })
  const activeFilters = ref<PropertyFilters>({})

  // Notifications
  const notifications = ref<AppNotification[]>([])
  const unreadNotificationCount = ref(0)
  let notificationPoller: number | null = null

  // Shared request state
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => Boolean(token.value))
  const isArabic = computed(() => language.value === 'ar')
  const isEnglish = computed(() => language.value === 'en')
  const direction = computed(() => (isArabic.value ? 'rtl' : 'ltr'))
  const canManage = computed(() => user.value?.role === 'ADMIN' || user.value?.role === 'MANAGER')
  const canManageFinance = computed(() => canManage.value || user.value?.role === 'ACCOUNTANT')

  function applyDirection(): void {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language.value
      document.documentElement.dir = direction.value
    }
  }

  function setLanguage(lang: 'ar' | 'en'): void {
    language.value = lang
    localStorage.setItem(LANGUAGE_KEY, lang)
    applyDirection()
  }

  function toggleLanguage(): void {
    setLanguage(isArabic.value ? 'en' : 'ar')
  }

  function setError(value: unknown): void {
    error.value = value ? errorMessage(value) : null
  }

  function init(): void {
    if (initialized.value) return
    initialized.value = true
    const saved = localStorage.getItem(LANGUAGE_KEY)
    if (saved === 'ar' || saved === 'en') language.value = saved
    applyDirection()
  }

  async function bootstrap(): Promise<void> {
    init()
    if (!token.value) {
      authReady.value = true
      return
    }
    try {
      const response = await apiGet<AuthUser>('/auth/me')
      user.value = response.data
      const saved = localStorage.getItem(LANGUAGE_KEY)
      // Package 29: a user's own preference wins over the tenant default.
      const lang = response.data?.preferredLang || response.data?.defaultLanguage
      if (saved !== 'ar' && saved !== 'en' && (lang === 'ar' || lang === 'en')) setLanguage(lang)
    } catch {
      tokenStore.clear()
      token.value = null
      user.value = null
    } finally {
      authReady.value = true
    }
  }

  async function login(email: string, password: string): Promise<void> {
    loading.value = true
    setError(null)
    try {
      const response = await apiPost<AuthUser & { token: string }>('/auth/login', { email, password })
      tokenStore.set(response.data.token)
      token.value = response.data.token
      const { token: _token, ...safeUser } = response.data
      user.value = safeUser as AuthUser
      const saved = localStorage.getItem(LANGUAGE_KEY)
      const preferred = response.data.preferredLang
      if (saved !== 'ar' && saved !== 'en' && (preferred === 'ar' || preferred === 'en')) setLanguage(preferred)
    } catch (e) {
      setError(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function register(payload: {
    email: string
    password: string
    organizationId: string
    firstName?: string
  }): Promise<void> {
    loading.value = true
    setError(null)
    try {
      const response = await apiPost<AuthUser & { token: string }>('/auth/register', payload)
      tokenStore.set(response.data.token)
      token.value = response.data.token
      const { token: _token, ...safeUser } = response.data
      user.value = safeUser as AuthUser
    } catch (e) {
      setError(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  /** Package 29: self-service profile update through /auth/me. */
  async function updateProfile(payload: Partial<Pick<AuthUser, 'firstName' | 'phone' | 'jobTitle' | 'avatarUrl' | 'preferredLang'>>): Promise<AuthUser> {
    const response = await apiPatch<AuthUser>('/auth/me', payload)
    user.value = { ...(user.value || ({} as AuthUser)), ...response.data }
    if (response.data.preferredLang === 'ar' || response.data.preferredLang === 'en') {
      setLanguage(response.data.preferredLang)
    }
    return response.data
  }

  /** Package 29: changing a password revokes every active session. */
  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiPost('/auth/change-password', { currentPassword, newPassword })
  }

  async function logout(): Promise<void> {
    stopNotificationPolling()
    // Ask the API to bump tokenVersion so this session cannot be replayed.
    // Local state is cleared even if the server call fails (offline logout).
    try {
      await apiPost('/auth/logout')
    } catch {
      // Ignore network/session errors; the local token is discarded below.
    }
    tokenStore.clear()
    token.value = null
    user.value = null
    properties.value = []
    allProperties.value = []
    currentProperty.value = null
    notifications.value = []
    unreadNotificationCount.value = 0
    error.value = null
  }

  async function fetchNotifications(options: { limit?: number; unread?: boolean; category?: string } = {}): Promise<void> {
    if (!token.value) return
    try {
      const params: Record<string, string | number | boolean> = {}
      if (options.limit) params.limit = options.limit
      if (options.unread) params.unread = true
      if (options.category) params.category = options.category
      const response = await apiGet<AppNotification[]>('/notifications', { params })
      notifications.value = response.data ?? []
      const envelope = response as unknown as { unreadCount?: number }
      if (typeof envelope.unreadCount === 'number') unreadNotificationCount.value = envelope.unreadCount
      else unreadNotificationCount.value = notifications.value.filter((item) => !item.isRead).length
    } catch {
      // Notification polling should not disrupt the rest of the UI.
    }
  }

  async function refreshUnreadNotificationCount(): Promise<void> {
    if (!token.value) return
    try {
      const response = await apiGet<{ count: number }>('/notifications/unread-count')
      unreadNotificationCount.value = response.data?.count ?? 0
    } catch {
      // ignore
    }
  }

  async function markNotificationRead(id: string): Promise<void> {
    try {
      await apiPatch(`/notifications/${id}/read`)
      const target = notifications.value.find((item) => item.id === id)
      if (target && !target.isRead) {
        target.isRead = true
        target.readAt = new Date().toISOString()
        unreadNotificationCount.value = Math.max(0, unreadNotificationCount.value - 1)
      } else {
        await refreshUnreadNotificationCount()
      }
    } catch (e) {
      setError(e)
    }
  }

  async function markAllNotificationsRead(): Promise<void> {
    try {
      await apiPatch('/notifications/read-all')
      notifications.value = notifications.value.map((item) => ({ ...item, isRead: true, readAt: item.readAt || new Date().toISOString() }))
      unreadNotificationCount.value = 0
    } catch (e) {
      setError(e)
    }
  }

  function startNotificationPolling(intervalMs = 45000): void {
    if (typeof window === 'undefined' || notificationPoller) return
    void refreshUnreadNotificationCount()
    notificationPoller = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshUnreadNotificationCount()
    }, intervalMs)
  }

  function stopNotificationPolling(): void {
    if (typeof window !== 'undefined' && notificationPoller) {
      window.clearInterval(notificationPoller)
      notificationPoller = null
    }
  }

  function filterProperties(filters: PropertyFilters): void {
    activeFilters.value = { ...filters }
    // Filtering is performed by the API; keep a local pass for instant feedback
    // while never discarding the authoritative list.
    const q = (filters.search || '').trim().toLowerCase()
    properties.value = allProperties.value.filter((property) => {
      if (q && !`${property.title} ${property.referenceNumber} ${property.city ?? ''}`.toLowerCase().includes(q)) {
        return false
      }
      if (filters.status && property.status !== filters.status) return false
      if (filters.type && property.type !== filters.type) return false
      if (filters.city && property.city !== filters.city) return false
      const price = Number(property.price)
      if (filters.minPrice && price < Number(filters.minPrice)) return false
      if (filters.maxPrice && price > Number(filters.maxPrice)) return false
      return true
    })
  }

  function clearFilters(): void {
    activeFilters.value = {}
    properties.value = [...allProperties.value]
  }

  async function fetchProperties(filters: PropertyFilters = {}): Promise<void> {
    loading.value = true
    setError(null)
    try {
      const params: Record<string, string | number | boolean> = {}
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params[key] = value as string | number | boolean
        }
      })
      const response = await apiGet<Property[]>('/properties', { params })
      allProperties.value = response.data ?? []
      properties.value = [...allProperties.value]
      if (response.pagination) pagination.value = response.pagination
      activeFilters.value = filters
    } catch (e) {
      setError(e)
    } finally {
      loading.value = false
    }
  }

  async function fetchProperty(id: string): Promise<PropertyDetail | null> {
    loading.value = true
    setError(null)
    try {
      const response = await apiGet<PropertyDetail>(`/properties/${id}`)
      currentProperty.value = response.data
      return response.data
    } catch (e) {
      setError(e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function createProperty(payload: Record<string, unknown>): Promise<Property | null> {
    loading.value = true
    setError(null)
    try {
      const response = await apiPost<Property>('/properties', payload)
      await fetchProperties(activeFilters.value)
      return response.data
    } catch (e) {
      setError(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function updateProperty(id: string, payload: Record<string, unknown>): Promise<Property | null> {
    loading.value = true
    setError(null)
    try {
      const { apiPatch } = await import('@/api/client')
      const response = await apiPatch<Property>(`/properties/${id}`, payload)
      await fetchProperties(activeFilters.value)
      return response.data
    } catch (e) {
      setError(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function deleteProperty(id: string): Promise<void> {
    loading.value = true
    setError(null)
    try {
      const { apiDelete } = await import('@/api/client')
      await apiDelete(`/properties/${id}`)
      await fetchProperties(activeFilters.value)
    } catch (e) {
      setError(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    // session
    token,
    user,
    authReady,
    isAuthenticated,
    canManage,
    canManageFinance,
    // presentation
    language,
    initialized,
    isArabic,
    isEnglish,
    direction,
    // properties
    properties,
    allProperties,
    currentProperty,
    pagination,
    activeFilters,
    loading,
    error,
    // notifications
    notifications,
    unreadNotificationCount,
    fetchNotifications,
    refreshUnreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    startNotificationPolling,
    stopNotificationPolling,
    // actions
    init,
    bootstrap,
    setLanguage,
    toggleLanguage,
    login,
    register,
    updateProfile,
    changePassword,
    logout,
    fetchProperties,
    fetchProperty,
    createProperty,
    updateProperty,
    deleteProperty,
    filterProperties,
    clearFilters
  }
})

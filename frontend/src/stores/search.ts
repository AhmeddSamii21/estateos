import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiGlobalSearch } from '@/api/client'
import { type GlobalSearchResponse } from '@/types/search'

type SearchData = GlobalSearchResponse['data']

function emptyResults(): SearchData {
  return {
    properties: [],
    owners: [],
    leads: [],
    deals: [],
    documents: [],
    total: 0
  }
}

export const useSearchStore = defineStore('search', () => {
  // State
  const isOpen = ref(false)
  const query = ref('')
  const results = ref<SearchData>(emptyResults())
  const loading = ref(false)
  const error = ref<string | null>(null)
  let searchTimeout: ReturnType<typeof setTimeout> | null = null
  let requestSequence = 0

  // Computed
  const filteredProperties = computed(() => results.value.properties)
  const filteredOwners = computed(() => results.value.owners)
  const filteredLeads = computed(() => results.value.leads)
  const filteredDeals = computed(() => results.value.deals)
  const filteredDocuments = computed(() => results.value.documents)
  const hasResults = computed(() =>
    results.value.properties.length + results.value.owners.length +
    results.value.leads.length + results.value.deals.length + results.value.documents.length > 0
  )

  function cancelPendingSearch(): void {
    if (searchTimeout) {
      clearTimeout(searchTimeout)
      searchTimeout = null
    }
    // Invalidate any in-flight response so a stale search cannot repopulate results.
    requestSequence += 1
  }

  // Actions
  function open(): void {
    cancelPendingSearch()
    isOpen.value = true
    query.value = ''
    results.value = emptyResults()
    loading.value = false
    error.value = null
  }

  function close(): void {
    cancelPendingSearch()
    isOpen.value = false
    query.value = ''
    results.value = emptyResults()
    loading.value = false
    error.value = null
  }

  function toggle(): void {
    isOpen.value ? close() : open()
  }

  async function performSearch(newQuery: string = query.value): Promise<void> {
    cancelPendingSearch()

    const trimmed = newQuery.trim()
    if (!trimmed) {
      query.value = ''
      results.value = emptyResults()
      loading.value = false
      error.value = null
      return
    }

    searchTimeout = setTimeout(async () => {
      searchTimeout = null
      const requestId = ++requestSequence
      query.value = trimmed
      loading.value = true
      error.value = null

      try {
        const response = await apiGlobalSearch(trimmed)
        if (requestId !== requestSequence) return
        results.value = response.data.data ?? emptyResults()
      } catch (err) {
        if (requestId !== requestSequence) return
        error.value = err instanceof Error ? err.message : 'Failed to search'
        results.value = emptyResults()
      } finally {
        if (requestId === requestSequence) loading.value = false
      }
    }, 300)
  }

  function clearResults(): void {
    cancelPendingSearch()
    results.value = emptyResults()
    loading.value = false
    error.value = null
  }

  return {
    // State
    isOpen,
    query,
    results,
    loading,
    error,
    // Computed
    filteredProperties,
    filteredOwners,
    filteredLeads,
    filteredDeals,
    filteredDocuments,
    hasResults,
    // Actions
    open,
    close,
    toggle,
    performSearch,
    clearResults
  }
})

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="search.isOpen" class="search-backdrop" @click.self="close">
        <div
          class="search-modal"
          :dir="ui.direction"
          role="dialog"
          aria-modal="true"
          :aria-label="ui.isArabic ? 'بحث عام' : 'Global Search'"
          @keydown="handleKeydown"
        >
          <div class="search-header">
            <h2>{{ ui.isArabic ? 'بحث عام' : 'Global Search' }}</h2>
            <button class="close-btn" type="button" @click="close" :aria-label="ui.isArabic ? 'إغلاق' : 'Close'">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="search-input-wrapper">
            <i class="fas fa-search search-icon"></i>
            <input
              ref="inputRef"
              v-model="localQuery"
              type="search"
              autocomplete="off"
              :placeholder="ui.isArabic ? 'ابحث في جميع الوثائق...' : 'Search in all documents...'"
              @input="handleInput"
            />
          </div>

          <div v-if="search.loading" class="search-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <span>{{ ui.isArabic ? 'جارٍ البحث...' : 'Searching...' }}</span>
          </div>

          <div v-else-if="search.error" class="search-error" role="alert">
            {{ search.error }}
          </div>

          <div v-else-if="!search.query.trim()" class="search-empty">
            <i class="fas fa-search"></i>
            <span>{{ ui.isArabic ? 'اكتب للبحث...' : 'Type to search...' }}</span>
          </div>

          <div v-else-if="!search.hasResults" class="search-empty">
            <i class="fas fa-search"></i>
            <span>{{ ui.isArabic ? 'لا توجد نتائج مطابقة' : 'No matching results' }}</span>
          </div>

          <div v-else class="search-results">
            <template v-for="group in resultGroups" :key="group.key">
              <div class="result-section">
                <div class="section-title">
                  <i :class="group.icon"></i>
                  {{ group.title }}
                </div>
                <div class="result-list" role="listbox" :aria-label="group.title">
                  <button
                    v-for="item in group.items"
                    :key="`${item.type}-${item.id}`"
                    type="button"
                    class="result-item"
                    :class="{ active: activeIndex === item.resultIndex }"
                    :data-result-index="item.resultIndex"
                    role="option"
                    :aria-selected="activeIndex === item.resultIndex"
                    @click="navigateTo(item.route)"
                    @mousemove="activeIndex = item.resultIndex"
                  >
                    <i :class="group.icon" class="result-icon"></i>
                    <span class="result-content">
                      <span class="result-title">{{ item.title }}</span>
                      <span v-if="group.key === 'properties'" class="result-details">
                        {{ detail(item, 'city') }}{{ detail(item, 'address') ? ', ' + detail(item, 'address') : '' }}
                      </span>
                      <span v-else-if="group.key === 'owners' || group.key === 'leads'" class="result-details">
                        {{ detail(item, 'email') || detail(item, 'phone') }}
                      </span>
                      <span v-else-if="group.key === 'deals'" class="result-details">
                        {{ detail(item, 'referenceNumber') }}
                      </span>
                      <span v-else class="result-details">
                        {{ detail(item, 'category') || detail(item, 'originalName') }}
                      </span>
                      <span v-if="group.key === 'properties'" class="result-meta">
                        <span class="meta-price">{{ formatPrice(detail(item, 'price')) }}</span>
                        <span class="meta-type">{{ detail(item, 'type') }}</span>
                      </span>
                      <span v-else-if="group.key === 'leads'" class="result-meta">
                        <span class="meta-status">{{ detail(item, 'status') }}</span>
                      </span>
                      <span v-else-if="group.key === 'deals'" class="result-meta">
                        <span class="meta-price">{{ formatPrice(detail(item, 'amount')) }}</span>
                        <span class="meta-type">{{ detail(item, 'type') }}</span>
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSearchStore } from '@/stores/search'
import { useStore as useMainStore } from '@/stores'
import type { SearchResult } from '@/types/search'

interface NavigationItem extends SearchResult {
  resultIndex: number
}

interface ResultGroup {
  key: string
  title: string
  icon: string
  items: NavigationItem[]
}

const search = useSearchStore()
const ui = useMainStore()
const router = useRouter()
const inputRef = ref<HTMLInputElement | null>(null)
const localQuery = ref(search.query)
const activeIndex = ref(-1)

const resultGroups = computed<ResultGroup[]>(() => {
  let index = 0
  const withIndexes = (items: SearchResult[]): NavigationItem[] =>
    items.map((item) => ({ ...item, resultIndex: index++ }))

  return [
    {
      key: 'properties',
      title: ui.isArabic ? 'عقارات' : 'Properties',
      icon: 'fas fa-building',
      items: withIndexes(search.filteredProperties)
    },
    {
      key: 'owners',
      title: ui.isArabic ? 'المالكون' : 'Owners',
      icon: 'fas fa-user',
      items: withIndexes(search.filteredOwners)
    },
    {
      key: 'leads',
      title: ui.isArabic ? 'العملاء المحتملون' : 'Leads',
      icon: 'fas fa-user-plus',
      items: withIndexes(search.filteredLeads)
    },
    {
      key: 'deals',
      title: ui.isArabic ? 'الصفقات' : 'Deals',
      icon: 'fas fa-handshake',
      items: withIndexes(search.filteredDeals)
    },
    {
      key: 'documents',
      title: ui.isArabic ? 'الوثائق' : 'Documents',
      icon: 'fas fa-folder-open',
      items: withIndexes(search.filteredDocuments)
    }
  ].filter((group) => group.items.length > 0)
})

const navigableResults = computed(() => resultGroups.value.flatMap((group) => group.items))

function detail(item: SearchResult, key: string): string {
  const value = item.details?.[key]
  return value === null || value === undefined ? '' : String(value)
}

function formatPrice(value: string): string {
  if (!value) return ''
  const number = Number(value)
  if (Number.isNaN(number)) return value
  return number.toLocaleString(ui.isArabic ? 'ar-SA' : 'en-US')
}

function close(): void {
  search.close()
  activeIndex.value = -1
}

function handleInput(): void {
  activeIndex.value = -1
  void search.performSearch(localQuery.value)
}

async function revealActiveResult(): Promise<void> {
  if (activeIndex.value < 0) return
  await nextTick()
  document.querySelector<HTMLElement>(`.search-modal [data-result-index="${activeIndex.value}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}

function handleKeydown(event: KeyboardEvent): void {
  const items = navigableResults.value

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!items.length) return
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = activeIndex.value === -1
      ? (step === 1 ? 0 : items.length - 1)
      : (activeIndex.value + step + items.length) % items.length
    void revealActiveResult()
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    const selected = activeIndex.value >= 0 ? items[activeIndex.value] : items[0]
    if (selected) navigateTo(selected.route)
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && search.isOpen) {
    event.preventDefault()
    close()
  }
}

function navigateTo(route: string): void {
  close()
  void router.push(route)
}

watch(() => search.isOpen, async (open) => {
  if (open) {
    activeIndex.value = -1
    localQuery.value = search.query
    await nextTick()
    inputRef.value?.focus()
  } else {
    activeIndex.value = -1
  }
})

watch(() => search.query, (value) => {
  localQuery.value = value
})

watch(() => search.results, () => {
  activeIndex.value = -1
})

onMounted(() => {
  document.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<style scoped>
.search-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  z-index: 1000;
}

.search-modal {
  width: 90%;
  max-width: 800px;
  max-height: 85vh;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.search-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.search-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #111827;
}

.close-btn {
  background: none;
  border: none;
  color: #6b7280;
  cursor: pointer;
  font-size: 1.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  transition: color 0.2s;
}

.close-btn:hover {
  color: #111827;
  background: #f3f4f6;
}

.search-input-wrapper {
  position: relative;
  padding: 0.75rem 1.5rem;
}

.search-icon {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  pointer-events: none;
}

.search-input-wrapper input {
  width: 100%;
  padding: 0.75rem 1rem 0.75rem 2.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 1rem;
  outline: none;
  transition: border-color 0.2s;
}

.search-input-wrapper input:focus {
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.search-loading,
.search-error,
.search-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem;
  color: #6b7280;
  font-size: 0.95rem;
}

.search-loading i {
  color: #4f46e5;
  font-size: 1.25rem;
}

.search-empty {
  flex-direction: column;
  gap: 0.5rem;
}

.search-empty i {
  font-size: 2rem;
  color: #9ca3af;
}

.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 0 1.5rem 1.5rem;
}

.result-section {
  margin-bottom: 2rem;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  color: #6b7280;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem;
  border: 0;
  border-radius: 8px;
  background: #f9fafb;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: background-color 0.2s, box-shadow 0.2s, transform 0.2s;
}

.result-item:hover,
.result-item.active {
  background: #eef2ff;
  box-shadow: inset 0 0 0 1px #c7d2fe;
}

.result-item:focus-visible {
  outline: 2px solid #4f46e5;
  outline-offset: 2px;
}

.result-item.active {
  transform: translateX(4px);
}

.result-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 1rem;
  flex-shrink: 0;
}

.result-icon.property {
  background: #e0e7ff;
  color: #4f46e5;
}

.result-icon.owner {
  background: #fef3c7;
  color: #d97706;
}

.result-icon.lead {
  background: #d1fae5;
  color: #059669;
}

.result-icon.deal {
  background: #fce7f3;
  color: #db2777;
}

.result-icon.document {
  background: #e5e7eb;
  color: #374151;
}

.result-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.result-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #111827;
  margin-bottom: 0.25rem;
}

.result-details {
  font-size: 0.8rem;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-meta {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.meta-price,
.meta-type,
.meta-status {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  background: #fff;
  border: 1px solid #e5e7eb;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

/* RTL support */
:global(.rtl) .search-input-wrapper input {
  padding-left: 1rem;
  padding-right: 2.75rem;
}

:global(.rtl) .search-icon {
  left: auto;
  right: 1rem;
}

:global(.rtl) .result-item.active {
  transform: translateX(-4px);
}

@media (max-width: 768px) {
  .search-backdrop {
    padding-top: 5vh;
  }

  .search-modal {
    width: 95%;
    max-height: 90vh;
  }

  .result-item {
    padding: 0.5rem;
  }
}
</style>

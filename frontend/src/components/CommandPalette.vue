<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="palette.isOpen" class="palette-backdrop" @click.self="close">
        <div
          class="palette"
          :dir="store.direction"
          role="dialog"
          aria-modal="true"
          :aria-label="store.isArabic ? 'لوحة الأوامر' : 'Command palette'"
          @keydown="handleKeydown"
        >
          <div class="palette-header">
            <i class="fas fa-bolt" aria-hidden="true"></i>
            <input
              ref="inputRef"
              v-model="query"
              type="search"
              autocomplete="off"
              :placeholder="store.isArabic ? 'ابحث عن أمر أو صفحة أو إعداد محفوظ...' : 'Search commands, pages or saved presets...'"
              :aria-label="store.isArabic ? 'ابحث في الأوامر' : 'Search commands'"
            />
            <kbd>{{ store.isArabic ? 'إغلاق Esc' : 'Esc to close' }}</kbd>
          </div>

          <div class="palette-body">
            <div v-if="!groups.length" class="palette-empty">
              <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
              <span>{{ store.isArabic ? 'لا توجد أوامر مطابقة' : 'No matching commands' }}</span>
            </div>
            <template v-for="group in groups" :key="group.key">
              <section class="palette-group">
                <h3>{{ group.title }}</h3>
                <button
                  v-for="item in group.items"
                  :key="item.id"
                  type="button"
                  class="palette-item"
                  :class="{ active: item.flatIndex === activeIndex }"
                  :data-command-index="item.flatIndex"
                  role="option"
                  :aria-selected="item.flatIndex === activeIndex"
                  @mousemove="activeIndex = item.flatIndex"
                  @click="run(item)"
                >
                  <i :class="item.icon" aria-hidden="true"></i>
                  <span class="item-copy">
                    <span class="item-label">{{ item.label }}</span>
                    <span v-if="item.hint" class="item-hint">{{ item.hint }}</span>
                  </span>
                  <span v-if="item.shortcut" class="item-shortcut">{{ item.shortcut }}</span>
                </button>
              </section>
            </template>
          </div>

          <div class="palette-footer">
            <span>{{ store.isArabic ? '↑ ↓ للتنقل · Enter للتنفيذ' : '↑ ↓ to navigate · Enter to run' }}</span>
            <span>{{ store.isArabic ? 'الإعدادات المحفوظة محلية لهذا الجهاز' : 'Presets are saved locally on this device' }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useStore } from '@/stores'
import { useCommandPaletteStore } from '@/stores/commandPalette'
import { useSearchStore } from '@/stores/search'
import { listFilterPresets } from '@/utils/filterPresets'
import { listRecentItems } from '@/utils/recentItems'

interface CommandItem {
  id: string
  section: 'actions' | 'recent' | 'presets'
  label: string
  hint: string
  icon: string
  shortcut?: string
  flatIndex: number
  run: () => void
}

interface CommandGroup {
  key: CommandItem['section']
  title: string
  items: CommandItem[]
}

const store = useStore()
const palette = useCommandPaletteStore()
const search = useSearchStore()
const router = useRouter()
const inputRef = ref<HTMLInputElement | null>(null)
const query = ref('')
const activeIndex = ref(-1)

const scope = computed(() => String(store.user?.id || store.user?.email || 'anonymous'))

function label(english: string, arabic: string): string {
  return store.isArabic ? arabic : english
}

interface ActionSpec {
  id: string
  english: string
  arabic: string
  hintEn: string
  hintAr: string
  icon: string
  route?: string
  shortcut?: string
  action?: () => void
}

const actionSpecs = computed<ActionSpec[]>(() => {
  const specs: ActionSpec[] = [
    { id: 'dashboard', english: 'Dashboard', arabic: 'لوحة التحكم', hintEn: 'Overview and aging snapshot', hintAr: 'نظرة عامة وتقرير التأخر', icon: 'fas fa-gauge-high', route: '/' },
    { id: 'properties', english: 'Properties', arabic: 'العقارات', hintEn: 'Browse the property portfolio', hintAr: 'تصفح محفظة العقارات', icon: 'fas fa-building', route: '/properties' },
    { id: 'advanced-search', english: 'Search & Map', arabic: 'البحث والخريطة', hintEn: 'Search properties on the map', hintAr: 'ابحث عن العقارات على الخريطة', icon: 'fas fa-map-marked-alt', route: '/search' },
    { id: 'leads', english: 'Leads', arabic: 'العملاء المحتملون', hintEn: 'Qualify and prioritise enquiries', hintAr: 'تأهيل الطلبات وترتيب أولوياتها', icon: 'fas fa-user-plus', route: '/leads' },
    { id: 'appointments', english: 'Appointments', arabic: 'المواعيد', hintEn: 'Schedule viewings and calls', hintAr: 'جدولة المعاينات والمكالمات', icon: 'fas fa-calendar', route: '/appointments' },
    { id: 'deals', english: 'Deals', arabic: 'الصفقات', hintEn: 'Track deal stages and checklists', hintAr: 'متابعة مراحل الصفقات وقوائم الإغلاق', icon: 'fas fa-handshake', route: '/deals' },
    { id: 'payment-calculator', english: 'Payment calculator', arabic: 'حاسبة الدفعات', hintEn: 'Model installments, markup, and balloons', hintAr: 'نمذج الأقساط والهامش والدفعات الكبيرة', icon: 'fas fa-calculator', route: '/finance/payment-calculator' },
    { id: 'maintenance', english: 'Maintenance', arabic: 'الصيانة', hintEn: 'Recurring requests and expenses', hintAr: 'الطلبات المتكررة والمصروفات', icon: 'fas fa-screwdriver-wrench', route: '/maintenance' },
    { id: 'global-search', english: 'Global search', arabic: 'البحث العام', hintEn: 'Find records across the workspace', hintAr: 'ابحث في السجلات في كل مساحة العمل', icon: 'fas fa-magnifying-glass', shortcut: '⌘K', action: () => search.open() }
  ]
  if (store.canManageFinance) {
    specs.push({ id: 'reports', english: 'Reports & Analytics', arabic: 'التقارير والتحليلات', hintEn: 'Portfolio and finance reports', hintAr: 'تقارير المحفظة والمالية', icon: 'fas fa-chart-column', route: '/reports' })
  }
  if (store.canManage) {
    specs.push(
      { id: 'owners', english: 'Owners', arabic: 'المالكون', hintEn: 'Owner statements and payouts', hintAr: 'كشوف المالكين والمدفوعات', icon: 'fas fa-user-tie', route: '/owners' },
      { id: 'settings', english: 'Settings', arabic: 'الإعدادات', hintEn: 'Tenant settings and integrations', hintAr: 'إعدادات المؤسسة والتكاملات', icon: 'fas fa-gear', route: '/settings' }
    )
  }
  return specs
})

function matches(queryText: string, english: string, arabic: string): boolean {
  const needle = queryText.trim().toLowerCase()
  if (!needle) return true
  return english.toLowerCase().includes(needle) || arabic.includes(needle)
}

const groups = computed<CommandGroup[]>(() => {
  let flatIndex = 0
  const result: CommandGroup[] = []

  const actions: CommandItem[] = []
  for (const spec of actionSpecs.value) {
    if (!matches(query.value, spec.english, spec.arabic)) continue
    const destination = spec.route
    const action = spec.action
    actions.push({
      id: `action-${spec.id}`,
      section: 'actions',
      label: label(spec.english, spec.arabic),
      hint: label(spec.hintEn, spec.hintAr),
      icon: spec.icon,
      shortcut: spec.shortcut,
      flatIndex: flatIndex++,
      run: () => {
        close()
        if (action) action()
        else if (destination) void router.push(destination)
      }
    })
  }
  if (actions.length) result.push({ key: 'actions', title: label('Quick actions', 'إجراءات سريعة'), items: actions })

  const recent: CommandItem[] = []
  for (const item of listRecentItems(scope.value)) {
    if (!matches(query.value, item.title, item.title)) continue
    recent.push({
      id: `recent-${item.type}-${item.id}`,
      section: 'recent',
      label: item.title,
      hint: label(`Recent ${item.type.toLowerCase()}`, `عنصر حديث: ${item.type.toLowerCase()}`),
      icon: 'fas fa-clock-rotate-left',
      flatIndex: flatIndex++,
      run: () => {
        close()
        void router.push(item.route)
      }
    })
  }
  if (recent.length) result.push({ key: 'recent', title: label('Recent items', 'العناصر الأخيرة'), items: recent })

  const presets: CommandItem[] = []
  for (const preset of listFilterPresets(scope.value)) {
    if (!matches(query.value, preset.name, preset.name)) continue
    presets.push({
      id: `preset-${preset.id}`,
      section: 'presets',
      label: preset.name,
      hint: label('Apply saved property filters', 'تطبيق مرشحات العقارات المحفوظة'),
      icon: 'fas fa-bookmark',
      flatIndex: flatIndex++,
      run: () => {
        close()
        void router.push({ path: '/properties', query: { preset: preset.id } })
      }
    })
  }
  if (presets.length) result.push({ key: 'presets', title: label('Saved filter presets', 'مرشحات محفوظة'), items: presets })

  return result
})

const flatItems = computed(() => groups.value.flatMap((group) => group.items))

function close(): void {
  palette.close()
  activeIndex.value = -1
  query.value = ''
}

function run(item: CommandItem): void {
  activeIndex.value = -1
  item.run()
}

function handleKeydown(event: KeyboardEvent): void {
  const items = flatItems.value
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!items.length) return
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = activeIndex.value === -1
      ? (step === 1 ? 0 : items.length - 1)
      : (activeIndex.value + step + items.length) % items.length
    void revealActive()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const selected = activeIndex.value >= 0 ? items[activeIndex.value] : items[0]
    if (selected) run(selected)
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  const isCommandKey = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k'
  if (isCommandKey) {
    event.preventDefault()
    palette.toggle()
    return
  }
  if (event.key === 'Escape' && palette.isOpen) {
    event.preventDefault()
    close()
  }
}

async function revealActive(): Promise<void> {
  if (activeIndex.value < 0) return
  await nextTick()
  document.querySelector<HTMLElement>(`.palette [data-command-index="${activeIndex.value}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}

watch(() => palette.isOpen, async (open) => {
  if (open) {
    query.value = ''
    activeIndex.value = -1
    await nextTick()
    inputRef.value?.focus()
  }
})

watch(query, () => {
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
.palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8vh 1rem 1rem;
  background: rgba(15, 23, 42, 0.58);
}

.palette {
  width: min(680px, 100%);
  max-height: min(82vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.36);
}

.palette-header {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 1rem 1.1rem;
  border-bottom: 1px solid #e5e7eb;
}

.palette-header > i {
  color: #4f46e5;
}

.palette-header input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  border: 0;
  outline: 0;
  font-size: 1rem;
  background: transparent;
  color: #111827;
}

.palette-header kbd {
  font-size: 0.7rem;
  color: #6b7280;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.25rem 0.45rem;
  white-space: nowrap;
}

.palette-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0.75rem 0.9rem;
}

.palette-group h3 {
  margin: 0.9rem 0.45rem 0.4rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6b7280;
}

.palette-item {
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #111827;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.palette-item > i {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 8px;
  background: #eef2ff;
  color: #4f46e5;
}

.palette-item:hover,
.palette-item.active {
  background: #eef2ff;
  box-shadow: inset 0 0 0 1px #c7d2fe;
}

.palette-item:focus-visible {
  outline: 2px solid #4f46e5;
  outline-offset: -2px;
}

.item-copy {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1;
  min-width: 0;
}

.item-label {
  font-weight: 600;
  font-size: 0.92rem;
}

.item-hint {
  font-size: 0.76rem;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-shortcut {
  font-size: 0.72rem;
  color: #6b7280;
  border: 1px solid #e5e7eb;
  border-radius: 5px;
  padding: 0.15rem 0.35rem;
}

.palette-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.5rem 1rem;
  color: #6b7280;
}

.palette-empty i {
  font-size: 1.6rem;
}

.palette-footer {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 1rem;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
  color: #6b7280;
  font-size: 0.72rem;
}

.palette-enter-active,
.palette-leave-active {
  transition: opacity 0.18s ease;
}

.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .palette-backdrop {
    padding: 4vh 0.5rem 0.5rem;
  }

  .palette {
    max-height: 92vh;
    border-radius: 10px;
  }

  .palette-header kbd,
  .palette-footer span:last-child {
    display: none;
  }

  .item-hint {
    white-space: normal;
  }
}

@media (max-width: 480px) {
  .palette-footer {
    justify-content: center;
  }

  .palette-item {
    padding-inline: 0.5rem;
  }
}
</style>

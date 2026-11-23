<template>
  <div class="app-shell" :dir="store.direction">
    <aside class="sidebar">
      <router-link class="brand" to="/">
        <i class="fas fa-building"></i>
        <span>EstateOS</span>
      </router-link>

      <nav class="nav" aria-label="Main navigation">
        <router-link to="/" class="nav-link">
          <i class="fas fa-gauge-high"></i><span>{{ t('Dashboard') }}</span>
        </router-link>
        <router-link to="/properties" class="nav-link">
          <i class="fas fa-building"></i><span>{{ t('Properties') }}</span>
        </router-link>
        <router-link to="/search" class="nav-link">
          <i class="fas fa-map-marked-alt"></i><span>{{ t('Search & Map') }}</span>
        </router-link>
        <router-link to="/leads" class="nav-link">
          <i class="fas fa-user-plus"></i><span>{{ t('Leads') }}</span>
        </router-link>
        <router-link to="/appointments" class="nav-link">
          <i class="fas fa-calendar"></i><span>{{ t('Appointments') }}</span>
        </router-link>
        <router-link to="/deals" class="nav-link">
          <i class="fas fa-handshake"></i><span>{{ t('Deals') }}</span>
        </router-link>
        <router-link to="/documents" class="nav-link">
          <i class="fas fa-folder-open"></i><span>{{ t('Documents') }}</span>
        </router-link>
        <router-link to="/maintenance" class="nav-link">
          <i class="fas fa-screwdriver-wrench"></i><span>{{ t('Maintenance') }}</span>
        </router-link>
        <router-link to="/activity" class="nav-link">
          <i class="fas fa-clock-rotate-left"></i><span>{{ t('Activity') }}</span>
        </router-link>
        <router-link v-if="store.user?.role === 'AGENT'" to="/finance/commission-statements" class="nav-link">
          <i class="fas fa-file-invoice-dollar"></i><span>{{ t('My statements') }}</span>
        </router-link>

        <div v-if="store.canManageFinance" class="nav-group">
          <span class="nav-heading">{{ t('Finance') }}</span>
          <router-link to="/finance/payments" class="nav-link nav-child">
            <i class="fas fa-money-bill"></i><span>{{ t('Payments') }}</span>
          </router-link>
          <router-link to="/finance/expenses" class="nav-link nav-child">
            <i class="fas fa-receipt"></i><span>{{ t('Expenses') }}</span>
          </router-link>
          <router-link to="/finance/commissions" class="nav-link nav-child">
            <i class="fas fa-percent"></i><span>{{ t('Commissions') }}</span>
          </router-link>
          <router-link to="/finance/commission-statements" class="nav-link nav-child">
            <i class="fas fa-file-invoice-dollar"></i><span>{{ t('Commission statements') }}</span>
          </router-link>
          <router-link to="/finance/exchange-rates" class="nav-link nav-child">
            <i class="fas fa-arrow-right-arrow-left"></i><span>{{ t('Exchange rates') }}</span>
          </router-link>
          <router-link to="/reports" class="nav-link nav-child">
            <i class="fas fa-chart-column"></i><span>{{ t('Reports') }}</span>
          </router-link>
        </div>

        <div v-if="store.canManage" class="nav-group">
          <span class="nav-heading">{{ t('Administration') }}</span>
          <router-link to="/owners" class="nav-link nav-child">
            <i class="fas fa-user-tie"></i><span>{{ t('Owners') }}</span>
          </router-link>
          <router-link to="/users" class="nav-link nav-child">
            <i class="fas fa-users"></i><span>{{ t('Users') }}</span>
          </router-link>
          <router-link to="/settings" class="nav-link nav-child">
            <i class="fas fa-gear"></i><span>{{ t('Settings') }}</span>
          </router-link>
        </div>
      </nav>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <div class="topbar-title">{{ pageTitle }}</div>
        <div class="topbar-actions">
          <div class="notification-wrap">
            <button class="icon-btn" type="button" :aria-label="t('Notifications')" @click="toggleNotifications">
              <i class="fas fa-bell"></i>
              <span v-if="store.unreadNotificationCount" class="badge-count">{{ store.unreadNotificationCount > 99 ? '99+' : store.unreadNotificationCount }}</span>
            </button>
            <div v-if="notificationsOpen" class="notification-panel" @click.stop>
              <div class="notification-head">
                <strong>{{ t('Notifications') }}</strong>
                <button class="link" type="button" @click="markAll">{{ store.isArabic ? 'تحديد الكل كمقروء' : 'Mark all read' }}</button>
              </div>
              <div v-if="!store.notifications.length" class="notification-empty">{{ store.isArabic ? 'لا توجد إشعارات' : 'No notifications' }}</div>
              <ul v-else class="notification-list">
                <li v-for="item in store.notifications.slice(0, 8)" :key="item.id" :class="{ unread: !item.isRead }">
                  <button type="button" @click="openNotification(item)">
                    <span class="n-title">{{ item.title }}</span>
                    <span class="n-message">{{ item.message }}</span>
                    <span class="n-time">{{ formatNotificationTime(item.createdAt) }}</span>
                  </button>
                </li>
              </ul>
              <router-link class="notification-footer" to="/notifications" @click="notificationsOpen = false">
                {{ store.isArabic ? 'عرض كل الإشعارات' : 'View all notifications' }}
              </router-link>
            </div>
          </div>
          <LanguageSwitcher />
          <button class="icon-btn" type="button" :aria-label="t('Search')" @click="openSearch">
            <i class="fas fa-search"></i>
          </button>
          <span v-if="store.user" class="user-chip">
            <i class="fas fa-user-circle"></i>
            {{ store.user.firstName || store.user.email }} · {{ store.user.role }}
          </span>
          <button class="btn btn-ghost" type="button" @click="onLogout">
            <i class="fas fa-right-from-bracket"></i>
            <span>{{ t('Logout') }}</span>
          </button>
        </div>
      </header>

      <div v-if="store.error" class="alert alert-error" role="alert">
        <i class="fas fa-circle-exclamation"></i>
        <span>{{ store.error }}</span>
        <button type="button" aria-label="Dismiss" @click="store.error = null">×</button>
      </div>

      <main class="content">
        <router-view />
      </main>
    </div>

    <SearchModal />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import SearchModal from '@/components/SearchModal.vue'
import { useStore } from '@/stores'
import { useSearchStore } from '@/stores/search'
import type { AppNotification } from '@/types'

const store = useStore()
const searchStore = useSearchStore()
const route = useRoute()
const router = useRouter()
const notificationsOpen = ref(false)

const ArabicLabels: Record<string, string> = {
  Search: 'بحث',
  Properties: 'العقارات',
  'Search & Map': 'البحث والخريطة',
  Leads: 'العملاء المحتملون',
  Appointments: 'المواعيد',
  Deals: 'الصفقات',
  Documents: 'الوثائق',
  Maintenance: 'الصيانة',
  Activity: 'سجل النشاط',
  Finance: 'المالية',
  Payments: 'المدفوعات',
  Expenses: 'المصروفات',
  Commissions: 'العمولات',
  'Commission statements': 'كشوف العمولات',
  'My statements': 'كشوفي',
  'Exchange rates': 'أسعار الصرف',
  Reports: 'التقارير',
  Administration: 'الإدارة',
  Owners: 'المالكون',
  Users: 'المستخدمون',
  Settings: 'الإعدادات',
  Notifications: 'الإشعارات',
  Logout: 'تسجيل الخروج'
}

function t(label: string): string {
  return store.isArabic ? ArabicLabels[label] || label : label
}

const pageTitle = computed(() => t(String(route.meta.title || 'EstateOS')))

async function onLogout(): Promise<void> {
  await store.logout()
  await router.push({ name: 'Login' })
}

async function toggleNotifications(): Promise<void> {
  notificationsOpen.value = !notificationsOpen.value
  if (notificationsOpen.value) await store.fetchNotifications({ limit: 20 })
}

async function markAll(): Promise<void> {
  await store.markAllNotificationsRead()
}

async function openNotification(item: AppNotification): Promise<void> {
  notificationsOpen.value = false
  if (!item.isRead) await store.markNotificationRead(item.id)
  if (item.actionUrl) void router.push(item.actionUrl)
}

function formatNotificationTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(store.isArabic ? 'ar' : 'en')
}

function openSearch(): void {
  searchStore.open()
}

function handleDocumentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.notification-wrap')) notificationsOpen.value = false
}

function handleVisibility(): void {
  if (document.visibilityState === 'visible' && store.isAuthenticated) void store.refreshUnreadNotificationCount()
}

onMounted(() => {
  if (store.isAuthenticated) store.startNotificationPolling()
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('visibilitychange', handleVisibility)
})

watch(() => store.isAuthenticated, (value) => {
  if (value) store.startNotificationPolling()
  else store.stopNotificationPolling()
})

watch(() => route.fullPath, () => { notificationsOpen.value = false })

onBeforeUnmount(() => {
  store.stopNotificationPolling()
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('visibilitychange', handleVisibility)
})
</script>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100vh;
  background: #f4f6fb;
  color: #1f2937;
}
.sidebar {
  width: 244px;
  flex: 0 0 244px;
  background: #111827;
  color: #e5e7eb;
  padding: 1.25rem 0.9rem;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 1.35rem;
  font-weight: 700;
  color: #fff;
  text-decoration: none;
  padding: 0.4rem 0.6rem 1.4rem;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.nav-link {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  color: #cbd5e1;
  text-decoration: none;
  font-size: 0.92rem;
}
.nav-link:hover { background: #1f2937; color: #fff; }
.nav-link.router-link-exact-active { background: #4f46e5; color: #fff; }
.nav-group { display: flex; flex-direction: column; margin-top: 0.8rem; }
.nav-heading {
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
  padding: 0.5rem 0.75rem 0.25rem;
}
.nav-child { padding-inline-start: 1.1rem; font-size: 0.86rem; }
.workspace { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  padding: 0.9rem 1.5rem;
}
.topbar-title { font-size: 1.15rem; font-weight: 650; }
.topbar-actions { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.user-chip { font-size: 0.85rem; color: #4b5563; }
.content { padding: 1.5rem; flex: 1; }
.alert {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 1rem 1.5rem 0;
  padding: 0.75rem 1rem;
  border-radius: 8px;
}
.alert-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.alert button { margin-inline-start: auto; background: none; border: 0; cursor: pointer; font-size: 1.1rem; }
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0.55rem 0.9rem;
  font-size: 0.88rem;
  cursor: pointer;
  text-decoration: none;
}
.btn-ghost { background: #f3f4f6; color: #374151; }
.btn-ghost:hover { background: #e5e7eb; }
.icon-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 999px; border: 1px solid #e5e7eb; background: #fff; color: #374151; cursor: pointer; }
.icon-btn:hover { background: #f9fafb; }
.badge-count { position: absolute; top: -4px; inset-inline-end: -4px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px; background: #dc2626; color: #fff; font-size: 0.68rem; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; }
.notification-wrap { position: relative; }
.notification-panel { position: absolute; top: calc(100% + 8px); inset-inline-end: 0; width: min(360px, calc(100vw - 2rem)); background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 12px 30px rgba(15,23,42,0.12); z-index: 40; overflow: hidden; }
.notification-head { display: flex; justify-content: space-between; align-items: center; padding: 0.7rem 0.9rem; border-bottom: 1px solid #eef2f7; }
.notification-head .link { background: none; border: 0; color: #4f46e5; cursor: pointer; font-size: 0.78rem; }
.notification-empty { padding: 1.2rem; color: #6b7280; font-size: 0.85rem; text-align: center; }
.notification-list { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow-y: auto; }
.notification-list li { border-bottom: 1px solid #f3f4f6; }
.notification-list li.unread { background: #f8faff; }
.notification-list button { width: 100%; text-align: start; background: none; border: 0; padding: 0.7rem 0.9rem; cursor: pointer; display: flex; flex-direction: column; gap: 0.2rem; }
.n-title { font-size: 0.84rem; font-weight: 600; color: #111827; }
.n-message { font-size: 0.78rem; color: #4b5563; line-height: 1.4; }
.n-time { font-size: 0.7rem; color: #6b7280; }
.notification-footer { display: block; text-align: center; padding: 0.7rem; font-size: 0.82rem; color: #4f46e5; text-decoration: none; border-top: 1px solid #eef2f7; }

@media (max-width: 860px) {
  .app-shell { flex-direction: column; }
  .sidebar { width: 100%; flex-basis: auto; }
  .nav { flex-direction: row; flex-wrap: wrap; }
  .nav-group { margin-top: 0; }
  .content { padding: 1rem; }
}
</style>

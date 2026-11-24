<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'الإشعارات' : 'Notifications' }}</h1>
        <p class="muted">{{ store.unreadNotificationCount }} {{ store.isArabic ? 'غير مقروء' : 'unread' }}</p>
      </div>
      <div class="head-actions">
        <label class="category-filter">
          <span>{{ store.isArabic ? 'الفئة' : 'Category' }}</span>
          <select v-model="category" @change="load">
            <option value="">{{ store.isArabic ? 'الكل' : 'All' }}</option>
            <option v-for="item in NOTIFICATION_CATEGORIES" :key="item" :value="item">{{ label(item) }}</option>
          </select>
        </label>
        <label class="toggle"><input v-model="unreadOnly" type="checkbox" @change="load" /> {{ store.isArabic ? 'غير المقروءة فقط' : 'Unread only' }}</label>
        <button class="btn btn-quiet" type="button" @click="markAll" :disabled="!store.unreadNotificationCount">
          {{ store.isArabic ? 'تحديد الكل كمقروء' : 'Mark all as read' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="state">{{ store.isArabic ? 'جارٍ التحميل…' : 'Loading…' }}</div>
    <div v-else-if="!store.notifications.length" class="state">{{ store.isArabic ? 'لا توجد إشعارات.' : 'No notifications.' }}</div>
    <ul v-else class="list">
      <li v-for="item in store.notifications" :key="item.id" :class="{ unread: !item.isRead }">
        <button class="item" type="button" @click="open(item)">
          <div class="item-head">
            <strong>{{ item.title }}</strong>
            <time>{{ formatDate(item.createdAt) }}</time>
          </div>
          <p>{{ item.message }}</p>
          <span class="tag category-tag" :class="`category-${notificationCategoryOf(item.type).toLowerCase()}`">
            {{ label(notificationCategoryOf(item.type)) }}
          </span>
          <span v-if="item.type" class="tag">{{ label(item.type) }}</span>
        </button>
        <button v-if="!item.isRead" class="link" type="button" @click.stop="store.markNotificationRead(item.id)">
          {{ store.isArabic ? 'تحديد كمقروء' : 'Mark read' }}
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStore } from '@/stores'
import type { AppNotification } from '@/types'
import {
  NOTIFICATION_CATEGORIES,
  notificationCategoryOf,
  resolveNotificationTarget,
  type NotificationCategory
} from '@/utils/notificationTargets'

type NotificationWithTarget = AppNotification & { targetUrl?: string | null }

const store = useStore()
const router = useRouter()
const loading = ref(false)
const unreadOnly = ref(false)
const category = ref<'' | NotificationCategory>('')

onMounted(() => { void load() })

async function load(): Promise<void> {
  loading.value = true
  try {
    await store.fetchNotifications({
      limit: 100,
      unread: unreadOnly.value,
      category: category.value || undefined
    })
  } finally {
    loading.value = false
  }
}

async function open(item: AppNotification): Promise<void> {
  if (!item.isRead) await store.markNotificationRead(item.id)
  const notification = item as NotificationWithTarget
  const target = resolveNotificationTarget({
    entityType: notification.entityType,
    entityId: notification.entityId,
    actionUrl: notification.actionUrl,
    targetUrl: notification.targetUrl
  })
  if (target) await router.push(target)
}

async function markAll(): Promise<void> {
  await store.markAllNotificationsRead()
  await load()
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(store.isArabic ? 'ar' : 'en')
}

function label(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
.head-actions { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
h1 { margin: 0; font-size: 1.5rem; }
.muted { color: #6b7280; margin: 0.25rem 0 0; font-size: 0.85rem; }
.toggle { font-size: 0.82rem; color: #374151; display: inline-flex; gap: 0.35rem; align-items: center; }
.category-filter { font-size: 0.82rem; color: #374151; display: inline-flex; gap: 0.35rem; align-items: center; }
.category-filter select { border: 1px solid #d1d5db; border-radius: 7px; padding: 0.35rem 0.5rem; font-size: 0.8rem; }
.category-tag { margin-inline-end: 0.4rem; }
.category-finance { background: #fef3c7; color: #92400e; }
.category-maintenance { background: #fee2e2; color: #991b1b; }
.btn { border: 0; border-radius: 8px; padding: 0.55rem 0.9rem; font-size: 0.85rem; cursor: pointer; }
.btn-quiet { background: #f3f4f6; color: #374151; }
.state { background: #fff; border-radius: 12px; padding: 3rem; text-align: center; color: #6b7280; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.7rem; }
.list li { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 0.8rem 1rem; display: flex; gap: 0.8rem; align-items: flex-start; }
.list li.unread { border-color: #c7d2fe; background: #f8faff; }
.item { flex: 1; text-align: start; background: none; border: 0; padding: 0; cursor: pointer; color: inherit; font: inherit; }
.item-head { display: flex; justify-content: space-between; gap: 0.8rem; align-items: baseline; }
.item-head time { color: #6b7280; font-size: 0.75rem; white-space: nowrap; }
.item p { margin: 0.35rem 0 0.45rem; color: #374151; font-size: 0.88rem; }
.tag { font-size: 0.7rem; background: #eef2ff; color: #3730a3; padding: 0.15rem 0.5rem; border-radius: 999px; }
.link { background: none; border: 0; color: #4f46e5; cursor: pointer; font-size: 0.8rem; white-space: nowrap; }
@media (max-width: 640px) { .item-head { flex-direction: column; } .list li { flex-direction: column; } }
</style>
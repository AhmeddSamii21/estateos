<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ store.isArabic ? 'سجل النشاط' : 'Activity timeline' }}</h1>
        <p class="muted">
          {{ store.isArabic
            ? 'الأحداث المسجلة فعلياً على سجلات العمل في مؤسستك.'
            : 'Persisted events recorded across your organization’s business records.' }}
        </p>
      </div>
    </div>
    <ActivityTimeline :limit="20" />
  </div>
</template>

<script setup lang="ts">
import ActivityTimeline from '@/components/ActivityTimeline.vue'
import { useStore } from '@/stores'

const store = useStore()
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 1rem; }
h1 { margin: 0; font-size: 1.5rem; }
.muted { color: #6b7280; margin: 0.3rem 0 0; font-size: 0.85rem; }
</style>

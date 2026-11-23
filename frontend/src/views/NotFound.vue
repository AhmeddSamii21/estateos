<template>
  <div class="not-found">
    <i class="fas fa-map-signs"></i>
    <h1>404</h1>
    <p>{{ store.isArabic ? 'الصفحة غير موجودة' : 'This page does not exist.' }}</p>
    <router-link to="/">{{ store.isArabic ? 'العودة للوحة التحكم' : 'Back to dashboard' }}</router-link>
  </div>
</template>

<script setup lang="ts">
import { useStore } from '@/stores'
const store = useStore()
</script>

<style scoped>
.not-found { min-height: 100vh; display: grid; place-content: center; text-align: center; gap: 0.5rem; background: #eef2ff; }
h1 { font-size: 3rem; margin: 0; color: #4338ca; }
p { color: #6b7280; }
a { color: #4f46e5; }
i { font-size: 2rem; color: #6366f1; }
</style>

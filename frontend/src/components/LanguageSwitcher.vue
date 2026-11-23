<template>
  <button class="lang-btn" type="button" :title="store.isArabic ? 'Switch to English' : 'التبديل إلى العربية'" @click="store.toggleLanguage()">
    <i class="fas fa-language"></i>
    <span>{{ store.isArabic ? 'EN' : 'العربية' }}</span>
  </button>
</template>

<script setup lang="ts">
import { useStore } from '@/stores'

const store = useStore()
</script>

<style scoped>
.lang-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid #c7d2fe;
  background: #eef2ff;
  color: #3730a3;
  border-radius: 999px;
  padding: 0.4rem 0.8rem;
  font-size: 0.82rem;
  cursor: pointer;
}
.lang-btn:hover { background: #e0e7ff; }
</style>

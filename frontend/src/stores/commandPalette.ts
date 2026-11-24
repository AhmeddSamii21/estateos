import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCommandPaletteStore = defineStore('commandPalette', () => {
  const isOpen = ref(false)

  function open(): void {
    isOpen.value = true
  }

  function close(): void {
    isOpen.value = false
  }

  function toggle(): void {
    isOpen.value = !isOpen.value
  }

  return { isOpen, open, close, toggle }
})

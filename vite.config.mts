import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const src = (p: string) => fileURLToPath(new URL(`./frontend/src/${p}`, import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': src(''),
      '@components': src('components'),
      '@views': src('views'),
      '@assets': src('assets'),
      '@utils': src('utils'),
      '@stores': src('stores'),
      '@locales': src('locales')
    }
  },
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})

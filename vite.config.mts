import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const src = (p: string) => fileURLToPath(new URL(`./frontend/src/${p}`, import.meta.url))

// GitHub Pages serves the site from a repository sub-path. Keep the local
// development base at "/" and switch only for Pages/CI production builds.
const githubPages = process.env.GITHUB_PAGES === 'true' || process.env.CI === 'true'
const base = githubPages ? '/estateos/' : '/'

export default defineConfig({
  base,
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

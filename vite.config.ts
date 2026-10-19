/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'

// GitHub Pages has no SPA rewrites: serving index.html as 404.html makes
// deep links (/rubaka/anime?tab=wishlist) load the app instead of a 404 page.
const spaFallback = (): Plugin => ({
  name: 'rubaka-spa-fallback',
  apply: 'build',
  closeBundle() {
    copyFileSync('dist/index.html', 'dist/404.html')
  },
})

// A machine-wide NODE_ENV=development would make `vite build` bundle React's
// development build (3x larger, slower). Production builds always use production.
if (process.argv.includes('build') && !process.argv.includes('--mode=development')) {
  process.env.NODE_ENV = 'production'
}

// GitHub Pages serves the app from /<repo>/. VITE_BASE_PATH lets CI set it
// while local dev keeps "/".
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), spaFallback()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@supabase')) return 'supabase'
            if (/node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) return 'react'
            if (/node_modules[\\/](zod|react-hook-form|@hookform)[\\/]/.test(id)) return 'forms'
            if (/node_modules[\\/](@radix-ui|radix-ui|@floating-ui|cmdk|sonner)[\\/]/.test(id)) return 'ui'
            if (id.includes('react-markdown') || id.includes('remark') || id.includes('micromark') || id.includes('mdast')) return 'markdown'
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 60000,
  },
})

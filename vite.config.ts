import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
// Config-time only: these never reach the bundle. `define` below substitutes the
// literals, so the app carries the strings and not the manifest.
import { version } from './package.json'
// Resolved from the checkout being built, so a fork's build checks the fork's
// releases and an upstream build checks upstream's. See scripts/repo.mjs.
import { resolveRepo } from './scripts/repo.mjs'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __REPO__: JSON.stringify(resolveRepo()),
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/deepl-proxy': {
        target: 'https://api-free.deepl.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/deepl-proxy/, ''),
      },
      '/deepl-proxy-pro': {
        target: 'https://api.deepl.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/deepl-proxy-pro/, ''),
      },
    },
  },
  preview: {
    proxy: {
      '/deepl-proxy': {
        target: 'https://api-free.deepl.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/deepl-proxy/, ''),
      },
      '/deepl-proxy-pro': {
        target: 'https://api.deepl.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/deepl-proxy-pro/, ''),
      },
    },
  },
})

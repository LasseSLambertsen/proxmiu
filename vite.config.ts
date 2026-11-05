import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { renameSync } from 'node:fs'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'
  return {
  root: 'web',
  base: demo ? '/demo/' : process.env.VITE_BASE || '/',
  publicDir: demo ? false : 'public',
  plugins: [react(), tailwindcss(), ...(demo ? [{ name: 'demo-index', closeBundle() { renameSync(fileURLToPath(new URL('./dist/demo/demo.html', import.meta.url)), fileURLToPath(new URL('./dist/demo/index.html', import.meta.url))) } }] : [])],
  resolve: { alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) } },
  build: { outDir: demo ? '../dist/demo' : '../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 1200, ...(demo ? { rollupOptions: { input: fileURLToPath(new URL('./web/demo.html', import.meta.url)) } } : {}) },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
  },
  }
})

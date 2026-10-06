import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = env.API_PROXY_TARGET || 'http://localhost:3000'

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // vue-i18n esm-bundler feature flags: Composition API only, no devtools in production.
    define: {
      __VUE_I18N_FULL_INSTALL__: true,
      __VUE_I18N_LEGACY_API__: false,
      __INTLIFY_PROD_DEVTOOLS__: false,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.test.ts'],
      setupFiles: ['src/__tests__/i18n.ts'],
    },
    server: {
      port: 5174,
      strictPort: true,
      // Listen on all interfaces so other devices on the LAN (e.g. a phone) can open the app.
      host: true,
      // Mirrors the production nginx /api proxy: same-origin API calls work from any host
      // without CORS, and the refresh cookie path follows the /api prefix.
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          cookiePathRewrite: { '/auth': '/api/auth' },
        },
      },
    },
  }
})

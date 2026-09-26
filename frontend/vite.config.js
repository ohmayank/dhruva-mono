import react from '@vitejs/plugin-react'
import { cwd } from 'node:process'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, cwd(), '')
  const proxy = {
    '/sim/maitri': {
      target: env.SIMULATOR_MAITRI_TARGET || 'http://127.0.0.1:8081',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/sim\/maitri/, ''),
    },
    '/sim/bharti': {
      target: env.SIMULATOR_BHARATI_TARGET || 'http://127.0.0.1:8082',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/sim\/bharti/, ''),
    },
    '/patch': {
      target: env.PATCH_SERVICE_TARGET || 'http://127.0.0.1:18080',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/patch/, ''),
    },
  }
  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  }
})

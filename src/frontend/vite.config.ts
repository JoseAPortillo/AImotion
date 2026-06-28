import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:8001',
      '/generate': 'http://localhost:8001',
      '/results': 'http://localhost:8001',
      '/prompt': 'http://localhost:8001',
    },
  },
})

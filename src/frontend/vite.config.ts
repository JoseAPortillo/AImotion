import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:8000',
      '/generate': 'http://localhost:8000',
      '/results': 'http://localhost:8000',
      '/prompt': 'http://localhost:8000',
    },
  },
})

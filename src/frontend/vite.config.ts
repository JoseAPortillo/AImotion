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
      '/models': 'http://localhost:8001',
      '/hardware': 'http://localhost:8001',
      '/credentials': 'http://localhost:8001',
      '/credits': 'http://localhost:8001',
      '/transformers': 'http://localhost:8001',
      '/vlm': 'http://localhost:8001',
      '/llm': 'http://localhost:8001',
    },
  },
})

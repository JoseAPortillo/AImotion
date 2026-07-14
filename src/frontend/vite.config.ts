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
      '/models': 'http://localhost:8000',
      '/hardware': 'http://localhost:8000',
      '/credentials': 'http://localhost:8000',
      '/credits': 'http://localhost:8000',
      '/transformers': 'http://localhost:8000',
      '/vlm': 'http://localhost:8000',
      '/llm': 'http://localhost:8000',
    },
  },
})

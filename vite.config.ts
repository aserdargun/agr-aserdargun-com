import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: { include: ['tests/**/*.test.{ts,mjs}'] },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes('@dimforge')
            ? 'physics'
            : /node_modules\/(three|@react-three|three-stdlib)/.test(id)
              ? 'three'
              : undefined,
      },
    },
  },
})

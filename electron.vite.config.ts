import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { thirdPartyNotices } from './scripts/thirdPartyNotices'

export default defineConfig({
  main: {
    // dependencies は実行時に node_modules から require する（配布物にも入る）。それ以外は
    // バンドルに含める。
    plugins: [externalizeDepsPlugin(), thirdPartyNotices()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), thirdPartyNotices()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          'project-manager': resolve(__dirname, 'src/renderer/project-manager.html'),
          'main-window': resolve(__dirname, 'src/renderer/main-window.html'),
          'print-preview': resolve(__dirname, 'src/renderer/print-preview.html')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer')
      }
    },
    plugins: [react(), tailwindcss(), thirdPartyNotices()]
  }
})

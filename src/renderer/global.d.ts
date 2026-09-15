import type { RendererApi } from '@shared/ipc'

declare global {
  interface Window {
    shovel: RendererApi
  }
}

export {}

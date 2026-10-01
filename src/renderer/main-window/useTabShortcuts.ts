import { useEffect } from 'react'

/**
 * タブ切り替えショートカット（macOS は Cmd、それ以外は Ctrl + 0〜9）。
 * 1〜9キーで1〜9番目のタブ、0キーで10番目のタブへ。
 */
export function useTabSwitchShortcuts(tabIds: readonly string[], onSelect: (id: string) => void): void {
  useEffect(() => {
    const isMac = window.shovel.platform === 'darwin'

    function handleKeyDown(event: KeyboardEvent): void {
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey
      if (!modifierPressed || event.altKey || event.shiftKey) return
      if (event.key.length !== 1 || event.key < '0' || event.key > '9') return

      const index = event.key === '0' ? 9 : Number(event.key) - 1
      const id = tabIds[index]
      if (!id) return

      event.preventDefault()
      onSelect(id)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tabIds, onSelect])
}

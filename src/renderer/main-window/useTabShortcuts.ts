import { useEffect } from 'react'

/**
 * ui.md §3 / decisions.md G-1-3b: タブ切り替えショートカットは
 * 「修飾キー + 0〜9」（修飾キーは macOS が Cmd、それ以外は Ctrl）。
 * タブ最大数が10なのは、この0〜9の10個の数字キーに1対1で割り当てるための
 * 制約から導かれている。1〜9キーで1〜9番目のタブ、0キーで10番目のタブへ。
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

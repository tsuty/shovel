import { useEffect } from 'react'

/** 入力欄・エディタ（contenteditable を含む）にフォーカスがあるか。 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select') !== null
}

/**
 * タブ切り替えショートカット（macOS は Cmd、それ以外は Ctrl）。
 * 1〜9キーで1〜9番目のタブ、0キーで10番目のタブへ。
 * ←/→ で左右隣のタブへ（端では反対側の端へ）。入力欄にフォーカスがあるときは何もしない。
 */
export function useTabSwitchShortcuts(
  tabIds: readonly string[],
  activeId: string | null,
  onSelect: (id: string) => void
): void {
  useEffect(() => {
    const isMac = window.shovel.platform === 'darwin'

    function handleKeyDown(event: KeyboardEvent): void {
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey
      if (!modifierPressed || event.altKey || event.shiftKey) return

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (event.defaultPrevented || isEditableTarget(event.target)) return
        if (tabIds.length < 2) return
        const current = activeId === null ? -1 : tabIds.indexOf(activeId)
        const step = event.key === 'ArrowLeft' ? -1 : 1
        const id = tabIds[current === -1 ? 0 : (current + step + tabIds.length) % tabIds.length]
        if (!id) return

        event.preventDefault()
        onSelect(id)
        return
      }

      if (event.key.length !== 1 || event.key < '0' || event.key > '9') return

      const index = event.key === '0' ? 9 : Number(event.key) - 1
      const id = tabIds[index]
      if (!id) return

      event.preventDefault()
      onSelect(id)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tabIds, activeId, onSelect])
}

import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { resolveLocale } from '../locale'

const labels = {
  en: {
    noSuggestions: 'No spelling suggestions',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All'
  },
  ja: {
    noSuggestions: 'スペルの候補はありません',
    undo: '元に戻す',
    redo: 'やり直す',
    cut: '切り取り',
    copy: 'コピー',
    paste: '貼り付け',
    selectAll: 'すべて選択'
  }
} as const

/**
 * 入力欄・エディタ（編集できる場所）を右クリックしたときに OS 標準のメニューを出す。
 * スペルミスの上なら、先頭に候補を並べる。編集できない場所では何も出さない。
 */
export function installEditContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return
    const t = labels[resolveLocale()]
    const flags = params.editFlags
    const template: MenuItemConstructorOptions[] = []
    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length === 0) {
        template.push({ label: t.noSuggestions, enabled: false })
      }
      for (const suggestion of params.dictionarySuggestions) {
        template.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) })
      }
      template.push({ type: 'separator' })
    }
    template.push(
      { role: 'undo', label: t.undo, enabled: flags.canUndo },
      { role: 'redo', label: t.redo, enabled: flags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: t.cut, enabled: flags.canCut },
      { role: 'copy', label: t.copy, enabled: flags.canCopy },
      { role: 'paste', label: t.paste, enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: t.selectAll, enabled: flags.canSelectAll }
    )
    Menu.buildFromTemplate(template).popup({ window: win })
  })
}

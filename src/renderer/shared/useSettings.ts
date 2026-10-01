import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types/settings'
import i18n from './i18n'

/**
 * ui.md §13/§14: テーマ・文字サイズ・言語。プロジェクトマネージャとメイン
 * ウィンドウの両方（別々の renderer プロセス）から使うため共有フックにする。
 * テーマは DOM に `dark` クラスを付け外しするだけで、DOM は作り直さない
 * （ui.md §13「テーマや文字サイズの変更では DOM を作り直さない」）。
 */
export function useSettings(): {
  settings: AppSettings | null
  update: (patch: Partial<AppSettings>) => Promise<void>
} {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    void window.shovel.settings.get().then(setSettings)
    return window.shovel.settings.onChanged(setSettings)
  }, [])

  useEffect(() => {
    if (!settings) return
    applyTheme(settings.theme)
    void i18n.changeLanguage(settings.locale ?? navigatorLocale())
    document.documentElement.style.setProperty('--transcript-font-size', `${settings.transcriptFontSize}px`)
  }, [settings])

  async function update(patch: Partial<AppSettings>): Promise<void> {
    const next = await window.shovel.settings.update(patch)
    setSettings(next)
  }

  return { settings, update }
}

function navigatorLocale(): 'en' | 'ja' {
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

function applyTheme(theme: AppSettings['theme']): void {
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

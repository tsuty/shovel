import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types/settings'
import { fontFamilyPrefix } from '@shared/fontFamily'
import i18n from './i18n'

/** 文字サイズ・書体の CSS 変数を書き換えた後に `window` へ送るイベント（CodeMirror が測り直す）。 */
export const FONT_SETTINGS_APPLIED_EVENT = 'shovel:font-settings-applied'

/**
 * テーマ・文字サイズ・言語の設定を読み、DOM に反映する共有フック。
 * テーマは DOM に `dark` クラスを付け外しする。`followTheme: false` ならテーマは常にライト（印刷用表示）。
 */
export function useSettings({ followTheme = true }: { followTheme?: boolean } = {}): {
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
    if (followTheme) applyTheme(settings.theme)
    void i18n.changeLanguage(settings.locale ?? navigatorLocale())
    document.documentElement.style.setProperty('--transcript-font-size', `${settings.transcriptFontSize}px`)
    document.documentElement.style.setProperty('--editor-font-size', `${settings.editorFontSize}px`)
    setFontFamilyVariable('--editor-font-family', settings.editorFontFamily)
    setFontFamilyVariable('--preview-font-family', settings.previewFontFamily)
    window.dispatchEvent(new Event(FONT_SETTINGS_APPLIED_EVENT))
  }, [settings, followTheme])

  async function update(patch: Partial<AppSettings>): Promise<void> {
    const next = await window.shovel.settings.update(patch)
    setSettings(next)
  }

  return { settings, update }
}

/**
 * 書体の CSS 変数に `"名前",` を入れる。globals.css 側で既定の並びの前に置くので、
 * そのフォントに無い文字は既定の書体で表示される。既定（`null`）なら変数を外す。
 */
function setFontFamilyVariable(name: string, family: string | null): void {
  const prefix = fontFamilyPrefix(family)
  if (prefix === null) document.documentElement.style.removeProperty(name)
  else document.documentElement.style.setProperty(name, prefix)
}

function navigatorLocale(): 'en' | 'ja' {
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

function applyTheme(theme: AppSettings['theme']): void {
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

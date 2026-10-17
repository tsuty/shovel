import { app } from 'electron'
import { settingsStore } from './persistence/store'

/** main が出す文言の言語。renderer と同じく、設定が無ければ OS の言語から決める。 */
export function resolveLocale(): 'en' | 'ja' {
  const locale = settingsStore.get().locale
  if (locale) return locale
  return app.getLocale().toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ja from './locales/ja.json'

/**
 * ui.md §14 / decisions.md F-5: 英語と日本語。初期値は OS のロケールから決める。
 * `app.getLocale()`（main 側）を IPC で取りに行くほどではないため、renderer の
 * `navigator.language` を初期値の推定に使う。設定画面からの明示的な切り替えは
 * 別フェーズで実装する。
 */
const detected = navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ja: { translation: ja } },
  lng: detected,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n

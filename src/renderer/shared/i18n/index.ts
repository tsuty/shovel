import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ja from './locales/ja.json'

/** 英語と日本語。初期値は `navigator.language` から決める。 */
const detected = navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ja: { translation: ja } },
  lng: detected,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n

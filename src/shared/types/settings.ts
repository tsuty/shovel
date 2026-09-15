/** ui.md §13 / §14: テーマ・文字サイズ・i18n・自動添付の設定。 */
export interface AppSettings {
  locale: 'en' | 'ja' | null
  theme: 'light' | 'dark' | 'system'
  autoAttachActiveFile: boolean
  transcriptFontSize: number
}

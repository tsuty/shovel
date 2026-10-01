/** ui.md §13 / §14: テーマ・文字サイズ・i18n・自動添付の設定。 */
export interface AppSettings {
  locale: 'en' | 'ja' | null
  theme: 'light' | 'dark' | 'system'
  autoAttachActiveFile: boolean
  transcriptFontSize: number
  /**
   * プロンプト入力欄の送信キー。`enter`: Enter で送信・Shift+Enter で改行（既定）。
   * `modEnter`: Cmd/Ctrl+Enter で送信・Enter で改行。対象はプロンプトだけ。
   */
  sendKey: 'enter' | 'modEnter'
}

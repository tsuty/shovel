/** テーマ・文字サイズ・言語・自動添付などの設定。 */
export interface AppSettings {
  locale: 'en' | 'ja' | null
  theme: 'light' | 'dark' | 'system'
  autoAttachActiveFile: boolean
  transcriptFontSize: number
  /** ファイルのビューア・Markdown エディタ（ソース/プレビュー）・差分表示の文字サイズ（px）。 */
  editorFontSize: number
  /**
   * プロンプト入力欄の送信キー。`enter`: Enter で送信・Shift+Enter で改行（既定）。
   * `modEnter`: Cmd/Ctrl+Enter で送信・Enter で改行。対象はプロンプトだけ。
   */
  sendKey: 'enter' | 'modEnter'
  /**
   * Diff ビューの既定の表示。`split`: 左右2列（Side by Side、既定）。`unified`: 1列。
   * Diff ビュー内のトグルでは、そのとき開いている間だけ切り替わる。
   */
  diffLayout: DiffLayout
}

export type DiffLayout = 'split' | 'unified'

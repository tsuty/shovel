import { useMemo } from 'react'
import { withLinksInNewWindow } from '../lib/htmlPreview'

/**
 * HTML ファイルのプレビュー。`sandbox="allow-popups"` の iframe に `srcdoc` で流し込むので、スクリプト・フォーム・
 * 親ウィンドウへの遷移は動かず、アプリ本体とは別の origin になる。CSP は親ページのものを引き継ぐため、
 * 外部の画像や CSS は読み込まれない。リンクは新しいウィンドウとして開かせ、`setWindowOpenHandler` が
 * http(s) / mailto だけを外部ブラウザへ渡す。
 */
export function HtmlPreview({ html, title }: { html: string; title: string }): React.JSX.Element {
  const srcDoc = useMemo(() => withLinksInNewWindow(html), [html])
  return (
    <iframe sandbox="allow-popups" srcDoc={srcDoc} title={title} className="block h-full w-full border-0 bg-white" />
  )
}

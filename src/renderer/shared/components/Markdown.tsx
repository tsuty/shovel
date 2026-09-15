import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * decisions.md D-5: Markdown エディタのプレビューとトランスクリプトは
 * 同じレンダラ（`react-markdown` + `remark-gfm`）を共有する。
 * N-1: スキームの無い URL は href を落とす（相対パスをリンクにすると
 * `file://` を踏んで壊れる事故を防ぐ）。
 */
function safeUriTransformer(uri: string): string {
  if (/^(https?:|mailto:)/i.test(uri)) return uri
  return ''
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUriTransformer}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

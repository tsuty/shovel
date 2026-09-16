import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'

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

/**
 * reference/TRANSCRIPT_WEBVIEW.md「コピー用ボタンは pre の中ではなく、
 * それを包むラッパーの上に載せる」: pre は横スクロールするため、中に
 * 置くとボタンがコードと一緒に流れてしまう。
 */
function CodeBlock(props: React.ComponentPropsWithoutRef<'pre'>): React.JSX.Element {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  function copy(): void {
    void navigator.clipboard.writeText(preRef.current?.textContent ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="group/code relative">
      <pre ref={preRef} {...props} />
      <button
        className="absolute right-1.5 top-1.5 rounded bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/code:opacity-100"
        onClick={copy}
        aria-label="Copy code"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  )
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUriTransformer} components={{ pre: CodeBlock }}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

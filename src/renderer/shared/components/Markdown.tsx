import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MermaidDialog } from './MermaidDialog'
import { MERMAID_BRAND_COLOR, MermaidIcon } from './icons/MermaidIcon'
import { highlightToHtml, langFromFence } from '../lib/shiki'
import { cn } from '../lib/utils'

/**
 * Markdown エディタのプレビューとトランスクリプト共通のレンダラ（`react-markdown` + `remark-gfm`）。
 *
 * `http(s)` / `mailto` は外部で開き、プロジェクト内の相対パスは `onOpenFileLink` で開く。
 * それ以外（`file://`・絶対パス・未知のスキーム）はリンクにせず、文字として見せる。
 */
const EXTERNAL_LINK = /^(https?:|mailto:)/i

/** スキームを持たない相対パス（`#` だけのページ内リンク・`//host`・`/abs` は除く）。 */
function asProjectRelativePath(href: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('/')) return null
  // `foo.ts:12` / `foo.ts#L12` の行指定とクエリを、スキームの判定より先に落とす。
  const pathPart = href.replace(/[?#].*$/, '').replace(/:\d+(?::\d+)?$/, '')
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathPart)) return null
  const normalized = pathPart.replace(/^\.\//, '')
  if (!normalized || normalized.split('/').includes('..')) return null
  try {
    return decodeURIComponent(normalized)
  } catch {
    return normalized
  }
}

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

function hastText(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

/** フェンスの言語（`language-ts` の `ts`）。指定が無ければ null。 */
function fenceLanguage(code: HastNode | undefined): string | null {
  const className = code?.properties?.className
  const classes = Array.isArray(className) ? className.map(String) : []
  const lang = classes.find((c) => c.startsWith('language-'))
  return lang ? lang.slice('language-'.length) : null
}

/**
 * コードブロック。コピー用ボタンは横スクロールする pre ではなく、それを包むラッパーの上に載せる。
 * 言語の指定があるフェンスは shiki で非同期にハイライトし、終わるまでは素のコードを見せる。
 */
/** これより長いコードブロックは、トランスクリプトでは最初の数行だけを見せて畳む。 */
const COLLAPSED_LINES = 5

/** 要素を内側に持つ、いちばん近い縦スクロールの祖先。 */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let cur = el?.parentElement ?? null; cur; cur = cur.parentElement) {
    const overflowY = getComputedStyle(cur).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur
  }
  return null
}

function CodeBlock({
  node,
  collapsible = false,
  ...props
}: React.ComponentPropsWithoutRef<'pre'> & { node?: HastNode; collapsible?: boolean }): React.JSX.Element {
  const code = node?.children?.find((c) => c.type === 'element' && c.tagName === 'code')
  const text = hastText(code).replace(/\n$/, '')
  const lang = fenceLanguage(code)
  const { t } = useTranslation()
  const isMermaid = lang?.toLowerCase() === 'mermaid'
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [diagramOpen, setDiagramOpen] = useState(false)

  const lineCount = text.split('\n').length
  const foldable = collapsible && lineCount > COLLAPSED_LINES
  const [expanded, setExpanded] = useState(false)
  const folded = foldable && !expanded
  const clipRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  /** 畳んだときの高さ（px）。行の高さは文字サイズの設定で変わるので実測する。 */
  const [foldedHeight, setFoldedHeight] = useState<number | null>(null)
  /** 開閉の直前のトグルの画面上の位置。開閉後にこの位置へ戻す。 */
  const toggleTopRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (!foldable) return
    const pre = clipRef.current?.querySelector('pre')
    if (!pre) return
    const measure = (): void => {
      // 描画された高さを行数で割って実際の行送りを求める。
      const style = getComputedStyle(pre)
      const paddingTop = parseFloat(style.paddingTop)
      const contentHeight = pre.scrollHeight - paddingTop - parseFloat(style.paddingBottom)
      const lineHeight = contentHeight / lineCount
      // 5行を見せ、6行目の上端だけを下端のフェードに覗かせる。
      setFoldedHeight(Math.round(paddingTop + lineHeight * (COLLAPSED_LINES + 0.5)))
    }
    measure()
    // 文字サイズの設定を変えると pre の高さが変わるので、測り直す。
    const observer = new ResizeObserver(measure)
    observer.observe(pre)
    return () => observer.disconnect()
  }, [foldable, html, lineCount])

  useLayoutEffect(() => {
    const prevTop = toggleTopRef.current
    toggleTopRef.current = null
    const toggle = toggleRef.current
    if (prevTop === null || !toggle) return
    const container = scrollParent(toggle)
    if (container) container.scrollTop += toggle.getBoundingClientRect().top - prevTop
  }, [expanded])

  function toggleExpanded(): void {
    toggleTopRef.current = toggleRef.current?.getBoundingClientRect().top ?? null
    setExpanded((v) => !v)
  }

  useEffect(() => {
    // mermaid はコードのまま見せ、図はボタンから開くポップアップで描く。
    if (!lang || isMermaid) return
    let cancelled = false
    void highlightToHtml(text, langFromFence(lang))
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
      .catch(() => {
        // ハイライトできなければ素のコードのままにする。
      })
    return () => {
      cancelled = true
    }
  }, [text, lang, isMermaid])

  function copy(): void {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    // 畳めるブロックは pre の上下マージンを外側へ移す。
    <div className={cn('group/code relative', foldable && 'my-[0.5em]')}>
      <div
        ref={clipRef}
        className={cn('relative', foldable && '[&_pre]:!my-0', folded && 'overflow-hidden rounded-md')}
        style={folded && foldedHeight !== null ? { maxHeight: foldedHeight } : undefined}
      >
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          // mermaid はボタンを左上に重ねるので、その分だけコードを下げる。
          <pre {...props} className={cn(props.className, isMermaid && '!pt-11')} />
        )}
        {folded && (
          // 続きがあることを、下端を地の色へ溶かして示す。
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-muted to-transparent" />
        )}
      </div>
      {foldable && (
        <button
          ref={toggleRef}
          className="mt-1 flex items-center gap-1 font-sans text-transcript-xs text-muted-foreground hover:text-foreground"
          onClick={toggleExpanded}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? t('codeBlock.collapse') : t('codeBlock.expand', { count: lineCount })}
        </button>
      )}
      {isMermaid && (
        // 図を開くボタンは常に表示する。
        <button
          className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md px-2.5 py-1 font-sans text-xs font-medium text-white shadow-sm hover:brightness-110"
          style={{ backgroundColor: MERMAID_BRAND_COLOR }}
          onClick={() => setDiagramOpen(true)}
        >
          <MermaidIcon size={14} />
          {t('mermaid.show')}
        </button>
      )}
      <div className="absolute right-1.5 top-1.5 flex gap-1">
        <button
          className="rounded bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/code:opacity-100"
          onClick={copy}
          aria-label="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      {isMermaid && <MermaidDialog code={text} open={diagramOpen} onOpenChange={setDiagramOpen} />}
    </div>
  )
}

function MarkdownLink({
  href,
  children,
  onOpenFileLink
}: {
  href?: string
  children?: React.ReactNode
  onOpenFileLink?: (relPath: string) => void
}): React.JSX.Element {
  const target = href ?? ''
  if (EXTERNAL_LINK.test(target)) {
    return (
      <a
        href={target}
        title={target}
        onClick={(e) => {
          e.preventDefault()
          // main の setWindowOpenHandler が外部ブラウザ（mailto はメーラー）へ渡す。
          window.open(target, '_blank', 'noopener')
        }}
      >
        {children}
      </a>
    )
  }
  const relPath = onOpenFileLink ? asProjectRelativePath(target) : null
  if (relPath && onOpenFileLink) {
    // href を持たせない。
    return (
      <button type="button" className="markdown-file-link" title={relPath} onClick={() => onOpenFileLink(relPath)}>
        {children}
      </button>
    )
  }
  return (
    <span className="markdown-dead-link" title={target || undefined}>
      {children}
    </span>
  )
}

export function Markdown({
  text,
  className = 'text-sm',
  onOpenFileLink,
  collapseCodeBlocks = false
}: {
  text: string
  className?: string
  /** プロジェクト内の相対パスへのリンクを開く。渡さなければ相対パスはリンクにしない。 */
  onOpenFileLink?: (relPath: string) => void
  /** 長いコードブロックを畳む（トランスクリプト用。エディタのプレビューでは畳まない）。 */
  collapseCodeBlocks?: boolean
}): React.JSX.Element {
  return (
    <div className={`markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // リンクの判定は MarkdownLink で行うので href は素通しにする。画像の src などは既定の無害化のまま。
        urlTransform={(uri, key) => (key === 'href' ? uri : defaultUrlTransform(uri))}
        components={{
          pre: ({ node, ...props }) => (
            <CodeBlock node={node as HastNode | undefined} collapsible={collapseCodeBlocks} {...props} />
          ),
          a: ({ href, children }) => (
            <MarkdownLink href={href} onOpenFileLink={onOpenFileLink}>
              {children}
            </MarkdownLink>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

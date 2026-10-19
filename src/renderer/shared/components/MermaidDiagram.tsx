import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renderMermaid } from '../lib/mermaid'
import { usePendingRender } from '../lib/renderTracker'

/** `<html>` の `dark` クラス（useSettings の applyTheme が付け外しする）を追う。 */
function useDarkClass(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(root.classList.contains('dark')))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/**
 * Mermaid のコードを SVG 文字列にする。テーマが切り替わったら描き直す。
 * 描いている間は `svg` も `error` も null。文法エラーなら `error` にメッセージが入る。
 * `mermaid.render` は body 直下の一時要素で寸法を測るので、非表示のタブで描いても崩れない。
 */
export function useMermaidSvg(code: string): { svg: string | null; error: string | null } {
  const dark = useDarkClass()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  usePendingRender(svg === null && error === null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    renderMermaid(code, dark).then(
      (result) => {
        if (!cancelled) setSvg(result)
      },
      (err: unknown) => {
        if (!cancelled) {
          setSvg(null)
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [code, dark])

  return { svg, error }
}

/** 文法エラーのときに出す、エラー内容と元のコード。 */
export function MermaidError({ error, code }: { error: string; code: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-destructive">{t('mermaid.error')}</p>
      <pre className="whitespace-pre-wrap rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</pre>
      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{code}</pre>
    </div>
  )
}

/**
 * Mermaid のコードを、幅に収まるよう縮めた図にして見せる（印刷用表示）。
 * 拡大・縮小・移動ができる表示は `MermaidViewer`。
 */
export function MermaidDiagram({ code }: { code: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { svg, error } = useMermaidSvg(code)

  if (error) return <MermaidError error={error} code={code} />
  if (!svg) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
  // mermaid が securityLevel: 'strict' で生成した SVG（スクリプト・生 HTML は含まない）。
  return <div className="flex justify-center [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
}

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renderMermaid } from '../lib/mermaid'

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
 * Mermaid のコードを図にして見せる（ポップアップと .mmd / .mermaid のタブで共通）。
 * テーマが切り替わったら描き直す。文法エラーはエラー内容と元のコードを出す。
 * `mermaid.render` は body 直下の一時要素で寸法を測るので、非表示のタブで描いても崩れない。
 */
export function MermaidDiagram({ code }: { code: string }): React.JSX.Element {
  const { t } = useTranslation()
  const dark = useDarkClass()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  if (error) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-destructive">{t('mermaid.error')}</p>
        <pre className="whitespace-pre-wrap rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</pre>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{code}</pre>
      </div>
    )
  }
  if (!svg) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
  // mermaid が securityLevel: 'strict' で生成した SVG（スクリプト・生 HTML は含まない）。
  return <div className="flex justify-center [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
}

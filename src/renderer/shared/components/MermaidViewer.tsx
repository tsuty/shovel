import { useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { parseViewBox, type Size } from '../lib/zoom'
import { MermaidError, useMermaidSvg } from './MermaidDiagram'
import { ZoomableView } from './ZoomableView'

/**
 * Mermaid の図を、拡大・縮小・移動の操作つきで見せる（.mmd / .mermaid のプレビューとポップアップ）。
 * 最初は幅に合わせる。描き直しても拡大率とスクロール位置は保つ（文法エラーの間も保つ）。
 */
export function MermaidViewer({ code, className }: { code: string; className?: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { svg, error } = useMermaidSvg(code)
  const hostRef = useRef<HTMLDivElement>(null)

  /** 差し込む SVG 要素と、その本来の寸法。 */
  const parsed = useMemo((): { element: SVGSVGElement; natural: Size } | null => {
    if (!svg) return null
    const template = document.createElement('template')
    // mermaid が securityLevel: 'strict' で生成した SVG（スクリプト・生 HTML は含まない）。
    template.innerHTML = svg
    const element = template.content.querySelector('svg')
    const natural = parseViewBox(element?.getAttribute('viewBox') ?? null)
    if (!element || !natural) return null
    element.setAttribute('width', '100%')
    element.setAttribute('height', '100%')
    element.style.maxWidth = 'none'
    element.style.display = 'block'
    return { element, natural }
  }, [svg])

  useLayoutEffect(() => {
    if (parsed) hostRef.current?.replaceChildren(parsed.element)
  }, [parsed])

  return (
    <ZoomableView
      natural={parsed?.natural ?? null}
      initialMode="fitWidth"
      className={className}
      placeholder={
        error ? (
          <MermaidError error={error} code={code} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )
      }
    >
      <div ref={hostRef} className="h-full w-full" />
    </ZoomableView>
  )
}

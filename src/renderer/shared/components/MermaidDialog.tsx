import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { renderMermaid } from '../lib/mermaid'

/**
 * ```mermaid ブロックの図をポップアップで見せる。開くたびに、その時点のテーマで描き直す。
 * 文法エラーはエラー内容と元のコードを出す。
 */
export function MermaidDialog({
  code,
  open,
  onOpenChange
}: {
  code: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSvg(null)
    setError(null)
    const dark = document.documentElement.classList.contains('dark')
    renderMermaid(code, dark).then(
      (result) => {
        if (!cancelled) setSvg(result)
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    )
    return () => {
      cancelled = true
    }
  }, [open, code])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-[90vw] flex-col sm:max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>{t('mermaid.title')}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-destructive">{t('mermaid.error')}</p>
              <pre className="whitespace-pre-wrap rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</pre>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{code}</pre>
            </div>
          ) : svg ? (
            // mermaid が securityLevel: 'strict' で生成した SVG（スクリプト・生 HTML は含まない）。
            <div className="flex justify-center [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

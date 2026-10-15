import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Printer, RotateCw } from 'lucide-react'
import { Markdown } from '../shared/components/Markdown'
import { Button } from '../shared/components/ui/button'
import { RenderTrackerContext, type RenderTracker } from '../shared/lib/renderTracker'
import { useSettings } from '../shared/useSettings'

type Content = { kind: 'loading' } | { kind: 'text'; text: string } | { kind: 'unreadable' }

/** Markdown の印刷用表示。開いた時点のディスクの内容を、```mermaid を図として埋め込んで描く。 */
export function App(): React.JSX.Element {
  const { t } = useTranslation()
  // 言語の設定だけを使う。テーマは追わない。
  useSettings({ followTheme: false })
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const projectId = params.get('projectId') ?? ''
  const relPath = params.get('relPath') ?? ''
  const fileName = relPath.split('/').pop() ?? relPath

  const [content, setContent] = useState<Content>({ kind: 'loading' })
  const [loadCount, setLoadCount] = useState(0)
  const [pending, setPending] = useState(0)
  const [printing, setPrinting] = useState(false)

  const tracker = useMemo<RenderTracker>(
    () => ({
      begin() {
        setPending((n) => n + 1)
        let done = false
        return () => {
          if (done) return
          done = true
          setPending((n) => n - 1)
        }
      }
    }),
    []
  )

  useEffect(() => {
    document.title = t('printPreview.windowTitle', { name: fileName })
  }, [t, fileName])

  useEffect(() => {
    let cancelled = false
    setContent({ kind: 'loading' })
    void window.shovel.fs.readFile(projectId, relPath).then(
      (result) => {
        if (cancelled) return
        setContent(result.kind === 'text' ? { kind: 'text', text: result.content } : { kind: 'unreadable' })
      },
      () => {
        if (!cancelled) setContent({ kind: 'unreadable' })
      }
    )
    return () => {
      cancelled = true
    }
  }, [projectId, relPath, loadCount])

  const ready = content.kind === 'text' && pending === 0

  const print = useCallback(async (): Promise<void> => {
    setPrinting(true)
    try {
      await window.shovel.print.run()
    } finally {
      setPrinting(false)
    }
  }, [])

  return (
    <div className="min-h-screen bg-muted print:bg-white">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-3 py-1.5 print:hidden">
        <span className="truncate text-sm font-medium" title={relPath}>
          {fileName}
        </span>
        <div className="flex-1" />
        {content.kind === 'text' && !ready && (
          <span className="text-xs text-muted-foreground">{t('printPreview.preparing')}</span>
        )}
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setLoadCount((n) => n + 1)}>
          <RotateCw size={14} />
          {t('printPreview.reload')}
        </Button>
        <Button size="sm" className="gap-1.5" disabled={!ready || printing} onClick={() => void print()}>
          <Printer size={14} />
          {t('printPreview.print')}
        </Button>
      </div>
      {/* 画面では用紙（A4 幅）に見立てて描く。印刷時の余白は @page に任せる。 */}
      <div className="print-document mx-auto my-6 max-w-[210mm] bg-white p-[15mm] text-black shadow-md print:m-0 print:max-w-none print:p-0 print:shadow-none">
        {content.kind === 'loading' && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
        {content.kind === 'unreadable' && <p className="text-sm text-muted-foreground">{t('printPreview.unreadable')}</p>}
        {content.kind === 'text' && (
          <RenderTrackerContext.Provider value={tracker}>
            <Markdown key={loadCount} text={content.text} className="text-[10.5pt]" forPrint allowDetails />
          </RenderTrackerContext.Provider>
        )}
      </div>
    </div>
  )
}

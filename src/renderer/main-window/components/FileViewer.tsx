import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import type { FileReadResult } from '@shared/types/filer'
import { highlightToHtml, langFromFilename } from '../../shared/lib/shiki'
import { Button } from '../../shared/components/ui/button'
import { FileStatusBar } from './FileStatusBar'

type ViewState =
  | { kind: 'loading' }
  | { kind: 'text'; html: string; file: Extract<FileReadResult, { kind: 'text' }> }
  | { kind: 'image'; dataUrl: string }
  | { kind: 'binary' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

/**
 * ui.md §9 / decisions.md N-3-1: Markdown 以外のテキストはアプリ内で閲覧のみ。
 * shiki でハイライトし行番号を付ける。編集はできない。画像はアプリ内で
 * プレビューし、それ以外のバイナリは確認のうえ OS の関連付けアプリで開く
 * （勝手には開かない）。
 */
export function FileViewer({ projectId, relPath }: { projectId: string; relPath: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [view, setView] = useState<ViewState>({ kind: 'loading' })
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setView({ kind: 'loading' })
    setOpenError(null)
    void (async () => {
      try {
        const result = await window.shovel.fs.readFile(projectId, relPath)
        if (result.kind !== 'text') {
          if (!cancelled) setView(result)
          return
        }
        const html = await highlightToHtml(result.content, langFromFilename(relPath))
        if (!cancelled) setView({ kind: 'text', html, file: result })
      } catch (err) {
        if (!cancelled) setView({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, relPath])

  async function openInOS(): Promise<void> {
    setOpenError(null)
    try {
      await window.shovel.fs.openInOS(projectId, relPath)
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err))
    }
  }

  switch (view.kind) {
    case 'loading':
      return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
    case 'missing':
      return <div className="p-4 text-sm text-muted-foreground">{t('filer.fileDeleted')}</div>
    case 'error':
      return (
        <div className="p-4 text-sm text-destructive">
          {t('filer.viewerError')}
          <div className="mt-1 text-xs text-muted-foreground">{view.message}</div>
        </div>
      )
    case 'binary':
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-sm text-muted-foreground">
          <p>{t('filer.noPreview')}</p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void openInOS()}>
            <ExternalLink size={14} />
            {t('filer.openWithDefaultApp')}
          </Button>
          {openError && <p className="text-xs text-destructive">{openError}</p>}
        </div>
      )
    case 'image':
      return (
        <div className="flex flex-1 items-center justify-center overflow-auto p-4">
          <img src={view.dataUrl} alt={relPath} className="max-h-full max-w-full object-contain" />
        </div>
      )
    case 'text':
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-2">
            <div className="shiki-lines text-sm" dangerouslySetInnerHTML={{ __html: view.html }} />
          </div>
          <FileStatusBar size={view.file.size} encoding={view.file.encoding} lineEnding={view.file.lineEnding} />
        </div>
      )
  }
}

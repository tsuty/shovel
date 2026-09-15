import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { highlightToHtml, langFromFilename } from '../../shared/lib/shiki'

/**
 * ui.md §9 / decisions.md N-3-1: Markdown 以外のテキストはアプリ内で閲覧のみ。
 * shiki でハイライトし行番号を付ける。編集はできない。
 */
export function FileViewer({ projectId, relPath }: { projectId: string; relPath: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [html, setHtml] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    setMissing(false)
    void window.shovel.fs.readFile(projectId, relPath).then(async (result) => {
      if (cancelled) return
      if (result.kind === 'missing') {
        setMissing(true)
        return
      }
      if (result.kind === 'binary') {
        setHtml(null)
        return
      }
      const lang = langFromFilename(relPath)
      const highlighted = await highlightToHtml(result.content, lang, false)
      if (!cancelled) setHtml(highlighted)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, relPath])

  if (missing) {
    return <div className="p-4 text-sm text-muted-foreground">{t('filer.fileDeleted')}</div>
  }
  if (html === null) {
    return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
  }
  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="shiki-lines text-sm" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

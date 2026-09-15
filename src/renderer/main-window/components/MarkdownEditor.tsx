import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '../../shared/components/Markdown'
import { Button } from '../../shared/components/ui/button'
import { registerFlush } from '../editorRegistry'

type ViewMode = 'split' | 'source' | 'preview'

const AUTOSAVE_DEBOUNCE_MS = 600
const EXTERNAL_CHECK_INTERVAL_MS = 3000

function conflictPath(relPath: string): string {
  const dot = relPath.lastIndexOf('.')
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
  return dot >= 0
    ? `${relPath.slice(0, dot)}.conflict-${stamp}${relPath.slice(dot)}`
    : `${relPath}.conflict-${stamp}`
}

/**
 * ui.md §10 / decisions.md N-3-3, N-5: 分割ビュー（ソース/プレビュー）を基本とし、
 * どちらか単独の表示にも切り替えられる。autosave で「保存」ボタンは出さない。
 * 外部（エージェント）による変更は、未保存編集がなければ黙って再読込し、
 * あれば競合コピーを残してから最新へ切り替える。
 */
export function MarkdownEditor({
  projectId,
  relPath
}: {
  projectId: string
  relPath: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<ViewMode>('split')
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)

  const savedTextRef = useRef('')
  const dirtyRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void window.shovel.fs.readFile(projectId, relPath).then((result) => {
      if (cancelled) return
      const content = result.kind === 'text' ? result.content : ''
      setText(content)
      savedTextRef.current = content
      dirtyRef.current = false
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, relPath])

  const flush = useCallback(async (): Promise<void> => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (!dirtyRef.current) return
    await window.shovel.fs.writeTextFile(projectId, relPath, text)
    savedTextRef.current = text
    dirtyRef.current = false
  }, [projectId, relPath, text])

  useEffect(() => registerFlush(() => void flush()), [projectId, relPath, text, flush])

  function onChange(value: string): void {
    setText(value)
    dirtyRef.current = true
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS)
  }

  // decisions.md N-3-6 / N-5: ターン終了などの明確な契機を待たず、開いている間は
  // 軽量なポーリングで外部変更を検知する（chokidar は導入しない方針。V-8）。
  useEffect(() => {
    const interval = setInterval(async () => {
      const result = await window.shovel.fs.readFile(projectId, relPath)
      if (result.kind === 'missing') {
        setDeleted(true)
        return
      }
      if (result.kind !== 'text') return
      if (result.content === savedTextRef.current) return
      // ディスクが savedTextRef と食い違った → 外部で変更された。
      if (!dirtyRef.current || text === savedTextRef.current) {
        setText(result.content)
        savedTextRef.current = result.content
        dirtyRef.current = false
        return
      }
      const backupPath = conflictPath(relPath)
      await window.shovel.fs.writeTextFile(projectId, backupPath, text)
      setText(result.content)
      savedTextRef.current = result.content
      dirtyRef.current = false
      setNotice(t('editor.conflict', { path: backupPath }))
    }, EXTERNAL_CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [projectId, relPath, text, t])

  if (!loaded) {
    return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
  }
  if (deleted) {
    return <div className="p-4 text-sm text-muted-foreground">{t('filer.fileDeleted')}</div>
  }

  return (
    <div className="flex h-full flex-col">
      {notice && (
        <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1.5 text-xs">
          <span>{notice}</span>
          <button className="text-muted-foreground hover:underline" onClick={() => setNotice(null)}>
            {t('common.dismiss')}
          </button>
        </div>
      )}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        {(['split', 'source', 'preview'] as const).map((m) => (
          <Button key={m} size="sm" variant={mode === m ? 'secondary' : 'ghost'} onClick={() => setMode(m)}>
            {t(`editor.mode.${m}`)}
          </Button>
        ))}
      </div>
      <div className="flex flex-1 overflow-hidden">
        {mode !== 'preview' && (
          <textarea
            className="h-full flex-1 resize-none overflow-auto border-r border-border bg-transparent p-3 font-mono text-sm outline-none"
            value={text}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {mode !== 'source' && (
          <div className="h-full flex-1 overflow-auto p-3">
            <Markdown text={text} />
          </div>
        )}
      </div>
    </div>
  )
}

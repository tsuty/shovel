import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Columns2, Eye, PanelRight, SquareCode, X } from 'lucide-react'
import { Markdown } from '../../shared/components/Markdown'
import { Button } from '../../shared/components/ui/button'
import { registerFlush } from '../editorRegistry'
import { isWritableEncoding, type LineEnding, type TextEncoding } from '@shared/types/filer'
import { FileStatusBar } from './FileStatusBar'

type ViewMode = 'split' | 'source' | 'preview'

const MODE_ICONS = { split: Columns2, source: SquareCode, preview: Eye } as const

const AUTOSAVE_DEBOUNCE_MS = 600

interface FileMeta {
  encoding: TextEncoding
  lineEnding: LineEnding
}

/** 保存後のバイト数を、main が元の改行コード・BOM に戻して書くのに合わせて見積もる。 */
function savedByteSize(text: string, meta: FileMeta): number {
  const bytes = new TextEncoder().encode(text).length
  const newlines = meta.lineEnding === 'CRLF' ? (text.match(/\n/g)?.length ?? 0) : 0
  return bytes + newlines + (meta.encoding === 'UTF-8 BOM' ? 3 : 0)
}
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
 * Markdown エディタ。分割ビュー（ソース/プレビュー）と、どちらか単独の表示を切り替える。
 * 編集は自動保存する。外部での変更は、未保存編集がなければ黙って再読込し、
 * あれば競合コピーを残してから最新へ切り替える。
 *
 * `variant: 'attached'` はチャットタブの右に添えたときで、ソースとプレビューの切り替えだけにする。
 */
export function MarkdownEditor({
  projectId,
  relPath,
  variant = 'tab',
  onAttachToChat,
  canAttachToChat = false,
  onClose
}: {
  projectId: string
  relPath: string
  variant?: 'tab' | 'attached'
  /** タブとして開いているとき: チャットの右に添える。 */
  onAttachToChat?: () => void
  canAttachToChat?: boolean
  /** チャットに添えているとき: 右ペインを閉じる。 */
  onClose?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const modes: ViewMode[] = variant === 'attached' ? ['source', 'preview'] : ['split', 'source', 'preview']
  const [mode, setMode] = useState<ViewMode>(variant === 'attached' ? 'source' : 'split')
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)
  const [meta, setMeta] = useState<FileMeta>({ encoding: 'UTF-8', lineEnding: 'none' })
  const [diskSize, setDiskSize] = useState(0)
  // UTF-8 以外のファイルは表示だけにする。
  const readOnly = !isWritableEncoding(meta.encoding)

  const savedTextRef = useRef('')
  const dirtyRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void window.shovel.fs.readFile(projectId, relPath).then((result) => {
      if (cancelled) return
      const content = result.kind === 'text' ? result.content : ''
      if (result.kind === 'text') {
        setMeta({ encoding: result.encoding, lineEnding: result.lineEnding })
        setDiskSize(result.size)
      }
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

  useEffect(() => registerFlush(flush), [flush])

  // 閉じたときも、自動保存待ちの編集を書き出す。
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => void flushRef.current(), [])

  function onChange(value: string): void {
    if (readOnly) return
    setText(value)
    dirtyRef.current = true
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // 発火時点の最新の flush を呼ぶ。
    debounceRef.current = setTimeout(() => void flushRef.current(), AUTOSAVE_DEBOUNCE_MS)
  }

  // 開いている間はポーリングで外部変更を検知する。
  useEffect(() => {
    const interval = setInterval(async () => {
      const result = await window.shovel.fs.readFile(projectId, relPath)
      if (result.kind === 'missing') {
        setDeleted(true)
        return
      }
      if (result.kind !== 'text') return
      setMeta((prev) =>
        prev.encoding === result.encoding && prev.lineEnding === result.lineEnding
          ? prev
          : { encoding: result.encoding, lineEnding: result.lineEnding }
      )
      setDiskSize(result.size)
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
        {modes.map((m) => {
          const Icon = MODE_ICONS[m]
          return (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? 'secondary' : 'ghost'}
              className="gap-1.5"
              onClick={() => setMode(m)}
            >
              <Icon size={14} />
              {t(`editor.mode.${m}`)}
            </Button>
          )
        })}
        <div className="flex-1" />
        {variant === 'attached' ? (
          <>
            <span className="truncate text-xs text-muted-foreground" title={relPath}>
              {relPath.split('/').pop()}
            </span>
            <button
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t('common.close')}
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </>
        ) : (
          onAttachToChat && (
            <Button size="sm" variant="ghost" className="gap-1.5" disabled={!canAttachToChat} onClick={onAttachToChat}>
              <PanelRight size={14} />
              {t('editor.attachToChat')}
            </Button>
          )
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        {mode !== 'preview' && (
          <textarea
            className="h-full flex-1 resize-none overflow-auto border-r border-border bg-transparent p-3 font-mono text-sm outline-none"
            value={text}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {mode !== 'source' && (
          <div className="h-full flex-1 overflow-auto p-3">
            <Markdown text={text} />
          </div>
        )}
      </div>
      <FileStatusBar
        size={dirtyRef.current ? savedByteSize(text, meta) : diskSize}
        encoding={meta.encoding}
        lineEnding={meta.lineEnding}
        readOnly={readOnly}
      />
    </div>
  )
}

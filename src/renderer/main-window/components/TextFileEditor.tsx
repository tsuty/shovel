import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Columns2, Eye, PanelRight, SquareCode, SquarePen, X } from 'lucide-react'
import { Markdown } from '../../shared/components/Markdown'
import { MermaidDiagram } from '../../shared/components/MermaidDiagram'
import { Button } from '../../shared/components/ui/button'
import { highlightToHtml, langFromFilename } from '../../shared/lib/shiki'
import { registerFlush } from '../editorRegistry'
import { conflictPath, decideEditorSync } from '../editorSync'
import { isWritableEncoding, type LineEnding, type TextEncoding } from '@shared/types/filer'
import { FileStatusBar } from './FileStatusBar'
import { computeIndent, findJsonProblem, lineNumbersText, offsetAt, type JsonProblem } from '../textEditing'
import { usesViewEditModes, type EditorLanguage } from '@shared/fileKinds'

/**
 * 表示の切り替え。Markdown / Mermaid は「分割・ソース・プレビュー」、
 * JSON / YAML / テキストは「表示（ハイライト、既定）・編集」。
 */
type ViewMode = 'split' | 'source' | 'preview' | 'view' | 'edit'

const MODE_ICONS = { split: Columns2, source: SquareCode, preview: Eye, view: Eye, edit: SquarePen } as const

/** 先頭が既定のモード。チャットの横に添えたときは「分割」を出さない（decisions.md G-1-9）。 */
function modesFor(language: EditorLanguage, variant: 'tab' | 'attached'): [ViewMode, ...ViewMode[]] {
  if (usesViewEditModes(language)) return ['view', 'edit']
  return variant === 'attached' ? ['source', 'preview'] : ['split', 'source', 'preview']
}

/** Mermaid の図は打鍵ごとに描き直すと重く、書きかけの文法エラーでちらつくので、少し待ってから描く。 */
const MERMAID_PREVIEW_DELAY_MS = 400

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

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

/**
 * アプリ内で編集できるテキストファイル（Markdown / Mermaid / JSON / YAML / .txt、decisions.md N-3-1）の
 * エディタ。Markdown / Mermaid は分割ビュー（ソース/プレビュー）と、どちらか単独の表示を切り替える。
 * JSON / YAML / テキストは編集したい場面の方が少ないので、ハイライトした表示を既定にし、「編集」で書き換えられる。
 * 編集は自動保存する。外部での変更は、未保存編集がなければ黙って再読込し、
 * あれば競合コピーを残してから最新へ切り替える。
 *
 * `variant: 'attached'` はチャットタブの右に添えたときで、「分割」は出さない。
 */
export function TextFileEditor({
  projectId,
  relPath,
  language = 'markdown',
  variant = 'tab',
  onAttachToChat,
  canAttachToChat = false,
  onClose
}: {
  projectId: string
  relPath: string
  language?: EditorLanguage
  variant?: 'tab' | 'attached'
  /** タブとして開いているとき: チャットの右に添える。 */
  onAttachToChat?: () => void
  canAttachToChat?: boolean
  /** チャットに添えているとき: 右ペインを閉じる。 */
  onClose?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const modes = modesFor(language, variant)
  const [mode, setMode] = useState<ViewMode>(modes[0])
  const showSource = mode === 'split' || mode === 'source' || mode === 'edit'
  const showPreview = mode === 'split' || mode === 'preview' || mode === 'view'
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)
  const [meta, setMeta] = useState<FileMeta>({ encoding: 'UTF-8', lineEnding: 'none' })
  const [diskSize, setDiskSize] = useState(0)
  /** 最後に自動保存が完了した時刻。ファイルを開いてからまだ保存していなければ null。 */
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // UTF-8 以外のファイルは表示だけにする。
  const readOnly = !isWritableEncoding(meta.encoding)

  const savedTextRef = useRef('')
  const textRef = useRef('')
  const deletedRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve())

  const applyText = useCallback((content: string): void => {
    textRef.current = content
    setText(content)
  }, [])

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
      applyText(content)
      savedTextRef.current = content
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, relPath, applyText])

  /**
   * ディスクの内容と突き合わせる。外部で変更されていれば再読込するか、未保存の編集を
   * 競合コピーに退避してから最新へ切り替える。`save` のときは、外部変更が無ければ
   * 未保存の編集を書き込む。ポーリングと保存が重ならないよう、1つずつ順に実行する。
   */
  const syncWithDisk = useCallback(
    (save: boolean): Promise<void> => {
      const run = async (): Promise<void> => {
        if (deletedRef.current) return
        const result = await window.shovel.fs.readFile(projectId, relPath)
        const editorText = textRef.current
        const action = decideEditorSync(result, savedTextRef.current, editorText)
        let sizeOnDisk = result.kind === 'text' ? result.size : 0
        switch (action.kind) {
          case 'deleted':
            deletedRef.current = true
            setDeleted(true)
            return
          case 'unreadable':
            return
          case 'reload':
            applyText(action.content)
            savedTextRef.current = action.content
            break
          case 'conflict': {
            applyText(action.content)
            savedTextRef.current = action.content
            const backupPath = conflictPath(relPath)
            await window.shovel.fs.writeTextFile(projectId, backupPath, editorText)
            setNotice(t('editor.conflict', { path: backupPath }))
            break
          }
          case 'unchanged':
            if (save && editorText !== savedTextRef.current) {
              await window.shovel.fs.writeTextFile(projectId, relPath, editorText)
              savedTextRef.current = editorText
              setSavedAt(Date.now())
              // 読み込んだのは書く前なので、サイズは書いた内容から見積もる。
              if (result.kind === 'text') sizeOnDisk = savedByteSize(editorText, result)
            }
            break
        }
        if (result.kind === 'text') {
          setMeta((prev) =>
            prev.encoding === result.encoding && prev.lineEnding === result.lineEnding
              ? prev
              : { encoding: result.encoding, lineEnding: result.lineEnding }
          )
          setDiskSize(sizeOnDisk)
        }
      }
      const next = syncQueueRef.current.then(run)
      syncQueueRef.current = next.catch(() => {})
      return next
    },
    [projectId, relPath, applyText, t]
  )

  const flush = useCallback(async (): Promise<void> => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (textRef.current === savedTextRef.current) return
    await syncWithDisk(true)
  }, [syncWithDisk])

  useEffect(() => registerFlush(flush), [flush])

  // 閉じたときも、自動保存待ちの編集を書き出す。
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => void flushRef.current(), [])

  function onChange(value: string): void {
    if (readOnly) return
    applyText(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // 発火時点の最新の flush を呼ぶ。
    debounceRef.current = setTimeout(() => {
      flushRef.current().catch((err: unknown) => console.warn('[editor] autosave failed', err))
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLPreElement>(null)

  /**
   * Tab / Shift+Tab でインデントを増やす・減らす（フォーカスを次の要素へ移さない）。
   * `execCommand('insertText')` で入れるので、元に戻す（Cmd/Ctrl+Z）が効き、input イベント経由で
   * 自動保存も走る。使えない環境では値を直接書き換える。
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing || readOnly) return
    e.preventDefault()
    const area = e.currentTarget
    const edit = computeIndent(area.value, area.selectionStart, area.selectionEnd, e.shiftKey)
    if (!edit) return
    area.setSelectionRange(edit.replaceStart, edit.replaceEnd)
    const inserted =
      edit.insert === '' ? document.execCommand('delete') : document.execCommand('insertText', false, edit.insert)
    if (!inserted) {
      area.setRangeText(edit.insert, edit.replaceStart, edit.replaceEnd)
      onChange(area.value)
    }
    area.setSelectionRange(edit.selectionStart, edit.selectionEnd)
  }

  // 行番号は折り返しと両立しないので、図と設定ファイルだけに付けて折り返さない。
  // Markdown は文章なので、折り返しを優先して行番号を付けない。
  const showLineNumbers = language !== 'markdown'
  const lineNumbers = useMemo(() => (showLineNumbers ? lineNumbersText(text) : ''), [showLineNumbers, text])
  function syncGutter(): void {
    if (gutterRef.current && textareaRef.current) gutterRef.current.scrollTop = textareaRef.current.scrollTop
  }

  // JSON は書式の誤りをステータスバーに出し、押すとその位置を編集できるようにする。
  const jsonProblem = useMemo(() => (language === 'json' ? findJsonProblem(text) : null), [language, text])
  /** 誤りの位置へ移るとき、textarea が出てからカーソルを置くための保留。 */
  const pendingCaretRef = useRef<number | null>(null)
  function revealProblem(problem: JsonProblem): void {
    if (problem.line === undefined) return
    pendingCaretRef.current = offsetAt(textRef.current, problem.line, problem.column ?? 1)
    if (!showSource) setMode(modes.includes('edit') ? 'edit' : 'source')
    else placePendingCaret()
  }
  function placePendingCaret(): void {
    const area = textareaRef.current
    const caret = pendingCaretRef.current
    if (!area || caret === null) return
    pendingCaretRef.current = null
    area.focus()
    area.setSelectionRange(caret, caret)
  }
  useEffect(() => {
    if (showSource) placePendingCaret()
  })

  const mermaidCode = useDebouncedValue(text, MERMAID_PREVIEW_DELAY_MS)

  // JSON / YAML / テキストの表示は shiki で描く（テキストは色なしで行番号だけ。外部での変更を読み直したときも描き直す）。
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const highlightsCode = usesViewEditModes(language) && showPreview
  useEffect(() => {
    if (!highlightsCode) return
    let cancelled = false
    void highlightToHtml(text, langFromFilename(relPath)).then((html) => {
      if (!cancelled) setHighlighted(html)
    })
    return () => {
      cancelled = true
    }
  }, [highlightsCode, text, relPath])

  // 開いている間はポーリングで外部変更を検知する。
  useEffect(() => {
    const interval = setInterval(() => {
      syncWithDisk(false).catch((err: unknown) => console.warn('[editor] external change check failed', err))
    }, EXTERNAL_CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [syncWithDisk])

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
        {showSource && (
          <div className="flex h-full min-w-0 flex-1 overflow-hidden border-r border-border">
            {showLineNumbers && (
              // 横スクロールバーの分だけ textarea の方が深くスクロールできるので、下に余白を足しておく。
              <pre
                ref={gutterRef}
                aria-hidden
                className="shrink-0 select-none overflow-hidden pt-3 pb-8 pl-3 pr-2 text-right font-mono text-editor text-muted-foreground/60"
              >
                {lineNumbers}
              </pre>
            )}
            <textarea
              ref={textareaRef}
              className="h-full min-w-0 flex-1 resize-none overflow-auto bg-transparent p-3 font-mono text-editor outline-hidden"
              value={text}
              readOnly={readOnly}
              wrap={showLineNumbers ? 'off' : undefined}
              // 図や設定ファイルのキーに英語のスペルチェックの波線が付かないよう、Markdown だけ有効にする。
              spellCheck={language === 'markdown'}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              onScroll={syncGutter}
            />
          </div>
        )}
        {showPreview && (
          <div className="h-full flex-1 overflow-auto p-3">
            {language === 'markdown' ? (
              <Markdown text={text} className="text-editor" />
            ) : language === 'mermaid' ? (
              <MermaidDiagram code={mermaidCode} />
            ) : highlighted !== null ? (
              <div className="shiki-lines text-editor" dangerouslySetInnerHTML={{ __html: highlighted }} />
            ) : null}
          </div>
        )}
      </div>
      <FileStatusBar
        size={text !== savedTextRef.current ? savedByteSize(text, meta) : diskSize}
        encoding={meta.encoding}
        lineEnding={meta.lineEnding}
        readOnly={readOnly}
        savedAt={savedAt}
        problem={
          jsonProblem && {
            label:
              jsonProblem.line === undefined
                ? t('editor.jsonInvalid')
                : t('editor.jsonInvalidAt', { line: jsonProblem.line, column: jsonProblem.column ?? 1 }),
            detail: jsonProblem.message,
            onClick: jsonProblem.line === undefined ? undefined : () => revealProblem(jsonProblem)
          }
        }
      />
    </div>
  )
}

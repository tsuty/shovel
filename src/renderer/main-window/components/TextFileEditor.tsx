import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleHelp, Columns2, ExternalLink, Eye, PanelRight, Printer, SquareCode, SquarePen, Table, X } from 'lucide-react'
import { InfoTip } from '../../shared/components/InfoTip'
import { Markdown } from '../../shared/components/Markdown'
import { MermaidViewer } from '../../shared/components/MermaidViewer'
import { Button } from '../../shared/components/ui/button'
import { Checkbox } from '../../shared/components/ui/input'
import { highlightToHtml, langFromFilename } from '../../shared/lib/shiki'
import { registerFlush } from '../editorRegistry'
import { onTurnEnd } from '../turnEnd'
import { conflictPath, decideEditorSync } from '../editorSync'
import { isWritableEncoding, type LineEnding, type TextEncoding } from '@shared/types/filer'
import { FileStatusBar, PathStatusBar, formatFileSize } from './FileStatusBar'
import { HtmlPreview } from '../../shared/components/HtmlPreview'
import { cn } from '../../shared/lib/utils'
import { findJsonProblem, type JsonProblem } from '../textEditing'
import { isTableLanguage, usesViewEditModes, type EditorLanguage } from '@shared/fileKinds'
import { revealInHighlightedCode, type FileReveal } from '../revealMatch'
import { openSearchPanel } from '@codemirror/search'
import { createCodeEditor, replaceDocument, selectAt, type CodeEditor } from '../codeEditor'
import { closeFindBar, registerEditorSearch } from '../editorSearch'
import { loadFirstRowIsHeader, parseCsvRecords, saveFirstRowIsHeader, toCsvTable } from '../csvTable'
import { CsvTable } from './CsvTable'

/**
 * 表示の切り替え。Markdown / Mermaid / HTML は「分割・ソース・プレビュー」、
 * JSON / YAML / テキストは「表示（ハイライト、既定）・編集」、CSV / TSV は「表示（表、既定）・編集」。
 */
type ViewMode = 'split' | 'source' | 'preview' | 'view' | 'edit'

const MODE_ICONS = { split: Columns2, source: SquareCode, preview: Eye, view: Eye, edit: SquarePen } as const

/** 種類と表示場所ごとに選べるモード。先頭が既定。 */
function modesFor(language: EditorLanguage, variant: 'tab' | 'attached'): [ViewMode, ...ViewMode[]] {
  if (usesViewEditModes(language)) return ['view', 'edit']
  return variant === 'attached' ? ['source', 'preview'] : ['split', 'source', 'preview']
}

/**
 * Mermaid の図と HTML のページは打鍵ごとに描き直すと重く、書きかけの内容でちらつく
 * （HTML はスクロール位置も戻る）ので、少し待ってから描く。
 */
const RENDERED_PREVIEW_DELAY_MS = 400

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

/** Shift_JIS でのバイト数の見積もり（ASCII と半角カナは 1 バイト、それ以外は 2 バイト）。 */
function shiftJisByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    bytes += c < 0x80 || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2
  }
  return bytes
}

/** 保存後のバイト数を、main が元の文字コード・改行コード・BOM に戻して書くのに合わせて見積もる。 */
function savedByteSize(text: string, meta: FileMeta): number {
  const bytes = meta.encoding === 'Shift_JIS' ? shiftJisByteLength(text) : new TextEncoder().encode(text).length
  const newlines = meta.lineEnding === 'CRLF' ? (text.match(/\n/g)?.length ?? 0) : 0
  return bytes + newlines + (meta.encoding === 'UTF-8 BOM' ? 3 : 0)
}
const EXTERNAL_CHECK_INTERVAL_MS = 3000

/** これより大きい CSV / TSV はアプリ内で開かず、OS の関連付けアプリに任せる。 */
const MAX_TABLE_FILE_BYTES = 10 * 1024 * 1024

/** CodeMirror の検索パネルの文言（英語の原文）と、訳のキー。 */
const EDITOR_PHRASE_KEYS: Record<string, string> = {
  Find: 'find',
  Replace: 'replace',
  next: 'next',
  previous: 'previous',
  all: 'all',
  'match case': 'matchCase',
  regexp: 'regexp',
  'by word': 'byWord',
  replace: 'replaceOne',
  'replace all': 'replaceAll',
  close: 'close',
  'current match': 'currentMatch',
  'on line': 'onLine',
  'replaced $ matches': 'replacedMatches',
  'replaced match on line $': 'replacedMatchOnLine',
  'Go to line': 'goToLine',
  go: 'go'
}

/**
 * アプリ内で編集できるテキストファイルのエディタ。`variant: 'attached'` はチャットタブの右に添えたとき。
 *
 * `reveal`（中身検索の一致箇所）が来たら、ソースが見えていればそこを選択し、「表示」ならその行へ移って
 * 塗る。Markdown / Mermaid / HTML のプレビューだけのときは、ソースが見えるモードへ切り替えてから選択する。
 */
/** ショートカットの説明に埋め込むキー表記（macOS は記号、それ以外は「Ctrl+」の形）。 */
function shortcutKeyLabels(): Record<'mod' | 'alt' | 'shift' | 'redo', string> {
  return window.shovel.platform === 'darwin'
    ? { mod: '⌘', alt: '⌥', shift: '⇧', redo: '⇧⌘Z' }
    : { mod: 'Ctrl+', alt: 'Alt+', shift: 'Shift+', redo: 'Ctrl+Y' }
}

export function TextFileEditor({
  projectId,
  relPath,
  language = 'markdown',
  variant = 'tab',
  onAttachToChat,
  canAttachToChat = false,
  onClose,
  reveal
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
  reveal?: FileReveal
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
  // 書き戻せない文字コードのファイルは表示だけにする。
  const readOnly = !isWritableEncoding(meta.encoding)
  /** CSV / TSV が大きすぎてアプリ内で開かないとき。 */
  const [tooLarge, setTooLarge] = useState(false)
  const tooLargeRef = useRef(false)
  const [openError, setOpenError] = useState<string | null>(null)
  /** 元の文字コードで表せない文字があって、最後の自動保存ができなかったとき。 */
  const [unencodable, setUnencodable] = useState<{ line: number; column: number; char: string } | null>(null)

  const savedTextRef = useRef('')
  const textRef = useRef('')
  const deletedRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve())

  const editorRef = useRef<CodeEditor | null>(null)
  const editorHostRef = useRef<HTMLDivElement>(null)

  /** 外から中身を差し替える（読み込み・外部変更の読み直し）。エディタにも反映する。 */
  const applyText = useCallback((content: string): void => {
    textRef.current = content
    setText(content)
    if (editorRef.current) replaceDocument(editorRef.current.view, content)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void window.shovel.fs.readFile(projectId, relPath).then((result) => {
      if (cancelled) return
      const large = isTableLanguage(language) && result.kind === 'text' && result.size > MAX_TABLE_FILE_BYTES
      tooLargeRef.current = large
      setTooLarge(large)
      const content = result.kind === 'text' && !large ? result.content : ''
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
  }, [projectId, relPath, language, applyText])

  /**
   * ディスクの内容と突き合わせる。外部で変更されていれば再読込するか、未保存の編集を
   * 競合コピーに退避してから最新へ切り替える。`save` のときは、外部変更が無ければ
   * 未保存の編集を書き込む。ポーリングと保存が重ならないよう、1つずつ順に実行する。
   */
  const syncWithDisk = useCallback(
    (save: boolean): Promise<void> => {
      const run = async (): Promise<void> => {
        if (deletedRef.current || tooLargeRef.current) return
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
            setUnencodable(null)
            break
          case 'conflict': {
            applyText(action.content)
            savedTextRef.current = action.content
            const backupPath = conflictPath(relPath)
            await window.shovel.fs.writeTextFile(projectId, backupPath, editorText)
            setUnencodable(null)
            setNotice(t('editor.conflict', { path: backupPath }))
            break
          }
          case 'unchanged':
            if (save && editorText !== savedTextRef.current) {
              const written = await window.shovel.fs.writeTextFile(projectId, relPath, editorText)
              if (!written.ok) {
                setUnencodable({ line: written.line, column: written.column, char: written.char })
                break
              }
              setUnencodable(null)
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
    if (textRef.current === savedTextRef.current) {
      // 保存できない文字を消して、保存済みの内容に戻ったとき。
      setUnencodable(null)
      return
    }
    await syncWithDisk(true)
  }, [syncWithDisk])

  useEffect(() => registerFlush(flush), [flush])

  // 閉じたときも、自動保存待ちの編集を書き出す。
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => void flushRef.current(), [])

  function onChange(value: string): void {
    if (readOnly) return
    textRef.current = value
    setText(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // 発火時点の最新の flush を呼ぶ。
    debounceRef.current = setTimeout(() => {
      flushRef.current().catch((err: unknown) => console.warn('[editor] autosave failed', err))
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // 読み込みが済んだらエディタを作る。ソースを隠している間も作ったままにする（元に戻すの履歴を保つ）。
  useEffect(() => {
    const host = editorHostRef.current
    if (!loaded || deleted || !host) return
    const editor = createCodeEditor({
      parent: host,
      doc: textRef.current,
      language,
      highlightLang: langFromFilename(relPath),
      readOnly: false,
      phrases: {},
      onChange: (value) => onChangeRef.current(value)
    })
    editorRef.current = editor
    return () => {
      editor.view.destroy()
      editorRef.current = null
    }
  }, [loaded, deleted, language, relPath])

  useEffect(() => {
    editorRef.current?.setReadOnly(readOnly)
  }, [readOnly, loaded, deleted])

  useEffect(() => {
    editorRef.current?.setPhrases(
      Object.fromEntries(Object.entries(EDITOR_PHRASE_KEYS).map(([phrase, key]) => [phrase, t(`editor.search.${key}`)]))
    )
  }, [t, loaded, deleted])

  // タブで開いていてソースが見えている間は、Cmd/Ctrl+F をこのエディタの検索パネルで受ける。
  useEffect(() => {
    const editor = editorRef.current
    if (variant !== 'tab' || !showSource || !editor) return
    return registerEditorSearch({ element: editor.view.dom, open: () => openSearchPanel(editor.view) })
  }, [variant, showSource, loaded, deleted, language])

  // タブで開いているときは、表示を切り替えたらページ内検索を閉じる。
  const previousModeRef = useRef(mode)
  useEffect(() => {
    if (previousModeRef.current === mode) return
    previousModeRef.current = mode
    if (variant === 'tab') closeFindBar()
  }, [mode, variant])

  // JSON は書式の誤りをステータスバーに出し、押すとその位置を編集できるようにする。
  const jsonProblem = useMemo(() => (language === 'json' ? findJsonProblem(text) : null), [language, text])
  /** 誤りの位置へ移るとき、ソースが見えてからカーソルを置くための保留。 */
  const pendingCaretRef = useRef<{ line: number; column: number } | null>(null)
  function revealProblem(problem: Pick<JsonProblem, 'line' | 'column'>): void {
    if (problem.line === undefined) return
    pendingCaretRef.current = { line: problem.line, column: problem.column ?? 1 }
    if (!showSource) setMode(modes.includes('edit') ? 'edit' : 'source')
    else placePendingCaret()
  }
  function placePendingCaret(): void {
    const editor = editorRef.current
    const caret = pendingCaretRef.current
    if (!editor || caret === null) return
    pendingCaretRef.current = null
    selectAt(editor.view, caret.line, caret.column)
  }
  useEffect(() => {
    if (showSource) placePendingCaret()
  })

  const renderedSource = useDebouncedValue(text, RENDERED_PREVIEW_DELAY_MS)

  /** まだ反映していない `reveal`。読み込みと、移り先（エディタか表示）の描画が済んでから反映する。 */
  const pendingRevealRef = useRef<FileReveal | null>(null)
  const highlightedRef = useRef<HTMLDivElement>(null)

  // JSON / YAML / テキストの表示は shiki で描く（テキストは色なしで行番号だけ。外部での変更を読み直したときも描き直す）。
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const highlightsCode = usesViewEditModes(language) && !isTableLanguage(language) && showPreview
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

  useEffect(() => {
    if (!reveal) return
    pendingRevealRef.current = reveal
    if (!usesViewEditModes(language) && !showSource) setMode(modes[0])
    // 表には行・列の位置が無いので、編集へ切り替えてから選択する。
    if (isTableLanguage(language) && !showSource) setMode('edit')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce])
  useEffect(() => {
    const pending = pendingRevealRef.current
    if (!pending || !loaded || deleted) return
    if (showSource) {
      if (!editorRef.current) return
      pendingRevealRef.current = null
      selectAt(editorRef.current.view, pending.line, pending.column, pending.length)
    } else if (mode === 'view' && highlightedRef.current) {
      // 読み込み前の空の内容を描いたものには行が無いので、本物が描かれるまで待つ。
      if (revealInHighlightedCode(highlightedRef.current, pending)) pendingRevealRef.current = null
    }
  })

  // 開いている間はポーリングで外部変更を検知する。
  useEffect(() => {
    const interval = setInterval(() => {
      syncWithDisk(false).catch((err: unknown) => console.warn('[editor] external change check failed', err))
    }, EXTERNAL_CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [syncWithDisk])

  // ターン終了時は、次のポーリングを待たずに読み直す。
  useEffect(
    () =>
      onTurnEnd(() => {
        syncWithDisk(false).catch((err: unknown) => console.warn('[editor] external change check failed', err))
      }),
    [syncWithDisk]
  )

  // CSV / TSV の「1行目を見出しにする」。ファイルが替わったら、そのファイルの設定を読み直す。
  const headerKey = `${projectId}\0${relPath}`
  const [headerPref, setHeaderPref] = useState<{ key: string; value: boolean } | null>(null)
  const firstRowIsHeader =
    headerPref?.key === headerKey ? headerPref.value : loadFirstRowIsHeader(projectId, relPath)
  function changeFirstRowIsHeader(value: boolean): void {
    saveFirstRowIsHeader(projectId, relPath, value)
    setHeaderPref({ key: headerKey, value })
  }
  const tableRecords = useMemo(
    () =>
      isTableLanguage(language) && showPreview && loaded ? parseCsvRecords(text, language === 'tsv' ? '\t' : ',') : null,
    [language, showPreview, loaded, text]
  )
  const tableData = useMemo(
    () => (tableRecords ? toCsvTable(tableRecords, firstRowIsHeader) : null),
    [tableRecords, firstRowIsHeader]
  )

  async function openInOS(): Promise<void> {
    setOpenError(null)
    try {
      await window.shovel.fs.openInOS(projectId, relPath)
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err))
    }
  }

  /** 印刷用表示はディスクから読むので、自動保存待ちの編集を書き出してから開く。 */
  async function openPrintPreview(): Promise<void> {
    await flush().catch((err: unknown) => console.warn('[editor] autosave failed', err))
    await window.shovel.print.openPreview(projectId, relPath)
  }

  if (!loaded) {
    return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
  }
  if (deleted) {
    return <div className="p-4 text-sm text-muted-foreground">{t('filer.fileDeleted')}</div>
  }
  if (tooLarge) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-sm text-muted-foreground">
          <p>{t('editor.tableTooLarge', { size: formatFileSize(diskSize), limit: formatFileSize(MAX_TABLE_FILE_BYTES) })}</p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void openInOS()}>
            <ExternalLink size={14} />
            {t('filer.openWithDefaultApp')}
          </Button>
          {openError && <p className="text-xs text-destructive">{openError}</p>}
        </div>
        <PathStatusBar relPath={relPath} size={diskSize} />
      </div>
    )
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
        {tableData && (
          <>
            <label className="ml-2 flex items-center gap-1.5 text-xs">
              <Checkbox checked={firstRowIsHeader} onChange={(e) => changeFirstRowIsHeader(e.target.checked)} />
              {t('editor.firstRowIsHeader')}
            </label>
            <span className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Table size={12} />
              {t('editor.tableSize', { rows: tableData.rows.length, columns: tableData.headers.length })}
            </span>
          </>
        )}
        <div className="flex-1" />
        {(language === 'markdown' || language === 'html') &&
          (variant === 'attached' ? (
            // チャットの横では幅が狭いので、アイコンだけにする。
            <button
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t('editor.printPreview')}
              onClick={() => void openPrintPreview()}
            >
              <Printer size={14} />
            </button>
          ) : (
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void openPrintPreview()}>
              <Printer size={14} />
              {t('editor.printPreview')}
            </Button>
          ))}
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
          <>
            {onAttachToChat && (
              <Button size="sm" variant="ghost" className="gap-1.5" disabled={!canAttachToChat} onClick={onAttachToChat}>
                <PanelRight size={14} />
                {t('editor.attachToChat')}
              </Button>
            )}
            {!readOnly && (
              <span className="ml-1 flex">
                <InfoTip icon={CircleHelp} size={14} text={t('editor.shortcutsHelp', shortcutKeyLabels())} />
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div
          ref={editorHostRef}
          className={cn(
            'h-full min-w-0 flex-1 overflow-hidden border-r border-border font-mono text-editor',
            !showSource && 'hidden'
          )}
        />
        {showPreview && (
          <div
            className={cn(
              'h-full flex-1',
              language === 'mermaid' || tableData ? 'flex min-w-0 flex-col' : 'overflow-auto',
              language !== 'html' && language !== 'mermaid' && !tableData && 'p-3'
            )}
          >
            {language === 'markdown' ? (
              <Markdown text={text} className="text-editor" allowDetails />
            ) : language === 'mermaid' ? (
              <MermaidViewer code={renderedSource} className="flex-1" />
            ) : language === 'html' ? (
              <HtmlPreview html={renderedSource} title={relPath} />
            ) : tableData ? (
              <CsvTable data={tableData} />
            ) : highlighted !== null ? (
              <div
                ref={highlightedRef}
                className="shiki-lines text-editor"
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            ) : null}
          </div>
        )}
      </div>
      <FileStatusBar
        relPath={relPath}
        size={text !== savedTextRef.current ? savedByteSize(text, meta) : diskSize}
        encoding={meta.encoding}
        lineEnding={meta.lineEnding}
        readOnly={readOnly}
        savedAt={unencodable ? null : savedAt}
        problem={
          unencodable
            ? {
                label: t('editor.unencodable', {
                  encoding: meta.encoding,
                  line: unencodable.line,
                  char: unencodable.char
                }),
                detail: t('editor.unencodableDetail', { encoding: meta.encoding }),
                onClick: () => revealProblem(unencodable)
              }
            : jsonProblem && {
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

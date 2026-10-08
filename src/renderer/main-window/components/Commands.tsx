import { useEffect, useRef, useState } from 'react'
import { History, Info, Pin, SquareTerminal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CommandExit, CommandHistory, CommandOutputChunk, CommandTtyOutput } from '@shared/types/command'
import { cn } from '../../shared/lib/utils'
import { TtyTerminal, type TtyTerminalHandle } from './TtyTerminal'

type RunEvent = CommandOutputChunk | CommandTtyOutput | CommandExit

const MAX_LINES = 2000
/** 履歴の表示件数。 */
const HISTORY_LIMIT = 20
/** ピン留めの上限（main の `PINNED_COMMAND_LIMIT` と揃える）。 */
const PINNED_LIMIT = 10

/**
 * コマンド実行パネル。`\r` で上書きされる進捗行は1行として畳み、出力行数には上限を設ける。
 * TTY モードの実行は、出力の面を端末（`TtyTerminal`）に替えて表示する。
 */
export function Commands({ projectId, onClose }: { projectId: string; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [command, setCommand] = useState('')
  const [{ pinned, recent: history }, setHistory] = useState<CommandHistory>({ pinned: [], recent: [] })
  const [runId, setRunId] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [stdin, setStdin] = useState('')
  const [historyOpen, setHistoryOpen] = useState(true)
  /** 次の実行を TTY モードにするか。 */
  const [ttyMode, setTtyMode] = useState(false)
  /** 出力の面に何を出しているか。端末は次の実行かパネルを閉じるまで残す。 */
  const [view, setView] = useState<'log' | 'tty'>('log')
  /** TTY モードの実行ごとに端末を作り直すためのキー。 */
  const [ttyKey, setTtyKey] = useState(0)
  /** TTY モードで、端末の準備を待っている間 true。 */
  const [starting, setStarting] = useState(false)
  /** サンドボックスに python3 が無く、TTY モードを始められなかった。 */
  const [ttyUnavailable, setTtyUnavailable] = useState(false)
  const termRef = useRef<TtyTerminalHandle>(null)
  /** 端末の準備ができたら実行するコマンド。 */
  const pendingTtyCommandRef = useRef<string | null>(null)
  /** 実行中のものが TTY モードか。 */
  const runIsTtyRef = useRef(false)
  const pendingRef = useRef('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** ↑↓で辿っている履歴の位置。-1 は「履歴を辿っていない（下書き）」。 */
  const historyIndexRef = useRef(-1)
  /** 履歴を辿り始める前に入力欄にあった下書き。↓で戻ってきたときに戻す。 */
  const draftRef = useRef('')
  /** 実行中の runId。出力・終了の購読側は state ではなくこちらを見る。 */
  const runIdRef = useRef<string | null>(null)
  /** runId が分かる前に届いた出力・終了。分かった時点で流し込む。 */
  const earlyRef = useRef(new Map<string, RunEvent[]>())

  useEffect(() => {
    void window.shovel.command.history(projectId).then(setHistory)
  }, [projectId])

  function handleRunEvent(event: RunEvent): void {
    if ('text' in event) {
      appendText(event.text)
      return
    }
    if ('data' in event) {
      termRef.current?.write(event.data)
      return
    }
    const exitLine = `[exit ${event.code ?? '?'}]`
    setLines((prev) => [...prev, exitLine])
    if (runIsTtyRef.current) {
      // 終わった端末にはもう入力できないので、カーソルを隠す。
      termRef.current?.write(`\r\n${exitLine}\r\n\x1b[?25l`)
      if (event.ttyUnavailable) setTtyUnavailable(true)
    }
    runIdRef.current = null
    runIsTtyRef.current = false
    setRunId(null)
  }

  useEffect(() => {
    const route = (event: RunEvent): void => {
      if (event.runId === runIdRef.current) {
        handleRunEvent(event)
        return
      }
      // runId が未確定の実行の分として保留する。
      const early = earlyRef.current.get(event.runId) ?? []
      early.push(event)
      earlyRef.current.set(event.runId, early)
    }
    const offOutput = window.shovel.command.onOutput(route)
    const offTtyOutput = window.shovel.command.onTtyOutput(route)
    const offExit = window.shovel.command.onExit(route)
    return () => {
      offOutput()
      offTtyOutput()
      offExit()
      // 端末が無くなると TTY モードの実行は操作できなくなるので、パネルを閉じたら中断する。
      if (runIdRef.current && runIsTtyRef.current) void window.shovel.command.cancel(runIdRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lines])

  // 実行の開始・終了で入力欄（TTY モードの実行中は端末）にフォーカスを移し直す。
  useEffect(() => {
    if (runId && runIsTtyRef.current) termRef.current?.focus()
    else inputRef.current?.focus()
  }, [runId])

  function appendText(text: string): void {
    let cur = pendingRef.current
    const committed: string[] = []
    for (const ch of text) {
      if (ch === '\n') {
        committed.push(cur)
        cur = ''
      } else if (ch === '\r') {
        cur = ''
      } else {
        cur += ch
      }
    }
    pendingRef.current = cur
    if (committed.length > 0) {
      setLines((prev) => {
        const next = [...prev, ...committed]
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
      })
    }
  }

  async function run(): Promise<void> {
    const trimmed = command.trim()
    if (!trimmed || runId || starting) return
    pendingRef.current = ''
    setTtyUnavailable(false)
    if (ttyMode) {
      setLines((prev) => [...prev, `$ ${trimmed}  (TTY)`])
      // 端末の大きさが分かってから実行する（`startTty`）。
      pendingTtyCommandRef.current = trimmed
      setStarting(true)
      setView('tty')
      setTtyKey((k) => k + 1)
    } else {
      setLines((prev) => [...prev, `$ ${trimmed}`])
      setView('log')
      const { runId: newRunId } = await window.shovel.command.run(projectId, trimmed)
      beginRun(newRunId, false)
    }
    // ピン留め済みのコマンドはピン側の位置のまま動かさない（main の push と同じ規則）。
    setHistory((prev) =>
      prev.pinned.includes(trimmed)
        ? prev
        : { ...prev, recent: [trimmed, ...prev.recent.filter((c) => c !== trimmed)].slice(0, HISTORY_LIMIT) }
    )
    setCommand('')
    historyIndexRef.current = -1
  }

  function beginRun(newRunId: string, tty: boolean): void {
    runIdRef.current = newRunId
    runIsTtyRef.current = tty
    setRunId(newRunId)
    const early = earlyRef.current.get(newRunId) ?? []
    earlyRef.current.clear()
    for (const event of early) handleRunEvent(event)
  }

  async function startTty(cols: number, rows: number): Promise<void> {
    const pending = pendingTtyCommandRef.current
    pendingTtyCommandRef.current = null
    if (!pending) return
    try {
      const { runId: newRunId } = await window.shovel.command.runTty(projectId, pending, cols, rows)
      beginRun(newRunId, true)
    } finally {
      setStarting(false)
    }
  }

  function sendTtyInput(data: string): void {
    if (runIdRef.current && runIsTtyRef.current) void window.shovel.command.sendInput(runIdRef.current, data)
  }

  function resizeTty(cols: number, rows: number): void {
    if (runIdRef.current && runIsTtyRef.current) void window.shovel.command.resizeTty(runIdRef.current, cols, rows)
  }

  /** 履歴のコマンドを入力欄に差し込む。 */
  function recall(index: number): void {
    if (historyIndexRef.current === -1) draftRef.current = command
    historyIndexRef.current = index
    setCommand(index === -1 ? draftRef.current : (history[index] ?? ''))
  }

  function handleCommandKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      void run()
    } else if (e.key === 'ArrowUp') {
      if (history.length === 0) return
      e.preventDefault()
      recall(Math.min(historyIndexRef.current + 1, history.length - 1))
    } else if (e.key === 'ArrowDown') {
      if (historyIndexRef.current === -1) return
      e.preventDefault()
      recall(historyIndexRef.current - 1)
    }
  }

  function insertFromHistory(entry: string): void {
    historyIndexRef.current = -1
    setCommand(entry)
    inputRef.current?.focus()
  }

  async function removeFromHistory(entry: string): Promise<void> {
    historyIndexRef.current = -1
    setHistory(await window.shovel.command.removeHistory(projectId, entry))
  }

  async function pinEntry(entry: string): Promise<void> {
    historyIndexRef.current = -1
    setHistory(await window.shovel.command.pin(projectId, entry))
  }

  async function unpinEntry(entry: string): Promise<void> {
    historyIndexRef.current = -1
    setHistory(await window.shovel.command.unpin(projectId, entry))
  }

  async function sendStdin(): Promise<void> {
    if (!runId || !stdin) return
    await window.shovel.command.sendInput(runId, stdin + '\n')
    setLines((prev) => [...prev, `> ${stdin}`])
    setStdin('')
  }

  return (
    <div className="flex h-full flex-col border-t-2 border-border">
      {/* 見出しバー */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-2 py-1 text-xs">
        <SquareTerminal size={14} className="shrink-0 text-muted-foreground" />
        <span className="font-medium" title={t('commands.hint')}>
          {t('commands.title')}
        </span>
        <span title={t('commands.hint')} className="text-muted-foreground">
          <Info size={12} />
        </span>
        <div className="flex-1" />
        <button
          className={cn(
            'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground',
            historyOpen && 'bg-accent text-foreground'
          )}
          onClick={() => setHistoryOpen((v) => !v)}
        >
          <History size={12} />
          {t('commands.history')}
        </button>
        <button
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t('commands.close')}
          aria-label={t('commands.close')}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* 出力と入力をまとめたターミナル風の面。 */}
        <div
          className="flex min-w-0 flex-1 flex-col bg-terminal font-mono text-xs text-terminal-foreground"
          onClick={(e) => {
            // 出力を選択していないときだけ、面のどこをクリックしても入力欄へ。
            if (!window.getSelection()?.toString() && e.target === e.currentTarget) inputRef.current?.focus()
          }}
        >
          {view === 'tty' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {ttyUnavailable && (
                <div className="flex shrink-0 items-center gap-2 border-b border-white/15 px-2 py-1.5 font-sans">
                  <span className="min-w-0 flex-1">{t('commands.ttyUnavailable')}</span>
                  <button
                    className="shrink-0 rounded-md border border-white/30 px-2 py-0.5 hover:bg-white/10"
                    onClick={() => void window.shovel.projects.openTerminal(projectId)}
                  >
                    {t('commands.openOsTerminal')}
                  </button>
                </div>
              )}
              <div className="min-h-0 flex-1 px-2 pt-2">
                <TtyTerminal
                  key={ttyKey}
                  ref={termRef}
                  onReady={(cols, rows) => void startTty(cols, rows)}
                  onData={sendTtyInput}
                  onResize={resizeTty}
                />
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2">
              {lines.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {line}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
          {/* 入力フォーム */}
          <div className="flex shrink-0 items-center gap-2 border-t border-white/15 p-2">
            {runId && runIsTtyRef.current ? (
              <div className="min-w-0 flex-1 truncate px-2 py-1.5 font-sans text-terminal-muted">
                {t('commands.ttyRunning')}
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/20 bg-white/5 px-2 py-1.5 focus-within:border-white/50">
                <span className="select-none text-terminal-muted">{runId ? '>' : '$'}</span>
                {runId ? (
                  <input
                    ref={inputRef}
                    className="min-w-0 flex-1 bg-transparent outline-hidden placeholder:text-terminal-muted"
                    value={stdin}
                    placeholder={t('commands.stdinPlaceholder')}
                    onChange={(e) => setStdin(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendStdin()
                    }}
                  />
                ) : (
                  <input
                    ref={inputRef}
                    className="min-w-0 flex-1 bg-transparent outline-hidden placeholder:text-terminal-muted"
                    value={command}
                    placeholder={t('commands.placeholder')}
                    onChange={(e) => {
                      historyIndexRef.current = -1
                      setCommand(e.target.value)
                    }}
                    onKeyDown={handleCommandKeyDown}
                  />
                )}
              </div>
            )}
            {!runId && (
              <button
                className={cn(
                  'shrink-0 rounded-md border px-2 py-1.5 font-sans',
                  ttyMode
                    ? 'border-terminal-foreground bg-terminal-foreground/15 text-terminal-foreground'
                    : 'border-white/20 text-terminal-muted hover:text-terminal-foreground'
                )}
                title={t('commands.ttyModeHint')}
                aria-pressed={ttyMode}
                onClick={() => {
                  setTtyMode((v) => !v)
                  inputRef.current?.focus()
                }}
              >
                TTY
              </button>
            )}
            {runId ? (
              <button
                className="shrink-0 rounded-md bg-destructive px-3 py-1.5 font-sans text-destructive-foreground hover:bg-destructive/90"
                onClick={() => void window.shovel.command.cancel(runId)}
              >
                {t('commands.cancel')}
              </button>
            ) : (
              <button
                className="shrink-0 rounded-md bg-terminal-foreground px-3 py-1.5 font-sans text-terminal hover:bg-terminal-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!command.trim() || starting}
                onClick={() => void run()}
              >
                {t('commands.run')}
              </button>
            )}
          </div>
        </div>
        {historyOpen && (
          <div className="flex w-56 shrink-0 flex-col border-l border-border">
            <div className="truncate border-b border-border px-2 py-1 text-[11px] text-muted-foreground">
              {t('commands.historyHint')}
            </div>
            <ul className="flex-1 overflow-y-auto p-1">
              {pinned.map((entry) => (
                <li key={`pinned:${entry}`} className="flex items-center rounded hover:bg-accent">
                  <button
                    className="min-w-0 flex-1 truncate px-1.5 py-0.5 text-left font-mono text-xs"
                    title={entry}
                    onClick={() => insertFromHistory(entry)}
                  >
                    {entry}
                  </button>
                  {/* ピン留め中は削除させず、外すだけ（外すと履歴の先頭に戻る）。 */}
                  <button
                    className="mr-1 shrink-0 rounded p-0.5 text-foreground hover:text-muted-foreground"
                    title={t('commands.unpin')}
                    aria-label={t('commands.unpin')}
                    onClick={() => void unpinEntry(entry)}
                  >
                    <Pin size={12} className="fill-current" />
                  </button>
                </li>
              ))}
              {pinned.length > 0 && <li role="separator" className="mx-1 my-1 border-t border-border" />}
              {history.map((entry) => (
                <li key={entry} className="group/history flex items-center rounded hover:bg-accent">
                  <button
                    className="min-w-0 flex-1 truncate px-1.5 py-0.5 text-left font-mono text-xs"
                    title={entry}
                    onClick={() => insertFromHistory(entry)}
                  >
                    {entry}
                  </button>
                  <button
                    className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 disabled:hover:text-muted-foreground group-hover/history:opacity-100 group-hover/history:disabled:opacity-40"
                    title={pinned.length >= PINNED_LIMIT ? t('commands.pinLimit', { count: PINNED_LIMIT }) : t('commands.pin')}
                    aria-label={t('commands.pin')}
                    disabled={pinned.length >= PINNED_LIMIT}
                    onClick={() => void pinEntry(entry)}
                  >
                    <Pin size={12} />
                  </button>
                  {/* 確認なしで即座に消す。 */}
                  <button
                    className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover/history:opacity-100"
                    title={t('commands.removeHistory')}
                    aria-label={t('commands.removeHistory')}
                    onClick={() => void removeFromHistory(entry)}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
              {history.length === 0 && pinned.length === 0 && (
                <li className="px-1.5 py-0.5 text-xs text-muted-foreground">{t('commands.historyEmpty')}</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

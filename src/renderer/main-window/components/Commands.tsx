import { useEffect, useRef, useState } from 'react'
import { History, Info, SquareTerminal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CommandExit, CommandOutputChunk } from '@shared/types/command'
import { cn } from '../../shared/lib/utils'

const MAX_LINES = 2000
/** decisions.md N-4「履歴の持ち方」: 最新20件（main 側の保存と同じ上限）。 */
const HISTORY_LIMIT = 20

/**
 * ui.md §12 / decisions.md N-4: TTY なしの対話コンソール。`vim` 等の全画面
 * アプリは動かない。`\r` で上書きされる進捗行は1行として畳み、出力行数には
 * 上限を設ける。
 *
 * 履歴（decisions.md N-4「履歴の持ち方」/ ui.md §11）: プロジェクト単位・
 * コマンド文字列のみ・MRU・最新20件。↑↓キーでの呼び戻しと、ドロワー右側の
 * 履歴一覧を併用する。どちらも入力欄に差し込むだけで、実行はユーザーが
 * 改めて Enter／実行ボタンを押すまで行わない。
 */
export function Commands({ projectId, onClose }: { projectId: string; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [stdin, setStdin] = useState('')
  const [historyOpen, setHistoryOpen] = useState(true)
  const pendingRef = useRef('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** ↑↓で辿っている履歴の位置。-1 は「履歴を辿っていない（下書き）」。 */
  const historyIndexRef = useRef(-1)
  /** 履歴を辿り始める前に入力欄にあった下書き。↓で戻ってきたときに戻す。 */
  const draftRef = useRef('')
  /**
   * 実行中の runId。購読側からは state ではなくこちらを見る: すぐ終わる
   * コマンドは `command.run` の応答（=runId が分かる）より前、あるいは
   * 再描画より前に出力・終了を送ってくることがあり、state で判定すると
   * それを取りこぼして「実行中」のまま固まる。
   */
  const runIdRef = useRef<string | null>(null)
  /** runId が分かる前に届いた出力・終了。分かった時点で流し込む。 */
  const earlyRef = useRef(new Map<string, Array<CommandOutputChunk | CommandExit>>())

  useEffect(() => {
    void window.shovel.command.history(projectId).then(setHistory)
  }, [projectId])

  function handleRunEvent(event: CommandOutputChunk | CommandExit): void {
    if ('text' in event) {
      appendText(event.text)
      return
    }
    setLines((prev) => [...prev, `[exit ${event.code ?? '?'}]`])
    runIdRef.current = null
    setRunId(null)
  }

  useEffect(() => {
    const route = (event: CommandOutputChunk | CommandExit): void => {
      if (event.runId === runIdRef.current) {
        handleRunEvent(event)
        return
      }
      // 自分がまだ runId を知らない実行のものかもしれない（他のウィンドウの
      // 実行の分も混ざるが、どの runId も一度しか使われないので無害）。
      const early = earlyRef.current.get(event.runId) ?? []
      early.push(event)
      earlyRef.current.set(event.runId, early)
    }
    const offOutput = window.shovel.command.onOutput(route)
    const offExit = window.shovel.command.onExit(route)
    return () => {
      offOutput()
      offExit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lines])

  // 実行の開始・終了で入力欄（`$` ⇔ `>`）が入れ替わるので、フォーカスを移し直す。
  useEffect(() => {
    inputRef.current?.focus()
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
    if (!trimmed || runId) return
    setLines((prev) => [...prev, `$ ${trimmed}`])
    pendingRef.current = ''
    const { runId: newRunId } = await window.shovel.command.run(projectId, trimmed)
    runIdRef.current = newRunId
    setRunId(newRunId)
    const early = earlyRef.current.get(newRunId) ?? []
    earlyRef.current.clear()
    for (const event of early) handleRunEvent(event)
    setHistory((prev) => [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, HISTORY_LIMIT))
    setCommand('')
    historyIndexRef.current = -1
  }

  /** 入力欄を書き換えるだけ。実行はしない（decisions.md N-4）。 */
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

  async function sendStdin(): Promise<void> {
    if (!runId || !stdin) return
    await window.shovel.command.sendInput(runId, stdin + '\n')
    setLines((prev) => [...prev, `> ${stdin}`])
    setStdin('')
  }

  return (
    <div className="flex h-full flex-col border-t-2 border-border">
      {/* 見出しバー: チャット（上）とコンソールの境目をはっきりさせる。 */}
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
        {/* 出力と入力を1つのターミナル風の面にまとめる（入力は出力の続きに打つ）。 */}
        <div
          className="flex min-w-0 flex-1 flex-col bg-terminal font-mono text-xs text-terminal-foreground"
          onClick={(e) => {
            // 出力を選択していないときだけ、面のどこをクリックしても入力欄へ。
            if (!window.getSelection()?.toString() && e.target === e.currentTarget) inputRef.current?.focus()
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2">
            {lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {line}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          {/* 入力はフォームとして見せる（出力との間に線を引き、枠のある入力欄にする）。 */}
          <div className="flex shrink-0 items-center gap-2 border-t border-white/15 p-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/20 bg-white/5 px-2 py-1.5 focus-within:border-white/50">
              <span className="select-none text-terminal-muted">{runId ? '>' : '$'}</span>
              {runId ? (
                <input
                  ref={inputRef}
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-terminal-muted"
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
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-terminal-muted"
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
                disabled={!command.trim()}
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
              {history.map((entry) => (
                <li key={entry} className="group/history flex items-center rounded hover:bg-accent">
                  <button
                    className="min-w-0 flex-1 truncate px-1.5 py-0.5 text-left font-mono text-xs"
                    title={entry}
                    onClick={() => insertFromHistory(entry)}
                  >
                    {entry}
                  </button>
                  {/* 打ち間違いも残ってしまうので、確認なしで即座に消せるようにする。 */}
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
              {history.length === 0 && (
                <li className="px-1.5 py-0.5 text-xs text-muted-foreground">{t('commands.historyEmpty')}</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

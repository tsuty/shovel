import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommandExit, CommandOutputChunk } from '@shared/types/command'
import { Button } from '../../shared/components/ui/button'
import { Input } from '../../shared/components/ui/input'

const MAX_LINES = 2000

/**
 * ui.md §12 / decisions.md N-4: TTY なしの対話コンソール。`vim` 等の全画面
 * アプリは動かない。`\r` で上書きされる進捗行は1行として畳み、出力行数には
 * 上限を設ける。
 */
export function Commands({ projectId }: { projectId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [stdin, setStdin] = useState('')
  const pendingRef = useRef('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.shovel.command.history(projectId).then(setHistory)
  }, [projectId])

  useEffect(() => {
    const offOutput = window.shovel.command.onOutput((chunk: CommandOutputChunk) => {
      if (chunk.runId !== runId) return
      appendText(chunk.text)
    })
    const offExit = window.shovel.command.onExit((exit: CommandExit) => {
      if (exit.runId !== runId) return
      setLines((prev) => [...prev, `[exit ${exit.code ?? '?'}]`])
      setRunId(null)
    })
    return () => {
      offOutput()
      offExit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lines])

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
    setRunId(newRunId)
    setHistory((prev) => [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, 100))
    setCommand('')
  }

  async function sendStdin(): Promise<void> {
    if (!runId || !stdin) return
    await window.shovel.command.sendInput(runId, stdin + '\n')
    setLines((prev) => [...prev, `> ${stdin}`])
    setStdin('')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-2 py-1 text-xs text-muted-foreground">
        {t('commands.hint')}
      </div>
      <div className="flex-1 overflow-y-auto bg-muted/20 p-2 font-mono text-xs">
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap">
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex items-center gap-2 border-t border-border p-2">
        <Input
          list="command-history"
          value={command}
          placeholder={t('commands.placeholder')}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
        />
        <datalist id="command-history">
          {history.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {runId ? (
          <Button variant="destructive" size="sm" onClick={() => void window.shovel.command.cancel(runId)}>
            {t('commands.cancel')}
          </Button>
        ) : (
          <Button size="sm" disabled={!command.trim()} onClick={() => void run()}>
            {t('commands.run')}
          </Button>
        )}
      </div>
      {runId && (
        <div className="flex items-center gap-2 border-t border-border p-2">
          <Input
            value={stdin}
            placeholder={t('commands.stdinPlaceholder')}
            onChange={(e) => setStdin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendStdin()
            }}
          />
          <Button size="sm" variant="outline" onClick={() => void sendStdin()}>
            {t('commands.sendInput')}
          </Button>
        </div>
      )}
    </div>
  )
}

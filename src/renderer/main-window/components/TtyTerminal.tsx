import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export interface TtyTerminalHandle {
  write(data: Uint8Array | string): void
  focus(): void
}

interface Props {
  /** マウント後、最初に大きさを合わせたときに1度だけ呼ぶ。 */
  onReady: (cols: number, rows: number) => void
  /** キー入力（xterm.js が作ったバイト列）。 */
  onData: (data: string) => void
  onResize: (cols: number, rows: number) => void
}

/** 端末の行数を越えて遡れる行数。 */
const SCROLLBACK = 5000

/** コマンド実行の TTY モードの端末。表示とキー入力の変換だけを受け持ち、PTY はサンドボックス側にある。 */
export const TtyTerminal = forwardRef<TtyTerminalHandle, Props>(function TtyTerminal(
  { onReady, onData, onResize },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const callbacksRef = useRef({ onReady, onData, onResize })
  callbacksRef.current = { onReady, onData, onResize }

  useImperativeHandle(ref, () => ({
    write: (data) => termRef.current?.write(data),
    focus: () => termRef.current?.focus()
  }))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const term = new Terminal({
      theme: themeFrom(container),
      fontFamily: getComputedStyle(container).fontFamily,
      fontSize: 12,
      scrollback: SCROLLBACK,
      // OSC 8 のリンクは開かない。
      linkHandler: { activate: () => {} }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    termRef.current = term

    const dataSub = term.onData((data) => callbacksRef.current.onData(data))
    const resizeSub = term.onResize(({ cols, rows }) => callbacksRef.current.onResize(cols, rows))

    fit.fit()
    callbacksRef.current.onReady(term.cols, term.rows)

    const resizeObserver = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit()
    })
    resizeObserver.observe(container)

    // テーマの切り替え（<html> の class）に色を合わせる。
    const themeObserver = new MutationObserver(() => {
      term.options.theme = themeFrom(container)
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })

    return () => {
      themeObserver.disconnect()
      resizeObserver.disconnect()
      dataSub.dispose()
      resizeSub.dispose()
      term.dispose()
      termRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="h-full w-full bg-terminal font-mono text-terminal-foreground" />
})

function themeFrom(el: HTMLElement): ITheme {
  const style = getComputedStyle(el)
  const root = getComputedStyle(document.documentElement)
  return {
    background: style.backgroundColor,
    // ANSI の黒（色番号0）を地の色として明示するアプリが、周りと違う色の箱にならないようにする。
    black: style.backgroundColor,
    foreground: style.color,
    cursor: style.color,
    selectionBackground: `hsl(${root.getPropertyValue('--terminal-muted').trim()} / 0.4)`
  }
}

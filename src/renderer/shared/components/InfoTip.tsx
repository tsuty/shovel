import { useState } from 'react'
import { Info } from 'lucide-react'

/**
 * ⓘ アイコンと、ホバー／フォーカスで出る説明。普段は要らない補足を画面に出しっぱなしにしないために使う。
 *
 * ネイティブの `title` は、モーダルのダイアログの中などで出ないことがあるので使わず、自前で描く。
 * Tailwind の `group-hover` も `(hover: hover)` の環境でしか効かないので、出し入れは state で持つ。
 * 改行（`\n`）はそのまま改行として出す。
 */
export function InfoTip({ text, size = 12 }: { text: string; size?: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span
      className="relative inline-flex text-muted-foreground"
      tabIndex={0}
      aria-label={text}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <Info size={size} />
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-50 mt-1 w-max max-w-xs whitespace-pre-line rounded-md border bg-popover px-2 py-1.5 text-xs font-normal text-popover-foreground shadow-md"
        >
          {text}
        </span>
      )}
    </span>
  )
}

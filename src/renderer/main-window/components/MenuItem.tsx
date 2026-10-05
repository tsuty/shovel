import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../shared/lib/utils'

/** 右クリックメニューの1項目（ファイラー・チャット履歴パネル共通）。アイコンは任意。 */
export function MenuItem({
  children,
  icon,
  disabled,
  onClick
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <span className="flex w-4 shrink-0 justify-center text-muted-foreground">{icon}</span>}
      {children}
    </button>
  )
}

/**
 * 右クリックメニューの入れ子。ホバー（またはクリック）で右に子メニューを開く。
 * 右側に入りきらないときは左に開く。
 */
export function SubMenu({
  label,
  icon,
  children
}: {
  label: React.ReactNode
  icon?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [openLeft, setOpenLeft] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !rowRef.current || !panelRef.current) return
    const row = rowRef.current.getBoundingClientRect()
    setOpenLeft(row.right + panelRef.current.offsetWidth > window.innerWidth)
  }, [open])

  return (
    <div ref={rowRef} className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent"
        onClick={() => setOpen(true)}
      >
        {icon && <span className="flex w-4 shrink-0 justify-center text-muted-foreground">{icon}</span>}
        <span className="flex-1">{label}</span>
        <ChevronRight size={14} className="text-muted-foreground" />
      </button>
      {open && (
        <div
          ref={panelRef}
          className={cn(
            'absolute top-0 z-50 min-w-48 whitespace-nowrap rounded-md border bg-popover p-1 text-sm shadow-md',
            openLeft ? 'right-full' : 'left-full'
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

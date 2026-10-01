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

import { Info, type LucideIcon } from 'lucide-react'

/**
 * ⓘ アイコン（`icon` で差し替え可）。説明はホバーかキーボードでのフォーカスで出る（描くのは `TooltipLayer`）。
 * 改行（`\n`）はそのまま改行として出す。
 */
export function InfoTip({
  text,
  size = 12,
  icon: Icon = Info
}: {
  text: string
  size?: number
  icon?: LucideIcon
}): React.JSX.Element {
  return (
    <span className="inline-flex text-muted-foreground" tabIndex={0} title={text}>
      <Icon size={size} />
    </span>
  )
}

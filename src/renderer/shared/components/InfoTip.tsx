import { Info } from 'lucide-react'

/**
 * ⓘ アイコン。説明はホバーかキーボードでのフォーカスで出る（描くのは `TooltipLayer`）。
 * 改行（`\n`）はそのまま改行として出す。
 */
export function InfoTip({ text, size = 12 }: { text: string; size?: number }): React.JSX.Element {
  return (
    <span className="inline-flex text-muted-foreground" tabIndex={0} title={text}>
      <Info size={size} />
    </span>
  )
}

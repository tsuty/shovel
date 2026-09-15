import { Shovel } from 'lucide-react'
import { cn } from '../lib/utils'

/** ui.md §3 Header「アプリアイコン」。シャベル(shovel)そのものを意匠にする。 */
export function AppLogo({ size = 22, className }: { size?: number; className?: string }): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground',
        className
      )}
      style={{ width: size, height: size }}
    >
      <Shovel size={Math.round(size * 0.62)} strokeWidth={2.25} />
    </div>
  )
}

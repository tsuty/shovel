import { ShovelIcon } from './icons/ShovelIcon'
import { cn } from '../lib/utils'

/** ヘッダーのアプリアイコン。ShovelIcon を bg-primary の色付きボックスに乗せて表示する。 */
export function AppLogo({ size = 32, className }: { size?: number; className?: string }): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground',
        className
      )}
      style={{ width: size, height: size }}
    >
      <ShovelIcon size={Math.round(size * 0.85)} />
    </div>
  )
}

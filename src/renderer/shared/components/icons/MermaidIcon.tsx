/**
 * Mermaid の公式ロゴ（simple-icons 16.33.0 の `mermaid.svg`、CC0-1.0。元は
 * mermaid-js/mermaid の docs/public/mermaid-logo.svg）。lucide-react のアイコンと
 * 同じ流儀（`currentColor` 塗り・`size` props）で使う。
 */
export const MERMAID_BRAND_COLOR = '#FF3670'

export function MermaidIcon({ size = 16, className }: { size?: number; className?: string }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M23.99 2.115A12.223 12.223 0 0 0 12 10.149 12.223 12.223 0 0 0 .01 2.115a12.23 12.23 0 0 0 5.32 10.604 6.562 6.562 0 0 1 2.845 5.423v3.754h7.65v-3.754a6.561 6.561 0 0 1 2.844-5.423 12.223 12.223 0 0 0 5.32-10.604Z" />
    </svg>
  )
}

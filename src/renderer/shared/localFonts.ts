import { quoteFontFamily, uniqueFamilies } from '@shared/fontFamily'

/** 書体の選択肢。`source` はインストール済みフォントの一覧（`system`）か、主なフォントの候補（`preset`）か。 */
export interface FontChoices {
  /** すべてのファミリー（プレビュー用）。 */
  all: string[]
  /** 等幅のファミリーだけ（エディタ用）。 */
  monospace: string[]
  /** `monospace` のうち、エディタで和文が英字のちょうど2倍幅になるもの。 */
  cjkAligned: string[]
  source: 'system' | 'preset'
}

/** `queryLocalFonts()` が使えないときの候補。インストールされているものだけを出す。 */
const PRESET_FAMILIES = [
  // 等幅
  'SF Mono',
  'Menlo',
  'Monaco',
  'Osaka-Mono',
  'Consolas',
  'Cascadia Code',
  'Cascadia Mono',
  'Courier New',
  'MS Gothic',
  'BIZ UDGothic',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Ubuntu Mono',
  'Noto Sans Mono',
  'Noto Sans Mono CJK JP',
  'Source Code Pro',
  'JetBrains Mono',
  'Fira Code',
  'Hack',
  'HackGen',
  'HackGen Console',
  'HackGen35',
  'UDEV Gothic',
  'PlemolJP',
  'Myrica M',
  // プロポーショナル
  'Hiragino Sans',
  'Hiragino Kaku Gothic ProN',
  'Hiragino Mincho ProN',
  'Hiragino Maru Gothic ProN',
  'Yu Gothic',
  'Yu Gothic UI',
  'Yu Mincho',
  'Meiryo',
  'BIZ UDPGothic',
  'BIZ UDPMincho',
  'Noto Sans JP',
  'Noto Serif JP',
  'Noto Sans CJK JP',
  'Noto Serif CJK JP',
  'Segoe UI',
  'Helvetica Neue',
  'Helvetica',
  'Arial',
  'Verdana',
  'Georgia',
  'Times New Roman',
  'DejaVu Sans',
  'DejaVu Serif',
  'Liberation Sans',
  'Liberation Serif',
  'Ubuntu'
]

let cached: Promise<FontChoices> | null = null

/** 書体の選択肢を返す。ウィンドウごとに一度だけ調べる。 */
export function loadFontChoices(): Promise<FontChoices> {
  cached ??= collectFontChoices()
  return cached
}

async function collectFontChoices(): Promise<FontChoices> {
  const system = await querySystemFamilies()
  const families = system ?? uniqueFamilies(installedFamilies(PRESET_FAMILIES).map((family) => ({ family })))
  const monospace = monospaceFamilies(families)
  return { all: families, monospace, cjkAligned: cjkAlignedFamilies(monospace), source: system ? 'system' : 'preset' }
}

/** Local Font Access API でインストール済みのファミリー名を取る。使えない・拒否されたら `null`。 */
async function querySystemFamilies(): Promise<string[] | null> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
  if (typeof query !== 'function') return null
  try {
    const families = uniqueFamilies(await query.call(window))
    return families.length > 0 ? families : null
  } catch {
    return null
  }
}

/** `[font-family, 文字列]` の組ごとの幅を、画面外に隠した要素を並べて1回のレイアウトで測る。 */
function measureWidths(items: readonly (readonly [string, string])[]): number[] {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    fontSize: '14px',
    whiteSpace: 'pre'
  })
  const spans = items.map(([font, text]) => {
    const span = document.createElement('span')
    span.style.display = 'block'
    span.style.width = 'max-content'
    span.style.fontFamily = font
    span.textContent = text
    host.appendChild(span)
    return span
  })
  document.body.appendChild(host)
  const widths = spans.map((span) => span.getBoundingClientRect().width)
  host.remove()
  return widths
}

const INSTALLED_PROBE = 'mmmmmmmmmmlli10OWあ漢'
const GENERIC_FAMILIES = ['monospace', 'serif'] as const

/** 総称フォントだけのときと幅が変われば、そのフォントがあるとみなす（2つの総称フォントで確かめる）。 */
function installedFamilies(candidates: readonly string[]): string[] {
  const widths = measureWidths([
    ...GENERIC_FAMILIES.map((generic) => [generic, INSTALLED_PROBE] as const),
    ...candidates.flatMap((family) =>
      GENERIC_FAMILIES.map((generic) => [`${quoteFontFamily(family)}, ${generic}`, INSTALLED_PROBE] as const)
    )
  ])
  const base = GENERIC_FAMILIES.length
  return candidates.filter((_, i) =>
    GENERIC_FAMILIES.some((_, j) => widths[base + i * base + j] !== widths[j])
  )
}

const MONOSPACE_PROBES = ['iiiiiiiiii', 'WWWWWWWWWW', 'mmmmmmmmmm', '0000000000', '..........']

/**
 * 幅の違う英数字の並びが同じ幅になれば等幅とみなす。英字を持たないフォントはプロポーショナルな
 * `serif` で測られるので等幅にならない。
 */
function monospaceFamilies(families: readonly string[]): string[] {
  const n = MONOSPACE_PROBES.length
  const widths = measureWidths(
    families.flatMap((family) => MONOSPACE_PROBES.map((text) => [`${quoteFontFamily(family)}, serif`, text] as const))
  )
  return families.filter((_, i) => {
    const [first, ...rest] = widths.slice(i * n, (i + 1) * n)
    return first !== undefined && rest.every((width) => Math.abs(width - first) < 0.5)
  })
}

const HALF_WIDTH_PROBE = 'iiiiiiiiii'
const FULL_WIDTH_PROBE = 'あ漢ア字あ'

/**
 * エディタと同じ並び（`"名前", --font-mono`）で、和文1文字が英字2文字分の幅（1文字あたり 0.5px 未満の差）に
 * なるファミリーを返す。和文を持たないフォントは後ろの並びのフォントで和文を測ることになる。
 */
function cjkAlignedFamilies(families: readonly string[]): string[] {
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'
  const widths = measureWidths(
    families.flatMap((family) => {
      const font = `${quoteFontFamily(family)}, ${mono}`
      return [[font, HALF_WIDTH_PROBE] as const, [font, FULL_WIDTH_PROBE] as const]
    })
  )
  return families.filter((_, i) => {
    const half = widths[i * 2]
    const full = widths[i * 2 + 1]
    if (half === undefined || full === undefined) return false
    const halfChar = half / HALF_WIDTH_PROBE.length
    const fullChar = full / [...FULL_WIDTH_PROBE].length
    return Math.abs(fullChar - halfChar * 2) < 0.5
  })
}

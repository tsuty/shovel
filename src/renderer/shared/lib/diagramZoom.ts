/** 図の拡大率の計算（`MermaidViewer` から使う）。 */

/** 拡大率の決め方。`manual` は拡大・縮小・等倍の操作で決めた値をそのまま使う。 */
export type ZoomMode = 'fitWidth' | 'fitAll' | 'manual'

export interface Size {
  width: number
  height: number
}

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 8

/** 「拡大」「縮小」ボタンで順に移る拡大率。 */
const ZOOM_STEPS = [0.02, 0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8]

/** 比較の誤差。 */
const EPSILON = 1e-3

export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

/** `viewBox` 属性から図の本来の寸法を取る。読めなければ null。 */
export function parseViewBox(viewBox: string | null): Size | null {
  if (!viewBox) return null
  const parts = viewBox.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [, , width = 0, height = 0] = parts
  return width > 0 && height > 0 ? { width, height } : null
}

/** 表示領域に合わせたときの拡大率。本来の寸法より大きくはしない。 */
export function fitZoom(mode: 'fitWidth' | 'fitAll', natural: Size, box: Size): number {
  const byWidth = box.width / natural.width
  const scale = mode === 'fitWidth' ? byWidth : Math.min(byWidth, box.height / natural.height)
  return clampZoom(Math.min(1, scale))
}

/** 拡大（direction = 1）・縮小（-1）で次に移る拡大率。 */
export function stepZoom(current: number, direction: 1 | -1): number {
  const next =
    direction > 0
      ? ZOOM_STEPS.find((step) => step > current + EPSILON)
      : [...ZOOM_STEPS].reverse().find((step) => step < current - EPSILON)
  return next ?? (direction > 0 ? MAX_ZOOM : MIN_ZOOM)
}

/** Cmd/Ctrl＋ホイール・ピンチ1回分の拡大率。`deltaMode` が行・ページ単位なら画素に直す。 */
export function wheelZoom(current: number, deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  const limited = Math.max(-100, Math.min(100, pixels))
  return clampZoom(current * Math.exp(-limited * 0.002))
}

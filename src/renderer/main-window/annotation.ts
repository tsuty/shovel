/** 画像の注釈（`ImageAnnotator`）の図形・座標の計算と、編集の履歴。座標はすべて画像のピクセル単位。 */

export interface Point {
  x: number
  y: number
}

/** 2 点で決まる図形（矩形・楕円は対角の 2 点、矢印は根元と先端）。 */
export interface StrokeShape {
  id: string
  kind: 'rect' | 'ellipse' | 'arrow'
  from: Point
  to: Point
  color: string
  /** 線の太さ（px）。 */
  width: number
}

/** 文字。`at` は 1 行目の左上。 */
export interface TextShape {
  id: string
  kind: 'text'
  at: Point
  text: string
  color: string
  /** 文字の大きさ（px）。 */
  fontSize: number
}

export type Annotation = StrokeShape | TextShape

export type AnnotationTool = 'select' | StrokeShape['kind'] | 'text'

/** 矩形・楕円・文字の外接矩形。 */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** 色の候補。先頭が既定。 */
export const ANNOTATION_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#111827', '#ffffff'] as const

/** 線の太さの候補（細・中・太）。画像の大きさに応じて `annotationUnit` 倍する。 */
export const STROKE_WIDTHS = [2, 4, 8] as const

/** 文字の大きさの候補（小・中・大）。線の太さの候補と同じ位置のものを組にする。 */
export const FONT_SIZES = [16, 24, 36] as const

/** 文字の書体。画面（SVG）と保存（Canvas）で同じものを使う。 */
export const ANNOTATION_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif'

/** Canvas の `font` に渡す書体の指定。 */
export function annotationFont(fontSize: number): string {
  return `bold ${fontSize}px ${ANNOTATION_FONT_FAMILY}`
}

/** 行の高さ（文字の大きさに対する倍率）。 */
export const LINE_HEIGHT = 1.25

/** 1 行目の上端からベースラインまで（文字の大きさに対する倍率）。 */
const ASCENT = 0.92

/** これより短いドラッグ（画像のピクセル）は図形にしない。 */
const MIN_DRAG = 3

/**
 * 線の太さ・文字の大きさの倍率。大きい画像（高解像度の画面のスクリーンショットなど）でも、全体を表示したときの
 * 見た目の太さがおおむね揃うようにする。
 */
export function annotationUnit(width: number, height: number): number {
  return Math.max(1, Math.max(width, height) / 1200)
}

/** 2 点を対角とする矩形。 */
export function boxFromPoints(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/**
 * Shift を押しながら描くときの終点。矩形・楕円は正方形・正円に、矢印は 45° 刻みの向きにする。
 */
export function constrainPoint(kind: StrokeShape['kind'], from: Point, to: Point): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (kind === 'arrow') {
    const length = Math.hypot(dx, dy)
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
    return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length }
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: from.x + Math.sign(dx || 1) * side, y: from.y + Math.sign(dy || 1) * side }
}

/** 描き終えたドラッグを図形にしてよいか（短すぎるものは押し間違いとして捨てる）。 */
export function isDrawable(from: Point, to: Point): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= MIN_DRAG
}

/** 矢印の形。`shaftEnd` は軸の終わり（矢じりの付け根）、`head` は矢じりの三角形（先端・左・右）。 */
export interface ArrowGeometry {
  shaftEnd: Point
  head: [Point, Point, Point]
}

/**
 * 矢印の形。矢じりの長さは線の太さに比例させ、矢印が短いときは長さに収まるよう縮める。
 * 太い線の端が先端から突き出ないよう、軸は矢じりの付け根で止める。
 */
export function arrowGeometry(from: Point, to: Point, width: number): ArrowGeometry {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return { shaftEnd: to, head: [to, to, to] }
  const ux = dx / length
  const uy = dy / length
  const headLength = Math.min(Math.max(width * 4, 12), length)
  const halfWidth = headLength * 0.55
  const base = { x: to.x - ux * headLength, y: to.y - uy * headLength }
  return {
    shaftEnd: { x: to.x - ux * headLength * 0.8, y: to.y - uy * headLength * 0.8 },
    head: [
      to,
      { x: base.x - uy * halfWidth, y: base.y + ux * halfWidth },
      { x: base.x + uy * halfWidth, y: base.y - ux * halfWidth }
    ]
  }
}

/** 文字の行。 */
export function textLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/** `i` 行目のベースラインの y。 */
export function baselineY(shape: TextShape, i: number): number {
  return shape.at.y + shape.fontSize * (ASCENT + i * LINE_HEIGHT)
}

/** 文字の縁取りの太さ。 */
export function textOutlineWidth(fontSize: number): number {
  return Math.max(2, fontSize * 0.18)
}

/** 文字の縁取りの色。白い文字は黒で、それ以外は白で縁取る。 */
export function outlineColor(color: string): string {
  return color.toLowerCase() === '#ffffff' ? '#111827' : '#ffffff'
}

/** 1 行の文字の幅を測る関数（Canvas の `measureText` など）。 */
export type MeasureText = (line: string, fontSize: number) => number

/** 文字の外接矩形。 */
export function textBox(shape: TextShape, measure: MeasureText): Box {
  const lines = textLines(shape.text)
  const width = Math.max(0, ...lines.map((line) => measure(line, shape.fontSize)))
  return { x: shape.at.x, y: shape.at.y, width, height: shape.fontSize * LINE_HEIGHT * lines.length }
}

/** 点から線分までの距離。 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** 点から楕円の周までのおおよその距離（中心からの方向で周上の点を取る）。 */
function distanceToEllipse(p: Point, box: Box): number {
  const rx = box.width / 2
  const ry = box.height / 2
  const cx = box.x + rx
  const cy = box.y + ry
  if (rx === 0 || ry === 0) {
    return distanceToSegment(p, { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height })
  }
  const angle = Math.atan2((p.y - cy) / ry, (p.x - cx) / rx)
  return Math.hypot(p.x - (cx + rx * Math.cos(angle)), p.y - (cy + ry * Math.sin(angle)))
}

/** 点から矩形の辺までの距離。 */
function distanceToRectEdge(p: Point, box: Box): number {
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height }
  ]
  return Math.min(...corners.map((corner, i) => distanceToSegment(p, corner, corners[(i + 1) % 4]!)))
}

/**
 * 点が図形に当たっているか。矩形・楕円は線の上だけ（中の別の図形を選べるように）、矢印は軸か矢じり、
 * 文字は外接矩形の中。`tolerance` は線からの許容距離。
 */
export function hitTest(shape: Annotation, p: Point, tolerance: number, measure: MeasureText): boolean {
  if (shape.kind === 'text') {
    const box = textBox(shape, measure)
    return (
      p.x >= box.x - tolerance &&
      p.x <= box.x + box.width + tolerance &&
      p.y >= box.y - tolerance &&
      p.y <= box.y + box.height + tolerance
    )
  }
  const reach = tolerance + shape.width / 2
  if (shape.kind === 'arrow') return distanceToSegment(p, shape.from, shape.to) <= reach
  const box = boxFromPoints(shape.from, shape.to)
  return (shape.kind === 'rect' ? distanceToRectEdge(p, box) : distanceToEllipse(p, box)) <= reach
}

/** 点に当たっている一番手前の図形。 */
export function topmostHit(
  shapes: readonly Annotation[],
  p: Point,
  tolerance: number,
  measure: MeasureText
): Annotation | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]!
    if (hitTest(shape, p, tolerance, measure)) return shape
  }
  return null
}

/** 図形を `dx`・`dy` だけずらしたもの。 */
export function translateShape<T extends Annotation>(shape: T, dx: number, dy: number): T {
  if (shape.kind === 'text') return { ...shape, at: { x: shape.at.x + dx, y: shape.at.y + dy } }
  return {
    ...shape,
    from: { x: shape.from.x + dx, y: shape.from.y + dy },
    to: { x: shape.to.x + dx, y: shape.to.y + dy }
  }
}

/** 選択の枠に使う外接矩形（線の太さ・矢じりを含む）。 */
export function shapeBounds(shape: Annotation, measure: MeasureText): Box {
  if (shape.kind === 'text') return textBox(shape, measure)
  const box = boxFromPoints(shape.from, shape.to)
  const pad = shape.kind === 'arrow' ? Math.max(shape.width * 4, 12) * 0.55 : shape.width / 2
  return { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
}

/** 編集の履歴。`present` が今の図形の並び（後ろほど手前）。 */
export interface AnnotationHistory {
  past: Annotation[][]
  present: Annotation[]
  future: Annotation[][]
}

export const EMPTY_HISTORY: AnnotationHistory = { past: [], present: [], future: [] }

/** 図形の並びを `next` にする（やり直しの履歴は捨てる）。変わらなければそのまま返す。 */
export function commit(history: AnnotationHistory, next: Annotation[]): AnnotationHistory {
  if (next === history.present) return history
  return { past: [...history.past, history.present], present: next, future: [] }
}

export function undo(history: AnnotationHistory): AnnotationHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] }
}

export function redo(history: AnnotationHistory): AnnotationHistory {
  const next = history.future[0]
  if (!next) return history
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) }
}


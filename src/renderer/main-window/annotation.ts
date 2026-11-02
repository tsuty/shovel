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
  /** 線の種類。 */
  dash: LineStyle
}

/** 線の種類（CSS の `border-style` の solid / dashed / dotted に当たる）。 */
export type LineStyle = 'solid' | 'dashed' | 'dotted'

/** 線の種類の候補。先頭が既定。 */
export const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted']

/**
 * 線の種類の破線パターン（線の長さ・間隔の繰り返し。実線は空）。線端を丸くして描く前提で、丸い端が太さの分だけ
 * 伸びるのを見込む（点線は長さ 0 の線を丸い端で点にする）。
 */
export function dashPattern(style: LineStyle, width: number): number[] {
  if (style === 'dashed') return [width * 2, width * 3]
  if (style === 'dotted') return [0, width * 2]
  return []
}

/** 矩形の角の丸みの半径。線の太さに比例させ、矩形の短い辺の半分を超えない。 */
export function cornerRadius(width: number, box: Box): number {
  return Math.min(width * 2, box.width / 2, box.height / 2)
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

/** 範囲（対角の 2 点）の元の画像をモザイクにする。 */
export interface MosaicShape {
  id: string
  kind: 'mosaic'
  from: Point
  to: Point
  /** 細かさ（`MOSAIC_BLOCKS` の位置。0 が最も細かい）。 */
  level: number
}

/** 保存する範囲（対角の 2 点）。並びに 1 つまで。 */
export interface CropShape {
  id: string
  kind: 'crop'
  from: Point
  to: Point
}

/** 範囲を示す図形。 */
export type RegionShape = MosaicShape | CropShape

export type Annotation = StrokeShape | TextShape | RegionShape

/** ドラッグで描く図形。 */
export type DragShape = StrokeShape | RegionShape

export type AnnotationTool = 'select' | DragShape['kind'] | 'text'

/** 矩形・楕円・文字・範囲の外接矩形。 */
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
 * Shift を押しながら描くときの終点。矢印は 45° 刻みの向きに、それ以外は正方形（楕円は正円）にする。
 */
export function constrainPoint(kind: DragShape['kind'], from: Point, to: Point): Point {
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

/** 点が矩形の中（`margin` だけ広げた範囲）にあるか。 */
export function isInsideBox(p: Point, box: Box, margin = 0): boolean {
  return (
    p.x >= box.x - margin &&
    p.x <= box.x + box.width + margin &&
    p.y >= box.y - margin &&
    p.y <= box.y + box.height + margin
  )
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
 * 文字とモザイクは範囲の中。切り抜きは選ばない。`tolerance` は線からの許容距離。
 */
export function hitTest(shape: Annotation, p: Point, tolerance: number, measure: MeasureText): boolean {
  if (shape.kind === 'crop') return false
  if (shape.kind === 'text') return isInsideBox(p, textBox(shape, measure), tolerance)
  if (shape.kind === 'mosaic') return isInsideBox(p, boxFromPoints(shape.from, shape.to), tolerance)
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

/**
 * 大きさを変えるつまみ。矩形・楕円・モザイク・切り抜きは四隅と各辺の中点（方角で呼ぶ）、矢印は根元（`from`）と
 * 先端（`to`）。
 */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'from' | 'to'

/** 図形のつまみとその位置。文字にはつまみが無い（大きさはツールバーで変える）。 */
export function handlePoints(shape: Annotation): { handle: Handle; point: Point }[] {
  if (shape.kind === 'text') return []
  if (shape.kind === 'arrow') {
    return [
      { handle: 'from', point: shape.from },
      { handle: 'to', point: shape.to }
    ]
  }
  const { x, y, width, height } = boxFromPoints(shape.from, shape.to)
  const cx = x + width / 2
  const cy = y + height / 2
  return [
    { handle: 'nw', point: { x, y } },
    { handle: 'n', point: { x: cx, y } },
    { handle: 'ne', point: { x: x + width, y } },
    { handle: 'e', point: { x: x + width, y: cy } },
    { handle: 'se', point: { x: x + width, y: y + height } },
    { handle: 's', point: { x: cx, y: y + height } },
    { handle: 'sw', point: { x, y: y + height } },
    { handle: 'w', point: { x, y: cy } }
  ]
}

/** 点の近く（`tolerance` 以内）にあるつまみ。重なっていれば後ろのもの（矢印なら先端、矩形なら辺より後ろの隅）。 */
export function handleAt(shape: Annotation, p: Point, tolerance: number): Handle | null {
  let found: Handle | null = null
  for (const { handle, point } of handlePoints(shape)) {
    if (Math.abs(p.x - point.x) <= tolerance && Math.abs(p.y - point.y) <= tolerance) found = handle
  }
  return found
}

/**
 * つまみ `handle` を `p` まで動かした図形。矩形などは反対側の隅・辺を動かさず、矢印は反対の端を動かさない。
 * `constrain`（Shift）なら、隅のつまみは正方形に、矢印は 45° 刻みの向きにする。辺のつまみは幅か高さだけを変える。
 */
export function resizeShape<T extends Annotation>(shape: T, handle: Handle, p: Point, constrain: boolean): T {
  if (shape.kind === 'text') return shape
  if (shape.kind === 'arrow') {
    if (handle === 'from') return { ...shape, from: constrain ? constrainPoint('arrow', shape.to, p) : p }
    if (handle === 'to') return { ...shape, to: constrain ? constrainPoint('arrow', shape.from, p) : p }
    return shape
  }
  if (handle === 'from' || handle === 'to') return shape
  const box = boxFromPoints(shape.from, shape.to)
  let left = box.x
  let top = box.y
  let right = box.x + box.width
  let bottom = box.y + box.height
  if (handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw') {
    const anchor = { x: handle.includes('w') ? right : left, y: handle.includes('n') ? bottom : top }
    const corner = constrain ? constrainPoint(shape.kind, anchor, p) : p
    return { ...shape, from: anchor, to: corner }
  }
  if (handle === 'n') top = p.y
  else if (handle === 's') bottom = p.y
  else if (handle === 'w') left = p.x
  else right = p.x
  return { ...shape, from: { x: left, y: top }, to: { x: right, y: bottom } }
}

/** つまみの上でのポインタの形。 */
export function handleCursor(handle: Handle): string {
  if (handle === 'from' || handle === 'to') return 'crosshair'
  if (handle === 'n' || handle === 's') return 'ns-resize'
  if (handle === 'e' || handle === 'w') return 'ew-resize'
  return handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize'
}

/** 選択の枠に使う外接矩形（線の太さ・矢じりを含む）。 */
export function shapeBounds(shape: Annotation, measure: MeasureText): Box {
  if (shape.kind === 'text') return textBox(shape, measure)
  if (shape.kind === 'mosaic' || shape.kind === 'crop') return boxFromPoints(shape.from, shape.to)
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

/** 並びの中の切り抜き（無ければ null）。 */
export function findCrop(shapes: readonly Annotation[]): CropShape | null {
  return shapes.find((shape): shape is CropShape => shape.kind === 'crop') ?? null
}

/** 切り抜きを `crop` に置き換えた並び（null なら切り抜きを外す）。 */
export function replaceCrop(shapes: readonly Annotation[], crop: CropShape | null): Annotation[] {
  const rest = shapes.filter((shape) => shape.kind !== 'crop')
  return crop ? [...rest, crop] : rest
}

/** 描く順。モザイクは元の画像にかけるので先に描き、切り抜きは描かない。 */
export function drawOrder(shapes: readonly Annotation[]): Annotation[] {
  return [
    ...shapes.filter((shape) => shape.kind === 'mosaic'),
    ...shapes.filter((shape) => shape.kind !== 'mosaic' && shape.kind !== 'crop')
  ]
}

/**
 * 矩形を整数のピクセルにし、画像（`width` × `height`）の中に収める。`cover` は端数を外へ広げ（モザイクで元の画素を
 * 残さない）、`round` は四捨五入する（切り抜きを動かしても大きさが変わらない）。
 */
export function pixelBox(box: Box, width: number, height: number, mode: 'cover' | 'round' = 'cover'): Box {
  const x = Math.max(0, mode === 'cover' ? Math.floor(box.x) : Math.round(box.x))
  const y = Math.max(0, mode === 'cover' ? Math.floor(box.y) : Math.round(box.y))
  const right = Math.min(width, mode === 'cover' ? Math.ceil(box.x + box.width) : x + Math.round(box.width))
  const bottom = Math.min(height, mode === 'cover' ? Math.ceil(box.y + box.height) : y + Math.round(box.height))
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

/** 矩形の大きさを保ったまま、画像（`width` × `height`）の中に収まるようずらす量に直す。 */
export function clampOffset(box: Box, dx: number, dy: number, width: number, height: number): Point {
  return {
    x: Math.min(Math.max(dx, -box.x), width - box.x - box.width),
    y: Math.min(Math.max(dy, -box.y), height - box.y - box.height)
  }
}

/** モザイクの 1 マスの大きさの候補（細かい・普通・粗い）。画像の大きさに応じて `annotationUnit` 倍する。 */
export const MOSAIC_BLOCKS = [5, 8, 12] as const

/** モザイクの細かさの既定（普通）。 */
export const DEFAULT_MOSAIC_LEVEL = 1

/** 細かさ `level` のモザイクの 1 マスの大きさ（px）。 */
export function mosaicBlockSize(width: number, height: number, level: number): number {
  const base = MOSAIC_BLOCKS[Math.min(MOSAIC_BLOCKS.length - 1, Math.max(0, level))]!
  return Math.round(base * annotationUnit(width, height))
}

/**
 * 画像全体をモザイクにした画素（RGBA）。マスは画像の左上から `block` px ごとに区切り、各マスをその平均の色で
 * 塗る。どのモザイクの範囲も同じマス目を使うので、重なっても継ぎ目が出ない。
 */
export function pixelate(data: Uint8ClampedArray, width: number, height: number, block: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length)
  for (let top = 0; top < height; top += block) {
    const bottom = Math.min(height, top + block)
    for (let left = 0; left < width; left += block) {
      const right = Math.min(width, left + block)
      const sum = [0, 0, 0, 0]
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const i = (y * width + x) * 4
          for (let c = 0; c < 4; c++) sum[c]! += data[i + c]!
        }
      }
      const count = (bottom - top) * (right - left)
      const average = sum.map((value) => Math.round(value / count))
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          out.set(average, (y * width + x) * 4)
        }
      }
    }
  }
  return out
}

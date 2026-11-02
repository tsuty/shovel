import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Circle, Crop, Grid3x3, MousePointer2, MoveUpRight, Redo2, Square, Trash2, Type, Undo2, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../shared/components/ui/dialog'
import { Button } from '../../shared/components/ui/button'
import { ZoomableView } from '../../shared/components/ZoomableView'
import type { Size } from '../../shared/lib/zoom'
import { cn } from '../../shared/lib/utils'
import {
  ANNOTATION_COLORS,
  ANNOTATION_FONT_FAMILY,
  DEFAULT_MOSAIC_LEVEL,
  EMPTY_HISTORY,
  FONT_SIZES,
  LINE_HEIGHT,
  LINE_STYLES,
  MOSAIC_BLOCKS,
  STROKE_WIDTHS,
  annotationFont,
  annotationUnit,
  arrowGeometry,
  baselineY,
  boxFromPoints,
  clampOffset,
  commit,
  constrainPoint,
  cornerRadius,
  dashPattern,
  drawOrder,
  findCrop,
  handleAt,
  handleCursor,
  handlePoints,
  isDrawable,
  isInsideBox,
  mosaicBlockSize,
  outlineColor,
  pixelate,
  pixelBox,
  redo,
  replaceCrop,
  resizeShape,
  shapeBounds,
  textLines,
  textOutlineWidth,
  topmostHit,
  translateShape,
  undo,
  type Annotation,
  type AnnotationHistory,
  type AnnotationTool,
  type DragShape,
  type Handle,
  type LineStyle,
  type MeasureText,
  type Point,
  type CropShape,
  type StrokeShape,
  type TextShape
} from '../annotation'

/** 選択・当たり判定で許す、線からの距離（画面上の px）。 */
const HIT_TOLERANCE_PX = 6

/** 大きさを変えるつまみの一辺（画面上の px）。 */
const HANDLE_SIZE_PX = 9

/** 道具とそのキー。 */
const TOOLS: { tool: AnnotationTool; key: string; icon: React.ReactNode }[] = [
  { tool: 'select', key: 'v', icon: <MousePointer2 size={15} /> },
  { tool: 'rect', key: 'r', icon: <Square size={15} /> },
  { tool: 'ellipse', key: 'e', icon: <Circle size={15} /> },
  { tool: 'arrow', key: 'a', icon: <MoveUpRight size={15} /> },
  { tool: 'text', key: 't', icon: <Type size={15} /> },
  { tool: 'mosaic', key: 'm', icon: <Grid3x3 size={15} /> },
  { tool: 'crop', key: 'c', icon: <Crop size={15} /> }
]

/** 画像全体をある細かさでモザイクにしたもの。保存には `pixels` を、画面には `url` を使う。 */
interface MosaicSource {
  pixels: ImageData
  url: string
}

/** 入力中の文字。`id` は既存の文字を直しているときはその id。 */
interface EditingText {
  id: string
  existing: boolean
  at: Point
  text: string
  color: string
  fontSize: number
}

/** 図形を動かす・大きさを変えているときの、始めた点と動かす前の並び。`handle` があれば大きさを変えている。 */
interface MoveDrag {
  id: string
  start: Point
  base: Annotation[]
  handle?: Handle
}

type Source = { kind: 'loading' } | { kind: 'ready'; dataUrl: string } | { kind: 'error' }

/**
 * 画像に矩形・楕円・矢印・文字・モザイクの注釈を付け、必要なら切り抜いて、元の画像とは別の PNG として保存する
 * ダイアログ。
 * `attaching` なら保存のボタンを「保存して添付」にする（添付は呼び出し側が `onSaved` で行う）。
 */
export function ImageAnnotator({
  projectId,
  relPath,
  attaching,
  onCancel,
  onSaved
}: {
  projectId: string
  relPath: string
  attaching: boolean
  onCancel: () => void
  onSaved: (savedRelPath: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [source, setSource] = useState<Source>({ kind: 'loading' })
  const [natural, setNatural] = useState<Size | null>(null)
  const [tool, setTool] = useState<AnnotationTool>('rect')
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0])
  const [sizeIndex, setSizeIndex] = useState(1)
  const [history, setHistory] = useState<AnnotationHistory>(EMPTY_HISTORY)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DragShape | null>(null)
  const [mosaicLevel, setMosaicLevel] = useState(DEFAULT_MOSAIC_LEVEL)
  const [lineStyle, setLineStyle] = useState<LineStyle>(LINE_STYLES[0]!)
  const [moving, setMoving] = useState<Annotation[] | null>(null)
  /** ポインタの下にあるものに合わせたポインタの形（図形・つまみの上でなければ null）。 */
  const [hoverCursor, setHoverCursor] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingText | null>(null)
  const [scale, setScale] = useState(1)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const imgRef = useRef<HTMLImageElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const moveRef = useRef<MoveDrag | null>(null)
  /** 元の画像の画素。モザイクを作る元。 */
  const basePixelsRef = useRef<ImageData | null>(null)
  /** 作ったモザイク（1 マスの大きさごと）。 */
  const mosaicCacheRef = useRef(new Map<number, MosaicSource>())
  const editingRef = useRef(editing)
  editingRef.current = editing

  const measure = useMemo<MeasureText>(() => {
    const context = document.createElement('canvas').getContext('2d')
    return (line, fontSize) => {
      if (!context) return line.length * fontSize * 0.6
      context.font = annotationFont(fontSize)
      return context.measureText(line).width
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.shovel.fs
      .readFile(projectId, relPath)
      .then((result) => {
        if (cancelled) return
        const usable = result.kind === 'image' && !result.dataUrl.startsWith('data:image/svg+xml')
        setSource(usable ? { kind: 'ready', dataUrl: result.dataUrl } : { kind: 'error' })
      })
      .catch(() => {
        if (!cancelled) setSource({ kind: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, relPath])

  // 画面上の 1 画像ピクセルの大きさ。入力欄の位置・文字の大きさと、当たり判定の許容距離に使う。
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface || !natural) return
    const observer = new ResizeObserver(() => setScale(surface.clientWidth / natural.width))
    observer.observe(surface)
    return () => observer.disconnect()
  }, [natural])

  const editingKey = editing ? editing.id : null
  useEffect(() => {
    textareaRef.current?.focus()
  }, [editingKey])

  const unit = natural ? annotationUnit(natural.width, natural.height) : 1
  const strokeWidth = Math.round(STROKE_WIDTHS[sizeIndex]! * unit * 10) / 10
  const fontSize = Math.round(FONT_SIZES[sizeIndex]! * unit)
  const shapes = moving ?? history.present
  const selected = shapes.find((shape) => shape.id === selectedId) ?? null
  /** 太さのボタンをモザイクの細かさに使うか。 */
  const mosaicContext = tool === 'mosaic' || selected?.kind === 'mosaic'
  /** 線の種類が効くか（矩形・楕円・矢印を描く道具か、それらを選んでいるとき）。 */
  const lineStyleContext =
    tool === 'rect' ||
    tool === 'ellipse' ||
    tool === 'arrow' ||
    selected?.kind === 'rect' ||
    selected?.kind === 'ellipse' ||
    selected?.kind === 'arrow'

  /** 細かさ `level` で画像全体をモザイクにしたもの（初めて使うときに作って取っておく）。 */
  function mosaicFor(level: number): MosaicSource | null {
    const base = basePixelsRef.current
    if (!base) return null
    const block = mosaicBlockSize(base.width, base.height, level)
    let source = mosaicCacheRef.current.get(block)
    if (!source) {
      source = createMosaicSource(base, block)
      mosaicCacheRef.current.set(block, source)
    }
    return source
  }

  /** クライアント座標を画像のピクセル座標にする（画像の外は端に寄せる）。 */
  function toImagePoint(e: { clientX: number; clientY: number }): Point {
    const rect = svgRef.current!.getBoundingClientRect()
    const size = natural!
    const x = ((e.clientX - rect.left) / rect.width) * size.width
    const y = ((e.clientY - rect.top) / rect.height) * size.height
    return { x: Math.min(size.width, Math.max(0, x)), y: Math.min(size.height, Math.max(0, y)) }
  }

  /** 点が今の切り抜きの範囲の中にあれば、その切り抜き。 */
  function cropAt(p: Point): CropShape | null {
    const crop = findCrop(history.present)
    return crop && isInsideBox(p, boxFromPoints(crop.from, crop.to)) ? crop : null
  }

  /** 大きさを変えられる図形（選んでいる図形、切り抜きの道具なら切り抜き）のつまみのうち、点の近くにあるもの。 */
  function handleHitAt(p: Point): { shape: Annotation; handle: Handle } | null {
    const target =
      tool === 'select'
        ? history.present.find((shape) => shape.id === selectedId)
        : tool === 'crop'
          ? findCrop(history.present)
          : null
    if (!target) return null
    const handle = handleAt(target, p, (HANDLE_SIZE_PX / 2 + 3) / scale)
    return handle ? { shape: target, handle } : null
  }

  function hitAt(p: Point): Annotation | null {
    return topmostHit(history.present, p, HIT_TOLERANCE_PX / scale, measure)
  }

  function finishEditing(): void {
    const pending = editingRef.current
    if (!pending) return
    setHistory((current) => commitText(current, pending))
    editingRef.current = null
    setEditing(null)
  }

  function startEditing(shape: TextShape): void {
    setSelectedId(null)
    setEditing({ id: shape.id, existing: true, at: shape.at, text: shape.text, color: shape.color, fontSize: shape.fontSize })
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>): void {
    if (e.button !== 0 || !natural) return
    // 入力欄のフォーカスが外れないようにする（外すかどうかはここで決める）。
    e.preventDefault()
    if (editingRef.current) {
      finishEditing()
      return
    }
    const p = toImagePoint(e)
    const grabbed = handleHitAt(p)
    if (grabbed) {
      moveRef.current = { id: grabbed.shape.id, start: p, base: history.present, handle: grabbed.handle }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'select') {
      const hit = hitAt(p)
      setSelectedId(hit?.id ?? null)
      if (!hit) return
      if ('color' in hit) setColor(hit.color)
      if (hit.kind === 'mosaic') setMosaicLevel(hit.level)
      if ('dash' in hit) setLineStyle(hit.dash)
      const sizeIndexOfHit =
        hit.kind === 'text'
          ? FONT_SIZES.findIndex((size) => Math.round(size * unit) === hit.fontSize)
          : 'width' in hit
            ? STROKE_WIDTHS.findIndex((width) => Math.round(width * unit * 10) / 10 === hit.width)
            : -1
      if (sizeIndexOfHit !== -1) setSizeIndex(sizeIndexOfHit)
      moveRef.current = { id: hit.id, start: p, base: history.present }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'text') {
      const hit = hitAt(p)
      if (hit?.kind === 'text') {
        startEditing(hit)
        return
      }
      setEditing({
        id: crypto.randomUUID(),
        existing: false,
        at: { x: p.x, y: p.y - (fontSize * LINE_HEIGHT) / 2 },
        text: '',
        color,
        fontSize
      })
      return
    }
    setSelectedId(null)
    const crop = tool === 'crop' ? cropAt(p) : null
    if (crop) moveRef.current = { id: crop.id, start: p, base: history.present }
    else if (tool === 'crop') setDraft({ id: crypto.randomUUID(), kind: 'crop', from: p, to: p })
    else if (tool === 'mosaic') setDraft({ id: crypto.randomUUID(), kind: 'mosaic', from: p, to: p, level: mosaicLevel })
    else setDraft({ id: crypto.randomUUID(), kind: tool, from: p, to: p, color, width: strokeWidth, dash: lineStyle })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>): void {
    if (!natural) return
    const p = toImagePoint(e)
    if (draft) {
      setDraft({ ...draft, to: e.shiftKey ? constrainPoint(draft.kind, draft.from, p) : p })
      return
    }
    const drag = moveRef.current
    if (drag) {
      setMoving(
        drag.base.map((shape) => {
          if (shape.id !== drag.id) return shape
          if (drag.handle) return resizeShape(shape, drag.handle, p, e.shiftKey)
          const dx = p.x - drag.start.x
          const dy = p.y - drag.start.y
          if (shape.kind !== 'crop') return translateShape(shape, dx, dy)
          const offset = clampOffset(boxFromPoints(shape.from, shape.to), dx, dy, natural.width, natural.height)
          return translateShape(shape, offset.x, offset.y)
        })
      )
      return
    }
    const grabbed = handleHitAt(p)
    if (grabbed) setHoverCursor(handleCursor(grabbed.handle))
    else if (tool === 'select') setHoverCursor(hitAt(p) ? 'move' : null)
    else if (tool === 'crop') setHoverCursor(cropAt(p) ? 'move' : null)
    else setHoverCursor(null)
  }

  function onPointerUp(): void {
    if (draft) {
      if (isDrawable(draft.from, draft.to)) {
        setHistory((current) =>
          commit(current, draft.kind === 'crop' ? replaceCrop(current.present, draft) : [...current.present, draft])
        )
      }
      setDraft(null)
    }
    const drag = moveRef.current
    if (drag) {
      // 大きさを変えて潰れた（ほぼ点になった）ときは、変える前に戻す。
      const resized = drag.handle ? moving?.find((shape) => shape.id === drag.id) : undefined
      const collapsed = resized !== undefined && 'from' in resized && !isDrawable(resized.from, resized.to)
      if (moving && !collapsed) setHistory((current) => commit(current, moving))
      moveRef.current = null
      setMoving(null)
    }
  }

  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>): void {
    if (tool !== 'select' || !natural) return
    const hit = hitAt(toImagePoint(e))
    if (hit?.kind === 'text') startEditing(hit)
  }

  function changeTool(next: AnnotationTool): void {
    finishEditing()
    setTool(next)
    if (next !== 'select') setSelectedId(null)
  }

  /** 選んでいる図形の色・大きさを変える。 */
  function restyleSelected(update: (shape: Annotation) => Annotation): void {
    if (!selectedId) return
    setHistory((current) => commit(current, current.present.map((shape) => (shape.id === selectedId ? update(shape) : shape))))
  }

  function changeColor(next: string): void {
    setColor(next)
    if (editing) setEditing({ ...editing, color: next })
    restyleSelected((shape) => ('color' in shape ? { ...shape, color: next } : shape))
  }

  function changeSize(index: number): void {
    setSizeIndex(index)
    const nextFont = Math.round(FONT_SIZES[index]! * unit)
    const nextStroke = Math.round(STROKE_WIDTHS[index]! * unit * 10) / 10
    if (editing) setEditing({ ...editing, fontSize: nextFont })
    restyleSelected((shape) =>
      shape.kind === 'text' ? { ...shape, fontSize: nextFont } : 'width' in shape ? { ...shape, width: nextStroke } : shape
    )
  }

  function changeLineStyle(next: LineStyle): void {
    setLineStyle(next)
    restyleSelected((shape) => ('dash' in shape ? { ...shape, dash: next } : shape))
  }

  function changeMosaicLevel(level: number): void {
    setMosaicLevel(level)
    restyleSelected((shape) => (shape.kind === 'mosaic' ? { ...shape, level } : shape))
  }

  function deleteSelected(): void {
    if (!selectedId) return
    setHistory((current) => commit(current, current.present.filter((shape) => shape.id !== selectedId)))
    setSelectedId(null)
  }

  function removeCrop(): void {
    setHistory((current) => commit(current, replaceCrop(current.present, null)))
  }

  function onUndo(): void {
    finishEditing()
    setSelectedId(null)
    setHistory((current) => undo(current))
  }

  function onRedo(): void {
    finishEditing()
    setSelectedId(null)
    setHistory((current) => redo(current))
  }

  const finalShapes = (editing ? commitText(history, editing) : history).present
  const dirty = finalShapes.length > 0

  function requestClose(): void {
    if (saving) return
    if (dirty && !confirm(t('annotate.confirmDiscard'))) return
    onCancel()
  }

  async function save(): Promise<void> {
    const image = imgRef.current
    if (!image || !natural || !dirty || saving) return
    const shapesToSave = finalShapes
    finishEditing()
    setSaving(true)
    setSaveError(null)
    try {
      const png = await renderPng(image, natural, shapesToSave, (level) => {
        const source = mosaicFor(level)
        if (!source) throw new Error('mosaic is not ready')
        return source.pixels
      })
      onSaved(await window.shovel.fs.saveAnnotatedImage(projectId, relPath, png))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.target instanceof HTMLTextAreaElement) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        finishEditing()
      }
      return
    }
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    if (mod && key === 'z') {
      e.preventDefault()
      if (e.shiftKey) onRedo()
      else onUndo()
    } else if (mod && key === 'y') {
      e.preventDefault()
      onRedo()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault()
      deleteSelected()
    } else if (!mod && !e.altKey) {
      const match = TOOLS.find((entry) => entry.key === key)
      if (match) {
        e.preventDefault()
        changeTool(match.tool)
      }
    }
  }

  function onEscape(e: KeyboardEvent): void {
    e.preventDefault()
    if (editingRef.current) {
      if (editingRef.current.existing) finishEditing()
      else setEditing(null)
    } else if (selectedId) setSelectedId(null)
    else requestClose()
  }

  const displayed = draft ? [...shapes, draft] : shapes
  const crop = draft?.kind === 'crop' ? draft : findCrop(shapes)
  const cropSize = crop && natural ? pixelBox(boxFromPoints(crop.from, crop.to), natural.width, natural.height, 'round') : null
  const resizing = moveRef.current?.handle
  const cursor = resizing
    ? handleCursor(resizing)
    : moving
      ? 'grabbing'
      : (hoverCursor ?? (tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair'))
  /** つまみを出す図形。 */
  const resizable = editing
    ? null
    : tool === 'select'
      ? selected
      : tool === 'crop' && draft?.kind !== 'crop'
        ? findCrop(shapes)
        : null

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        className="flex h-[90vh] w-[94vw] max-w-none flex-col gap-0 overflow-hidden p-0 outline-none"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={onEscape}
        onKeyDown={onKeyDown}
      >
        <div className="flex flex-col gap-0.5 border-b border-border px-4 py-2.5 pr-12">
          <DialogTitle className="text-base">{t('annotate.title')}</DialogTitle>
          <DialogDescription className="truncate text-xs" title={relPath}>
            {relPath}
          </DialogDescription>
        </div>
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-1.5"
          onPointerDown={(e) => {
            // 入力中の文字のフォーカスを保つ（色・大きさを入力中の文字に効かせるため）。
            if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
          }}
        >
          <div className="flex items-center gap-0.5">
            {TOOLS.map((entry) => (
              <IconButton
                key={entry.tool}
                title={`${t(`annotate.tool.${entry.tool}`)} (${entry.key.toUpperCase()})`}
                active={tool === entry.tool}
                onClick={() => changeTool(entry.tool)}
              >
                {entry.icon}
              </IconButton>
            ))}
          </div>
          <Separator />
          <div className="flex items-center gap-1">
            {ANNOTATION_COLORS.map((candidate) => (
              <button
                key={candidate}
                className={cn(
                  'h-5 w-5 rounded-full border border-border',
                  color === candidate && 'ring-2 ring-ring ring-offset-1 ring-offset-background'
                )}
                style={{ backgroundColor: candidate }}
                title={t(`annotate.color.${candidate.slice(1)}`)}
                aria-label={t(`annotate.color.${candidate.slice(1)}`)}
                aria-pressed={color === candidate}
                onClick={() => changeColor(candidate)}
              />
            ))}
          </div>
          <Separator />
          <div className="flex items-center gap-0.5">
            {mosaicContext
              ? MOSAIC_BLOCKS.map((block, index) => (
                  <IconButton
                    key={block}
                    title={t(`annotate.mosaicSize.${index}`)}
                    active={mosaicLevel === index}
                    onClick={() => changeMosaicLevel(index)}
                  >
                    <MosaicLevelIcon cells={MOSAIC_BLOCKS.length + 2 - index} />
                  </IconButton>
                ))
              : STROKE_WIDTHS.map((width, index) => (
                  <IconButton
                    key={width}
                    title={t(`annotate.size.${index}`)}
                    active={sizeIndex === index}
                    onClick={() => changeSize(index)}
                  >
                    <span className="block w-3.5 rounded-full bg-current" style={{ height: width }} />
                  </IconButton>
                ))}
          </div>
          <Separator />
          <div className="flex items-center gap-0.5">
            {LINE_STYLES.map((style) => (
              <IconButton
                key={style}
                title={t(`annotate.lineStyle.${style}`)}
                active={lineStyleContext && lineStyle === style}
                disabled={!lineStyleContext}
                onClick={() => changeLineStyle(style)}
              >
                <LineStyleIcon style={style} />
              </IconButton>
            ))}
          </div>
          <Separator />
          <div className="flex items-center gap-0.5">
            <IconButton title={t('annotate.undo')} disabled={history.past.length === 0} onClick={onUndo}>
              <Undo2 size={15} />
            </IconButton>
            <IconButton title={t('annotate.redo')} disabled={history.future.length === 0} onClick={onRedo}>
              <Redo2 size={15} />
            </IconButton>
            <IconButton title={t('annotate.delete')} disabled={!selected} onClick={deleteSelected}>
              <Trash2 size={15} />
            </IconButton>
          </div>
          {cropSize && (
            <>
              <Separator />
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Crop size={13} />
                <span className="tabular-nums">
                  {cropSize.width} × {cropSize.height}
                </span>
                <IconButton title={t('annotate.removeCrop')} onClick={removeCrop}>
                  <X size={14} />
                </IconButton>
              </div>
            </>
          )}
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col bg-muted/40">
          {source.kind === 'error' ? (
            <p className="p-4 text-sm text-destructive">{t('annotate.cannotOpen')}</p>
          ) : (
            <ZoomableView
              natural={natural}
              initialMode="fitAll"
              pointerNavigation={false}
              placeholder={<p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
              className="flex-1"
            >
              {source.kind === 'ready' && (
                <div ref={surfaceRef} className="relative h-full w-full select-none">
                  <img
                    ref={imgRef}
                    src={source.dataUrl}
                    alt={relPath}
                    className="absolute inset-0 block h-full w-full"
                    draggable={false}
                    onLoad={(e) => {
                      const image = e.currentTarget
                      const { naturalWidth: width, naturalHeight: height } = image
                      if (width === 0 || height === 0) {
                        setSource({ kind: 'error' })
                        return
                      }
                      try {
                        basePixelsRef.current = readPixels(image, width, height)
                        mosaicCacheRef.current.clear()
                      } catch {
                        setSource({ kind: 'error' })
                        return
                      }
                      setNatural({ width, height })
                    }}
                    onError={() => setSource({ kind: 'error' })}
                  />
                  {natural && (
                    <svg
                      ref={svgRef}
                      className="absolute inset-0 h-full w-full touch-none"
                      viewBox={`0 0 ${natural.width} ${natural.height}`}
                      style={{ cursor }}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      onPointerLeave={() => setHoverCursor(null)}
                      onDoubleClick={onDoubleClick}
                    >
                      {drawOrder(displayed).map((shape) =>
                        shape.id === editing?.id ? null : (
                          <ShapeView
                            key={shape.id}
                            shape={shape}
                            natural={natural}
                            mosaicUrl={shape.kind === 'mosaic' ? (mosaicFor(shape.level)?.url ?? null) : null}
                          />
                        )
                      )}
                      {crop && <CropOverlay crop={crop} natural={natural} />}
                      {selected && !editing && <SelectionFrame shape={selected} measure={measure} />}
                      {resizable && <Handles shape={resizable} scale={scale} />}
                    </svg>
                  )}
                  {editing && (
                    <textarea
                      ref={textareaRef}
                      className="absolute m-0 resize-none overflow-hidden whitespace-pre border-0 bg-transparent p-0 outline-1 outline-dashed outline-sky-500"
                      style={
                        {
                          left: editing.at.x * scale,
                          top: editing.at.y * scale,
                          minWidth: editing.fontSize * scale,
                          fontFamily: ANNOTATION_FONT_FAMILY,
                          fontWeight: 'bold',
                          fontSize: editing.fontSize * scale,
                          lineHeight: LINE_HEIGHT,
                          color: editing.color,
                          WebkitTextStroke: `${textOutlineWidth(editing.fontSize) * scale}px ${outlineColor(editing.color)}`,
                          paintOrder: 'stroke fill',
                          fieldSizing: 'content'
                        }
                      }
                      value={editing.text}
                      rows={1}
                      spellCheck={false}
                      aria-label={t('annotate.tool.text')}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                      onBlur={finishEditing}
                    />
                  )}
                </div>
              )}
            </ZoomableView>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {saveError ? <span className="text-destructive">{t('annotate.saveFailed', { message: saveError })}</span> : t('annotate.hint')}
          </p>
          <Button variant="outline" size="sm" disabled={saving} onClick={requestClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!dirty || saving || !natural} onClick={() => void save()}>
            {attaching ? t('annotate.saveAndAttach') : t('annotate.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 入力中の文字 `pending` を確定した履歴。空なら、既存の文字は消し、新しい文字は作らない。 */
function commitText(current: AnnotationHistory, pending: EditingText): AnnotationHistory {
  const rest = current.present.filter((shape) => shape.id !== pending.id)
  if (!pending.text.trim()) return pending.existing ? commit(current, rest) : current
  const shape: TextShape = {
    id: pending.id,
    kind: 'text',
    at: pending.at,
    text: pending.text,
    color: pending.color,
    fontSize: pending.fontSize
  }
  const exists = rest.length !== current.present.length
  return commit(current, exists ? current.present.map((s) => (s.id === pending.id ? shape : s)) : [...current.present, shape])
}

function ShapeView({
  shape,
  natural,
  mosaicUrl
}: {
  shape: Annotation
  natural: Size
  /** モザイクのときの、その細かさで画像全体をモザイクにしたものの URL。作れていなければ null。 */
  mosaicUrl: string | null
}): React.JSX.Element | null {
  switch (shape.kind) {
    case 'crop':
      return null
    case 'mosaic': {
      const box = boxFromPoints(shape.from, shape.to)
      // 入れ子の svg で範囲の外を切り落とし、画像全体のモザイクのうち範囲の中だけを見せる。
      return mosaicUrl ? (
        <svg {...box} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} overflow="hidden">
          <image href={mosaicUrl} width={natural.width} height={natural.height} preserveAspectRatio="none" />
        </svg>
      ) : (
        <rect {...box} fill="#9ca3af" />
      )
    }
    case 'rect': {
      const box = boxFromPoints(shape.from, shape.to)
      return (
        <rect
          {...box}
          rx={cornerRadius(shape.width, box)}
          fill="none"
          stroke={shape.color}
          strokeWidth={shape.width}
          strokeDasharray={dashPattern(shape.dash, shape.width).join(' ') || undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
    }
    case 'ellipse': {
      const box = boxFromPoints(shape.from, shape.to)
      return (
        <ellipse
          cx={box.x + box.width / 2}
          cy={box.y + box.height / 2}
          rx={box.width / 2}
          ry={box.height / 2}
          fill="none"
          stroke={shape.color}
          strokeWidth={shape.width}
          strokeDasharray={dashPattern(shape.dash, shape.width).join(' ') || undefined}
          strokeLinecap="round"
        />
      )
    }
    case 'arrow': {
      const { shaftEnd, head } = arrowGeometry(shape.from, shape.to, shape.width)
      return (
        <g>
          <line
            x1={shape.from.x}
            y1={shape.from.y}
            x2={shaftEnd.x}
            y2={shaftEnd.y}
            stroke={shape.color}
            strokeWidth={shape.width}
            strokeDasharray={dashPattern(shape.dash, shape.width).join(' ') || undefined}
            strokeLinecap="round"
          />
          <polygon points={head.map((p) => `${p.x},${p.y}`).join(' ')} fill={shape.color} />
        </g>
      )
    }
    case 'text':
      return (
        <text
          fontFamily={ANNOTATION_FONT_FAMILY}
          fontWeight="bold"
          fontSize={shape.fontSize}
          fill={shape.color}
          stroke={outlineColor(shape.color)}
          strokeWidth={textOutlineWidth(shape.fontSize)}
          strokeLinejoin="round"
          paintOrder="stroke"
          style={{ whiteSpace: 'pre' }}
        >
          {textLines(shape.text).map((line, i) => (
            <tspan key={i} x={shape.at.x} y={baselineY(shape, i)}>
              {line}
            </tspan>
          ))}
        </text>
      )
  }
}

/** 切り抜きの範囲の外を暗くし、範囲に枠を付ける。 */
function CropOverlay({ crop, natural }: { crop: CropShape; natural: Size }): React.JSX.Element {
  const box = boxFromPoints(crop.from, crop.to)
  const outside =
    `M0 0H${natural.width}V${natural.height}H0Z` +
    `M${box.x} ${box.y}h${box.width}v${box.height}h${-box.width}Z`
  return (
    <g pointerEvents="none">
      <path d={outside} fill="rgba(0, 0, 0, 0.5)" fillRule="evenodd" />
      <rect {...box} fill="none" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
    </g>
  )
}

/** 大きさを変えるつまみ。画面上で一定の大きさにする。 */
function Handles({ shape, scale }: { shape: Annotation; scale: number }): React.JSX.Element {
  const size = HANDLE_SIZE_PX / scale
  return (
    <g pointerEvents="none">
      {handlePoints(shape).map(({ handle, point }) => (
        <rect
          key={handle}
          x={point.x - size / 2}
          y={point.y - size / 2}
          width={size}
          height={size}
          fill="#ffffff"
          stroke="#0ea5e9"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  )
}

function SelectionFrame({ shape, measure }: { shape: Annotation; measure: MeasureText }): React.JSX.Element {
  const box = shapeBounds(shape, measure)
  return (
    <rect
      {...box}
      fill="none"
      stroke="#0ea5e9"
      strokeWidth={1.5}
      strokeDasharray="5 4"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  )
}

/** 画像の画素を読む。 */
function readPixels(image: HTMLImageElement, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas is not available')
  ctx.drawImage(image, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

/** 画像全体を 1 マス `block` px でモザイクにしたものを作る。 */
function createMosaicSource(base: ImageData, block: number): MosaicSource {
  const canvas = document.createElement('canvas')
  canvas.width = base.width
  canvas.height = base.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas is not available')
  const pixels = ctx.createImageData(base.width, base.height)
  pixels.data.set(pixelate(base.data, base.width, base.height, block))
  ctx.putImageData(pixels, 0, 0)
  return { pixels, url: canvas.toDataURL('image/png') }
}

/** 画像に注釈を描き込み、切り抜きがあればその範囲だけにした PNG を作る。 */
async function renderPng(
  image: HTMLImageElement,
  size: Size,
  shapes: Annotation[],
  mosaicPixels: (level: number) => ImageData
): Promise<Uint8Array> {
  const full = document.createElement('canvas')
  full.width = size.width
  full.height = size.height
  const ctx = full.getContext('2d')
  if (!ctx) throw new Error('canvas is not available')
  ctx.drawImage(image, 0, 0, size.width, size.height)
  ctx.lineJoin = 'round'
  // モザイクの Canvas は保存のたびに画素から作る（GPU のリセットで中身が消えた Canvas を使わないため）。
  const mosaicCanvases = new Map<number, HTMLCanvasElement>()
  const mosaicCanvas = (level: number): HTMLCanvasElement => {
    let canvas = mosaicCanvases.get(level)
    if (!canvas) {
      const pixels = mosaicPixels(level)
      canvas = document.createElement('canvas')
      canvas.width = pixels.width
      canvas.height = pixels.height
      canvas.getContext('2d')?.putImageData(pixels, 0, 0)
      mosaicCanvases.set(level, canvas)
    }
    return canvas
  }
  for (const shape of drawOrder(shapes)) {
    if (shape.kind === 'crop') continue
    if (shape.kind !== 'mosaic') {
      drawShape(ctx, shape)
      continue
    }
    const box = pixelBox(boxFromPoints(shape.from, shape.to), size.width, size.height)
    if (box.width > 0 && box.height > 0) {
      ctx.drawImage(mosaicCanvas(shape.level), box.x, box.y, box.width, box.height, box.x, box.y, box.width, box.height)
    }
  }
  const crop = findCrop(shapes)
  let canvas = full
  if (crop) {
    const box = pixelBox(boxFromPoints(crop.from, crop.to), size.width, size.height, 'round')
    if (box.width === 0 || box.height === 0) throw new Error('crop area is empty')
    canvas = document.createElement('canvas')
    canvas.width = box.width
    canvas.height = box.height
    canvas.getContext('2d')?.drawImage(full, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('failed to encode PNG')
  return new Uint8Array(await blob.arrayBuffer())
}

function drawShape(ctx: CanvasRenderingContext2D, shape: StrokeShape | TextShape): void {
  ctx.save()
  if (shape.kind === 'text') {
    ctx.font = annotationFont(shape.fontSize)
    ctx.textBaseline = 'alphabetic'
    ctx.lineJoin = 'round'
    ctx.lineWidth = textOutlineWidth(shape.fontSize)
    ctx.strokeStyle = outlineColor(shape.color)
    ctx.fillStyle = shape.color
    textLines(shape.text).forEach((line, i) => {
      const y = baselineY(shape, i)
      ctx.strokeText(line, shape.at.x, y)
      ctx.fillText(line, shape.at.x, y)
    })
    ctx.restore()
    return
  }
  ctx.strokeStyle = shape.color
  ctx.fillStyle = shape.color
  ctx.lineWidth = shape.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash(dashPattern(shape.dash, shape.width))
  ctx.beginPath()
  if (shape.kind === 'rect') {
    const box = boxFromPoints(shape.from, shape.to)
    ctx.roundRect(box.x, box.y, box.width, box.height, cornerRadius(shape.width, box))
    ctx.stroke()
  } else if (shape.kind === 'ellipse') {
    const box = boxFromPoints(shape.from, shape.to)
    ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    const { shaftEnd, head } = arrowGeometry(shape.from, shape.to, shape.width)
    ctx.moveTo(shape.from.x, shape.from.y)
    ctx.lineTo(shaftEnd.x, shaftEnd.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(head[0].x, head[0].y)
    ctx.lineTo(head[1].x, head[1].y)
    ctx.lineTo(head[2].x, head[2].y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/** 線の種類のボタンの絵。 */
function LineStyleIcon({ style }: { style: LineStyle }): React.JSX.Element {
  return (
    <svg width={16} height={14} viewBox="0 0 16 14" aria-hidden="true">
      <line
        x1={2}
        y1={7}
        x2={14}
        y2={7}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={dashPattern(style, 2).join(' ') || undefined}
      />
    </svg>
  )
}

/** モザイクの細かさのボタンの絵。`cells` × `cells` の市松模様（多いほど細かい）。 */
function MosaicLevelIcon({ cells }: { cells: number }): React.JSX.Element {
  const size = 14 / cells
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
      {Array.from({ length: cells * cells }, (_, i) => {
        const x = i % cells
        const y = Math.floor(i / cells)
        return (x + y) % 2 === 0 ? (
          <rect key={i} x={x * size} y={y * size} width={size} height={size} fill="currentColor" />
        ) : null
      })}
      <rect x={0.5} y={0.5} width={13} height={13} fill="none" stroke="currentColor" />
    </svg>
  )
}

function Separator(): React.JSX.Element {
  return <div className="h-5 w-px bg-border" />
}

function IconButton({
  title,
  active,
  disabled,
  onClick,
  children
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-accent text-foreground'
      )}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

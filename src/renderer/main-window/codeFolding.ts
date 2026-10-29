import { codeFolding as foldPlaceholders, foldGutter, foldService } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { EditorLanguage } from '@shared/fileKinds'
import { htmlFoldRanges, jsonFoldRanges, markdownFoldRanges, yamlFoldRanges, type FoldRange } from './foldRanges'

/** 打鍵の後、折りたためる範囲を計算し直すまで待つ時間。 */
const REFRESH_DELAY_MS = 300

/** 文書中の位置で持った折りたためる範囲。`start` は印を付ける行の先頭。 */
interface StoredRange {
  start: number
  from: number
  to: number
}

const RANGE_FINDERS: Partial<Record<EditorLanguage, (text: string) => FoldRange[]>> = {
  markdown: markdownFoldRanges,
  html: htmlFoldRanges,
  json: jsonFoldRanges,
  yaml: yamlFoldRanges
}

/** 折りたたみに対応している種類か。 */
export function supportsFolding(language: EditorLanguage): boolean {
  return RANGE_FINDERS[language] !== undefined
}

/**
 * 種類ごとの規則（`foldRanges.ts`）で計算した範囲を折りたためるようにする。行番号の右に印を出す
 * （畳める行の印は行番号の列にマウスが乗っている間だけ、畳んである行の印は常に見せる。`codeEditor.ts` のテーマ）。
 * 範囲は打鍵の後しばらく待ってから計算し直し、それまでは直前の範囲を編集に合わせてずらして使う。
 */
export function codeFolding(language: EditorLanguage): Extension {
  const findRanges = RANGE_FINDERS[language]
  if (!findRanges) return []

  const compute = (state: EditorState): StoredRange[] =>
    findRanges(state.doc.toString()).map((r) => ({ start: state.doc.line(r.line).from, from: r.from, to: r.to }))

  const setRanges = StateEffect.define<StoredRange[]>()

  /** 印のツールチップの文言を引くためのエディタ（`refresher` が作られたときに入る）。 */
  let markerView: EditorView | null = null

  /** 折りたたみの印。畳んである行の印だけ `cm-foldMarker-folded` を付け、常に見えるようにする。 */
  const markerDOM = (open: boolean): HTMLElement => {
    const span = document.createElement('span')
    span.textContent = open ? '▾' : '▸'
    if (!open) span.className = 'cm-foldMarker-folded'
    const phrase = open ? 'Fold line' : 'Unfold line'
    span.title = markerView?.state.phrase(phrase) ?? phrase
    return span
  }

  const rangesField = StateField.define<StoredRange[]>({
    create: compute,
    update(ranges, tr) {
      for (const effect of tr.effects) if (effect.is(setRanges)) return effect.value
      if (!tr.docChanged) return ranges
      return ranges
        .map((r) => ({
          start: tr.changes.mapPos(r.start, -1),
          from: tr.changes.mapPos(r.from, -1),
          to: tr.changes.mapPos(r.to, -1)
        }))
        .filter((r) => r.from < r.to)
    }
  })

  const refresher = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | undefined
      constructor(private readonly view: EditorView) {
        markerView = view
      }
      update(update: ViewUpdate): void {
        if (!update.docChanged) return
        clearTimeout(this.timer)
        this.timer = setTimeout(() => {
          this.timer = undefined
          this.view.dispatch({ effects: setRanges.of(compute(this.view.state)) })
        }, REFRESH_DELAY_MS)
      }
      destroy(): void {
        clearTimeout(this.timer)
      }
    }
  )

  const service = foldService.of((state, lineStart, lineEnd) => {
    const ranges = state.field(rangesField)
    let lo = 0
    let hi = ranges.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const range = ranges[mid]
      if (!range) break
      if (range.start < lineStart) lo = mid + 1
      else if (range.start > lineStart) hi = mid - 1
      else return range.from >= lineStart && range.from <= lineEnd ? { from: range.from, to: range.to } : null
    }
    return null
  })

  return [
    rangesField,
    refresher,
    service,
    foldPlaceholders({ placeholderText: '…' }),
    foldGutter({
      markerDOM,
      foldingChanged: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(setRanges)))
    }),
    EditorView.editorAttributes.of({ class: 'cm-hasFolding' })
  ]
}

import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { highlightToRanges } from '../shared/lib/shiki'

/** 打鍵が止まってから色を付け直すまでの待ち。 */
const REHIGHLIGHT_DELAY_MS = 150
/** これより長い中身には色を付けない（打鍵ごとに全体を解析し直すため）。 */
const MAX_HIGHLIGHT_LENGTH = 200_000

const setHighlight = StateEffect.define<DecorationSet>()

/** 色の装飾。解析し直すまでの間は、編集に合わせて位置をずらして使う。 */
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(setHighlight)) next = effect.value
    return next
  },
  provide: (field) => EditorView.decorations.from(field)
})

/**
 * shiki（閲覧・「表示」・トランスクリプトと同じ文法と配色）でエディタに色を付ける。
 * shiki は非同期なので、開いた直後と編集の直後は少し遅れて色が付く。
 */
export function shikiHighlight(lang: string): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | undefined
      /** 古い解析結果を捨てるための通し番号。 */
      private generation = 0
      private destroyed = false

      constructor(private readonly view: EditorView) {
        this.schedule(0)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) this.schedule(REHIGHLIGHT_DELAY_MS)
      }

      destroy(): void {
        this.destroyed = true
        clearTimeout(this.timer)
      }

      private schedule(delay: number): void {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.run(), delay)
      }

      private async run(): Promise<void> {
        const generation = ++this.generation
        const doc = this.view.state.doc
        const text = doc.toString()
        const ranges = text.length > MAX_HIGHLIGHT_LENGTH ? [] : await highlightToRanges(text, lang)
        if (this.destroyed || generation !== this.generation || this.view.state.doc !== doc) return
        const marks = new Map<string, Decoration>()
        const decorations: Range<Decoration>[] = ranges.map(({ from, to, style }) => {
          let mark = marks.get(style)
          if (!mark) {
            mark = Decoration.mark({ class: 'cm-shiki', attributes: { style } })
            marks.set(style, mark)
          }
          return mark.range(from, to)
        })
        this.view.dispatch({ effects: setHighlight.of(Decoration.set(decorations, true)) })
      }
    }
  )
  return [highlightField, plugin]
}

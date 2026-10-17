import { Annotation, Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  EditorView,
  highlightTrailingWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import type { EditorLanguage } from '@shared/fileKinds'
import { shikiHighlight } from './shikiHighlight'

/** 外部変更の読み直しなど、利用者の編集ではない書き換えに付ける印（自動保存を走らせない）。 */
const externalEdit = Annotation.define<boolean>()

/**
 * 地の色・文字の大きさはアプリ側（Tailwind のトークンと `text-editor`）に合わせる。
 * 余白と行番号の位置は「表示」（globals.css の `.shiki-lines`）と揃え、切り替えても文字が動かないようにする。
 */
const theme = EditorView.theme({
  '&': { height: '100%', color: 'hsl(var(--foreground))', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-content': { padding: '1.5rem 0', caretColor: 'hsl(var(--foreground))' },
  '.cm-line': { padding: '0 0.75rem 0 1em' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'inherit',
    border: 'none',
    paddingLeft: '1.5rem'
  },
  '.cm-lineNumbers': { opacity: '0.4' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '2.5em', padding: '0' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'hsl(var(--foreground))' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'hsl(var(--accent))'
  },
  '.cm-trailingSpace': { backgroundColor: 'hsl(var(--destructive) / 0.25)' },
  '.cm-searchMatch': { backgroundColor: 'rgb(250 204 21 / 0.45)' },
  '.cm-searchMatch-selected': { backgroundColor: 'rgb(249 115 22 / 0.8)' },
  '.cm-panels': {
    backgroundColor: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))'
  },
  '.cm-panels-top': { borderBottom: '1px solid hsl(var(--border))' },
  '.cm-panel.cm-search': { fontFamily: 'var(--font-sans, inherit)', fontSize: '0.875rem' },
  '.cm-textfield': {
    backgroundColor: 'transparent',
    border: '1px solid hsl(var(--border))',
    borderRadius: '0.25rem',
    padding: '0.125rem 0.375rem',
    color: 'inherit'
  },
  '.cm-textfield:focus': { outline: '1px solid hsl(var(--ring))' },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'transparent',
    border: '1px solid hsl(var(--border))',
    borderRadius: '0.25rem',
    padding: '0.125rem 0.5rem',
    color: 'inherit'
  },
  '.cm-button:hover': { backgroundColor: 'hsl(var(--muted))' },
  '.cm-panel.cm-search [name=close]': { color: 'hsl(var(--muted-foreground))', cursor: 'pointer' }
})

export interface CodeEditorOptions {
  parent: HTMLElement
  doc: string
  language: EditorLanguage
  /** 色付けに使う shiki の言語名（`langFromFilename`）。 */
  highlightLang: string
  readOnly: boolean
  /** 検索パネルなどの文言（英語の原文 → 表示する文言）。 */
  phrases: Record<string, string>
  /** 利用者の編集で中身が変わったとき。 */
  onChange: (text: string) => void
}

export interface CodeEditor {
  view: EditorView
  setReadOnly: (readOnly: boolean) => void
  setPhrases: (phrases: Record<string, string>) => void
}

/**
 * 編集できるテキストファイルの CodeMirror。どの種類も行番号を付け、Markdown だけ折り返す
 * （折り返した続きの行には番号が付かない）。色は shiki で付ける。スペルチェックは Markdown だけ。
 * 行末の空白は塗って見せる。
 */
export function createCodeEditor(options: CodeEditorOptions): CodeEditor {
  const isMarkdown = options.language === 'markdown'
  const readOnlyCompartment = new Compartment()
  const phrasesCompartment = new Compartment()
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        history(),
        lineNumbers(),
        // 矩形選択（Alt / Option+ドラッグ）。複数の選択範囲を持てるようにし、それを描くために選択も自前で描く。
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        rectangularSelection(),
        crosshairCursor(),
        highlightTrailingWhitespace(),
        isMarkdown ? EditorView.lineWrapping : [],
        shikiHighlight(options.highlightLang),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.contentAttributes.of({ spellcheck: isMarkdown ? 'true' : 'false' }),
        readOnlyCompartment.of(EditorState.readOnly.of(options.readOnly)),
        phrasesCompartment.of(EditorState.phrases.of(options.phrases)),
        theme,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          if (update.transactions.every((tr) => tr.annotation(externalEdit))) return
          options.onChange(update.state.doc.toString())
        })
      ]
    })
  })
  return {
    view,
    setReadOnly: (readOnly) =>
      view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)) }),
    setPhrases: (phrases) => view.dispatch({ effects: phrasesCompartment.reconfigure(EditorState.phrases.of(phrases)) })
  }
}

/**
 * 中身を `text` に置き換える（外部変更の読み直し）。変わった範囲だけを書き換えるので、カーソルは
 * 変わっていない部分ではそのまま残る。元に戻すの履歴には積まず、`onChange` も呼ばない。
 */
export function replaceDocument(view: EditorView, text: string): void {
  const current = view.state.doc.toString()
  if (current === text) return
  let start = 0
  const maxStart = Math.min(current.length, text.length)
  while (start < maxStart && current.charCodeAt(start) === text.charCodeAt(start)) start++
  let currentEnd = current.length
  let textEnd = text.length
  while (currentEnd > start && textEnd > start && current.charCodeAt(currentEnd - 1) === text.charCodeAt(textEnd - 1)) {
    currentEnd--
    textEnd--
  }
  view.dispatch({
    changes: { from: start, to: currentEnd, insert: text.slice(start, textEnd) },
    annotations: [externalEdit.of(true), Transaction.addToHistory.of(false)]
  })
}

/**
 * 1 始まりの行・列（範囲外は末尾・行末に丸める）から `length` 文字を選択し、画面の中央へ寄せてフォーカスする。
 */
export function selectAt(view: EditorView, line: number, column: number, length = 0): void {
  const doc = view.state.doc
  const target = doc.line(Math.min(Math.max(line, 1), doc.lines))
  const from = target.from + Math.min(Math.max(column - 1, 0), target.length)
  const to = Math.min(from + length, doc.length)
  view.focus()
  view.dispatch({
    selection: EditorSelection.single(from, to),
    effects: EditorView.scrollIntoView(from, { y: 'center' })
  })
}

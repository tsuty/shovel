import type { Highlighter } from 'shiki'

/** ハイライトに対応する言語。各言語は初めて使うときに読み込む（`ensureLang`）。 */
const LANGS = [
  'javascript',
  'jsx',
  'typescript',
  'tsx',
  'json',
  'jsonc',
  'bash',
  'python',
  'ruby',
  'markdown',
  'yaml',
  'html',
  'css',
  'scss',
  'sql',
  'go',
  'rust',
  'java',
  'kotlin',
  'c',
  'cpp',
  'swift',
  'php',
  'toml',
  'xml',
  'docker',
  'mermaid',
  'plaintext'
] as const

type Lang = (typeof LANGS)[number]

let highlighterPromise: Promise<Highlighter> | null = null
const langLoads = new Map<Lang, Promise<boolean>>()

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({ themes: ['github-light', 'github-dark'], langs: [] })
    )
  }
  return highlighterPromise
}

/** 言語を初めて使うときに読み込む。読めなければ false（次回また試す）。 */
function ensureLang(highlighter: Highlighter, lang: Lang): Promise<boolean> {
  if (lang === 'plaintext') return Promise.resolve(true)
  let load = langLoads.get(lang)
  if (!load) {
    load = highlighter.loadLanguage(lang).then(
      () => true,
      () => {
        langLoads.delete(lang)
        return false
      }
    )
    langLoads.set(lang, load)
  }
  return load
}

function isLang(lang: string): lang is Lang {
  return (LANGS as readonly string[]).includes(lang)
}

const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  jsonc: 'jsonc',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  py: 'python',
  rb: 'ruby',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  swift: 'swift',
  php: 'php',
  toml: 'toml',
  xml: 'xml',
  dockerfile: 'docker',
  mmd: 'mermaid',
  mermaid: 'mermaid'
}

/** Markdown のフェンスの言語名（`ts` / `typescript` / `sh` など）を shiki の言語名にする。 */
export function langFromFence(lang: string): string {
  const lower = lang.toLowerCase()
  if (isLang(lower)) return lower
  const aliases: Record<string, string> = { shell: 'bash', console: 'bash', text: 'plaintext', txt: 'plaintext', dockerfile: 'docker' }
  return aliases[lower] ?? langFromFilename(`x.${lower}`)
}

/**
 * パスの末尾（ファイル名）の拡張子から言語を決める。拡張子が無ければファイル名そのもの
 * （`Dockerfile` など）で引く。
 */
export function langFromFilename(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? ''
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? 'plaintext'
}

/**
 * ライト／ダーク両方の配色を1回で出力する（ダーク側は `--shiki-dark*` の CSS 変数に入り、
 * globals.css が `.dark` のときに切り替える）。
 */
export async function highlightToHtml(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter()
  const effectiveLang = isLang(lang) && (await ensureLang(highlighter, lang)) ? lang : 'plaintext'
  return highlighter.codeToHtml(code, {
    lang: effectiveLang,
    themes: { light: 'github-light', dark: 'github-dark' }
  })
}

/** 色を付ける範囲（`code` の中の位置）と、その `style` 属性の値。 */
export interface StyledRange {
  from: number
  to: number
  style: string
}

/**
 * `highlightToHtml` と同じ配色を、HTML ではなく範囲の一覧で返す（エディタに重ねる用）。
 * `style` にはライト側の色と、ダーク側の `--shiki-dark*` の CSS 変数が入る。
 */
export async function highlightToRanges(code: string, lang: string): Promise<StyledRange[]> {
  const highlighter = await getHighlighter()
  const effectiveLang = isLang(lang) && (await ensureLang(highlighter, lang)) ? lang : 'plaintext'
  const { tokens } = highlighter.codeToTokens(code, {
    lang: effectiveLang,
    themes: { light: 'github-light', dark: 'github-dark' }
  })
  const ranges: StyledRange[] = []
  for (const line of tokens) {
    for (const token of line) {
      if (!token.content || !token.htmlStyle) continue
      const style = Object.entries(token.htmlStyle)
        .map(([key, value]) => `${key}:${value}`)
        .join(';')
      ranges.push({ from: token.offset, to: token.offset + token.content.length, style })
    }
  }
  return ranges
}

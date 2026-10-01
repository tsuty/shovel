import type { Highlighter } from 'shiki'

/** 実際に使う言語だけを指定した shiki の highlighter をシングルトンで生成する。 */
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
  'plaintext'
] as const

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({ themes: ['github-light', 'github-dark'], langs: [...LANGS] })
    )
  }
  return highlighterPromise
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
  dockerfile: 'docker'
}

/** Markdown のフェンスの言語名（`ts` / `typescript` / `sh` など）を shiki の言語名にする。 */
export function langFromFence(lang: string): string {
  const lower = lang.toLowerCase()
  if ((LANGS as readonly string[]).includes(lower)) return lower
  const aliases: Record<string, string> = { shell: 'bash', console: 'bash', text: 'plaintext', txt: 'plaintext', dockerfile: 'docker' }
  return aliases[lower] ?? langFromFilename(`x.${lower}`)
}

export function langFromFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? 'plaintext'
}

/**
 * ライト／ダーク両方の配色を1回で出力する（ダーク側は `--shiki-dark*` の CSS 変数に入り、
 * globals.css が `.dark` のときに切り替える）。
 */
export async function highlightToHtml(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter()
  const effectiveLang = highlighter.getLoadedLanguages().includes(lang) ? lang : 'plaintext'
  return highlighter.codeToHtml(code, {
    lang: effectiveLang,
    themes: { light: 'github-light', dark: 'github-dark' }
  })
}

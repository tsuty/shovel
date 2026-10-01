import { readdir, readFile, rename as fsRename, stat, mkdir, cp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clipboard, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import ignore, { type Ignore } from 'ignore'
import type { FileReadResult, FsEntry } from '@shared/types/filer'
import type { Project } from '@shared/types/project'
import { projectsStore } from '../persistence/store'
import { decodeText, encodeForWrite } from './textEncoding'

/**
 * ファイラーの実体。ui.md §9 / decisions.md N-3-4: ファイル操作はホスト側の
 * Node `fs` で行う（バインドマウントなので同じファイル。`sbx exec` より速い）。
 * `.gitignore` の判定は `ignore`（npm）で行い、git コマンドを呼ばない
 * （非 git プロジェクトでも、ホストに git が無くても動く）。
 */

/**
 * アプリ内でプレビューする画像（N-3-1 の「バイナリは OS へ」の例外）。SVG は
 * テキストだが、中身のソースより絵を見たい場面が多いので画像として扱う。
 * `<img>` に data URL で渡すため、SVG 内のスクリプトは実行されない。
 */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
}

/** これより大きい画像は IPC で丸ごと渡さず、OS のアプリに任せる。 */
const MAX_IMAGE_PREVIEW_BYTES = 20 * 1024 * 1024

function requireProject(projectId: string): Project {
  const project = projectsStore.list().find((p) => p.id === projectId)
  if (!project) throw new Error(`project not found: ${projectId}`)
  return project
}

function resolveAbsolute(project: Project, relPath: string): string {
  const abs = path.join(project.hostPath, relPath)
  const rel = path.relative(project.hostPath, abs)
  if (rel.startsWith('..')) throw new Error(`path escapes project root: ${relPath}`)
  return abs
}

/** 同名衝突を避け、VSCode 等と同じ「Name」「Name 2」「Name 3」…の規則で空き名前を探す。 */
async function findAvailableName(dirAbs: string, base: string, ext: string): Promise<string> {
  let candidate = `${base}${ext}`
  for (let n = 2; ; n++) {
    try {
      await stat(path.join(dirAbs, candidate))
      candidate = `${base} ${n}${ext}`
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return candidate
      throw err
    }
  }
}

async function loadIgnore(hostPath: string): Promise<Ignore> {
  const ig = ignore()
  try {
    const content = await readFile(path.join(hostPath, '.gitignore'), 'utf8')
    ig.add(content)
  } catch {
    // .gitignore が無いプロジェクトもある。無視して続ける。
  }
  return ig
}

/**
 * decisions.md N-3-5（2026-09-30 改定）: `.git` は常に隠す（表示トグルは
 * 非エンジニアに意味が伝わらないため廃止した）。
 */
export async function listDir(projectId: string, relPath: string): Promise<FsEntry[]> {
  const project = requireProject(projectId)
  const dirAbs = resolveAbsolute(project, relPath)
  const ig = await loadIgnore(project.hostPath)
  const entries = await readdir(dirAbs, { withFileTypes: true })

  const result: FsEntry[] = []
  for (const entry of entries) {
    if (relPath === '' && entry.name === '.git') continue
    const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name
    const isDir = entry.isDirectory()
    result.push({
      relPath: entryRelPath,
      name: entry.name,
      isDir,
      ignored: ig.ignores(isDir ? `${entryRelPath}/` : entryRelPath)
    })
  }
  result.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return result
}

export async function readFileForViewer(projectId: string, relPath: string): Promise<FileReadResult> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  try {
    const info = await stat(absPath)
    if (!info.isFile()) return { kind: 'missing' }
    const mime = IMAGE_MIME_BY_EXT[path.extname(absPath).slice(1).toLowerCase()]
    if (mime) {
      if (info.size > MAX_IMAGE_PREVIEW_BYTES) return { kind: 'binary' }
      const data = await readFile(absPath)
      return { kind: 'image', dataUrl: `data:${mime};base64,${data.toString('base64')}` }
    }
    const decoded = decodeText(await readFile(absPath))
    if (decoded.kind === 'binary') return { kind: 'binary' }
    return { ...decoded, size: info.size }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    throw err
  }
}

export async function writeTextFile(projectId: string, relPath: string, content: string): Promise<void> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  const existing = await readFile(absPath).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  await writeFile(absPath, encodeForWrite(content, existing))
}

export async function createDirectory(projectId: string, parentRelPath: string): Promise<string> {
  const project = requireProject(projectId)
  const parentAbs = resolveAbsolute(project, parentRelPath)
  const name = await findAvailableName(parentAbs, 'New Folder', '')
  await mkdir(path.join(parentAbs, name))
  return parentRelPath ? `${parentRelPath}/${name}` : name
}

export async function createMarkdownFile(projectId: string, parentRelPath: string): Promise<string> {
  const project = requireProject(projectId)
  const parentAbs = resolveAbsolute(project, parentRelPath)
  const name = await findAvailableName(parentAbs, 'Untitled', '.md')
  await writeFile(path.join(parentAbs, name), '', 'utf8')
  return parentRelPath ? `${parentRelPath}/${name}` : name
}

export async function renameEntry(projectId: string, relPath: string, newName: string): Promise<void> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  const destAbs = path.join(path.dirname(absPath), newName)
  await fsRename(absPath, destAbs)
}

export async function deleteEntry(projectId: string, relPath: string): Promise<void> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  // N-2-4 / A-3-7 と同じ方針: fs.rm ではなく OS のゴミ箱へ。取り返しがつくことを優先する。
  await shell.trashItem(absPath)
}

export async function moveEntry(projectId: string, relPath: string, destDirRelPath: string): Promise<void> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  const destDirAbs = resolveAbsolute(project, destDirRelPath)
  const destAbs = path.join(destDirAbs, path.basename(absPath))
  await fsRename(absPath, destAbs)
}

export async function copyEntry(projectId: string, relPath: string, destDirRelPath: string): Promise<string> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  const destDirAbs = resolveAbsolute(project, destDirRelPath)
  const name = await copyInto(absPath, destDirAbs)
  return destDirRelPath ? `${destDirRelPath}/${name}` : name
}

/**
 * `absPath`（ファイルでもディレクトリでもよい）を `destDirAbs` の直下へコピーし、
 * 付けた名前を返す。同じフォルダへ貼り付ける「複製」操作でも衝突せず使える
 * よう、移動先に同名が既にあれば createDirectory/createMarkdownFile と同じ
 * 「name 2」規則で回避する。
 */
async function copyInto(absPath: string, destDirAbs: string): Promise<string> {
  await mkdir(destDirAbs, { recursive: true })
  const info = await stat(absPath)
  const original = path.basename(absPath)
  const ext = info.isDirectory() ? '' : path.extname(original)
  const base = info.isDirectory() ? original : original.slice(0, original.length - ext.length)
  const name = await findAvailableName(destDirAbs, base, ext)
  await cp(absPath, path.join(destDirAbs, name), { recursive: true, errorOnExist: true })
  return name
}

/**
 * ui.md §9「アプリ外からの貼り付け・ドロップ」: OS のファイラー（Finder 等）で
 * コピー／ドラッグされたファイル・フォルダを、プロジェクト内の `destDirRelPath`
 * へ**コピー**する（移動はしない。元の場所のファイルを消さないため。
 * decisions.md N-3-4）。同名は「name 2」規則で回避する。進捗表示は無い
 * （エージェントに読ませる資料を入れる用途を想定し、巨大・大量のコピーは
 * 想定しない）。コピーした先の相対パスを返す。
 */
export async function copyExternalEntries(
  projectId: string,
  absPaths: string[],
  destDirRelPath: string
): Promise<string[]> {
  const project = requireProject(projectId)
  const destDirAbs = resolveAbsolute(project, destDirRelPath)
  const copied: string[] = []
  for (const absPath of absPaths) {
    if (!path.isAbsolute(absPath)) continue
    const name = await copyInto(absPath, destDirAbs)
    copied.push(destDirRelPath ? `${destDirRelPath}/${name}` : name)
  }
  return copied
}

/**
 * OS のクリップボードにある「コピーされたファイル」の絶対パスを読む。
 * Electron に OS 共通の API は無いため、OS ごとの形式を読み分ける
 * （ネイティブモジュールは使わない。decisions.md F-2b）:
 *   - macOS: `NSFilenamesPboardType`（plist）、無ければ `public.file-url`
 *   - Windows: `FileNameW`（UTF-16LE。先頭の1件のみ取れる）
 *   - Linux: `x-special/gnome-copied-files` / `text/uri-list`
 * 実在しないパスは除く。ファイルが無ければ空配列。
 */
export async function readClipboardFilePaths(): Promise<string[]> {
  const candidates: string[] = []
  const fromUris = (text: string): void => {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('file://')) continue
      try {
        candidates.push(fileURLToPath(line.trim()))
      } catch {
        // 解釈できない URI は無視する
      }
    }
  }
  if (process.platform === 'darwin') {
    const plist = clipboard.read('NSFilenamesPboardType')
    for (const m of plist.matchAll(/<string>([^<]*)<\/string>/g)) candidates.push(unescapeXml(m[1]!))
    if (candidates.length === 0) fromUris(clipboard.read('public.file-url'))
  } else if (process.platform === 'win32') {
    const raw = clipboard.readBuffer('FileNameW').toString('utf16le').replace(/\0+$/, '')
    if (raw) candidates.push(raw)
  } else {
    fromUris(clipboard.read('x-special/gnome-copied-files'))
    if (candidates.length === 0) fromUris(clipboard.read('text/uri-list'))
  }
  const existing: string[] = []
  for (const candidate of candidates) {
    try {
      await stat(candidate)
      existing.push(candidate)
    } catch {
      // 既に存在しないファイルは貼り付け対象にしない
    }
  }
  return existing
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export async function openInOS(projectId: string, relPath: string): Promise<void> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  const error = await shell.openPath(absPath)
  if (error) throw new Error(error)
}

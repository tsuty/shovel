import { readdir, readFile, rename as fsRename, stat, mkdir, cp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clipboard, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import ignore, { type Ignore } from 'ignore'
import type { FileReadResult, FileSearchResult, FsEntry } from '@shared/types/filer'
import type { Project } from '@shared/types/project'
import { isNewFileKind, type NewFileKind } from '@shared/fileKinds'
import { projectsStore } from '../persistence/store'
import { decodeText, encodeForWrite } from './textEncoding'
import { searchDirectory } from './fileSearch'

/**
 * ファイラーのバックエンド。ファイル操作はホスト側の Node `fs` で行い、
 * `.gitignore` の判定は `ignore` パッケージで行う。
 */

/** アプリ内でプレビューする画像の拡張子と MIME タイプ。 */
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

/** 「Name」「Name 2」「Name 3」…の規則で空き名前を探す。 */
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
    // .gitignore が無ければ無視して続ける。
  }
  return ig
}

/** ディレクトリ直下のエントリを列挙する。ルートの `.git` は常に隠す。 */
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

/** 呼び出し元（webContents）ごとの中身検索の世代番号。追い越された検索は null を返す。 */
const latestFileSearch = new Map<number, number>()

/** ファイラーの中身検索。`scopeRelPath` が空ならプロジェクト全体。 */
export async function searchFiles(
  callerId: number,
  projectId: string,
  scopeRelPath: string,
  query: string
): Promise<FileSearchResult[] | null> {
  const token = (latestFileSearch.get(callerId) ?? 0) + 1
  latestFileSearch.set(callerId, token)
  const project = requireProject(projectId)
  resolveAbsolute(project, scopeRelPath)
  return searchDirectory(project.hostPath, scopeRelPath, query, () => latestFileSearch.get(callerId) === token)
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
      return { kind: 'image', dataUrl: `data:${mime};base64,${data.toString('base64')}`, size: info.size }
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

/**
 * 「新規ファイル」の種類ごとの拡張子と初期内容。Mermaid は開いてすぐ図が見えるように小さな見本を
 * 書いておく（空だと文法エラーになる）。JSON も空だと不正なので `{}` にしておく。
 */
const NEW_FILE_SPECS: Record<NewFileKind, { ext: string; content: string }> = {
  markdown: { ext: '.md', content: '' },
  text: { ext: '.txt', content: '' },
  mermaid: { ext: '.mmd', content: 'flowchart TD\n  A[Start] --> B[End]\n' },
  json: { ext: '.json', content: '{}\n' },
  yaml: { ext: '.yaml', content: '' }
}

export async function createNewFile(projectId: string, parentRelPath: string, kind: NewFileKind): Promise<string> {
  if (!isNewFileKind(kind)) throw new Error(`unknown file kind: ${String(kind)}`)
  const spec = NEW_FILE_SPECS[kind]
  const project = requireProject(projectId)
  const parentAbs = resolveAbsolute(project, parentRelPath)
  const name = await findAvailableName(parentAbs, 'Untitled', spec.ext)
  await writeFile(path.join(parentAbs, name), spec.content, 'utf8')
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
  // OS のゴミ箱へ移す。
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
 * `absPath`（ファイルでもディレクトリでもよい）を `destDirAbs` の直下へコピーし、付けた名前を返す。
 * 同名があれば「name 2」規則で回避する。
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
 * OS のファイラーからコピー／ドロップされたファイル・フォルダを、プロジェクト内の
 * `destDirRelPath` へコピーする。同名は「name 2」規則で回避する。コピー先の相対パスを返す。
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

const GNOME_COPIED_FILES = 'electron application/osclipboard;format="x-special/gnome-copied-files"'

/**
 * OS のクリップボードにある「コピーされたファイル」の絶対パスを読む。
 * Electron の `text/uri-list` は各 OS のファイル参照形式（Windows: `CF_HDROP`、
 * macOS: `NSFilenamesPboardType`、Linux: `text/uri-list`）に対応付けられているので、
 * OS ごとの読み分けは要らない。Linux で `text/uri-list` を出さないファイルマネージャー
 * 向けに `x-special/gnome-copied-files` も見る。
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
  const mimeTypes: Array<'text/uri-list' | typeof GNOME_COPIED_FILES> = ['text/uri-list']
  if (process.platform === 'linux') mimeTypes.push(GNOME_COPIED_FILES)
  for (const item of await clipboard.read()) {
    for (const mimeType of mimeTypes) {
      if (candidates.length > 0) break
      if (!item.types.includes(mimeType)) continue
      fromUris(await (await item.getType(mimeType)).text())
    }
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

export async function openInOS(projectId: string, relPath: string): Promise<void> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  const error = await shell.openPath(absPath)
  if (error) throw new Error(error)
}

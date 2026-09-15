import { open, readdir, readFile, rename as fsRename, stat, mkdir, cp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import ignore, { type Ignore } from 'ignore'
import type { FileReadResult, FsEntry } from '@shared/types/filer'
import type { Project } from '@shared/types/project'
import { projectsStore } from '../persistence/store'

/**
 * ファイラーの実体。ui.md §9 / decisions.md N-3-4: ファイル操作はホスト側の
 * Node `fs` で行う（バインドマウントなので同じファイル。`sbx exec` より速い）。
 * `.gitignore` の判定は `ignore`（npm）で行い、git コマンドを呼ばない
 * （非 git プロジェクトでも、ホストに git が無くても動く）。
 */

const BINARY_SNIFF_BYTES = 8000

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

export async function listDir(projectId: string, relPath: string, showGit: boolean): Promise<FsEntry[]> {
  const project = requireProject(projectId)
  const dirAbs = resolveAbsolute(project, relPath)
  const ig = await loadIgnore(project.hostPath)
  const entries = await readdir(dirAbs, { withFileTypes: true })

  const result: FsEntry[] = []
  for (const entry of entries) {
    if (!showGit && relPath === '' && entry.name === '.git') continue
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

/** バイナリ判定は拡張子ではなく先頭数 KB の NULL バイトで行う（N-3-2）。 */
async function isBinaryFile(absPath: string): Promise<boolean> {
  const handle = await open(absPath, 'r')
  try {
    const buffer = Buffer.alloc(BINARY_SNIFF_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, BINARY_SNIFF_BYTES, 0)
    return buffer.subarray(0, bytesRead).includes(0)
  } finally {
    await handle.close()
  }
}

export async function readFileForViewer(projectId: string, relPath: string): Promise<FileReadResult> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  try {
    const info = await stat(absPath)
    if (!info.isFile()) return { kind: 'missing' }
    if (await isBinaryFile(absPath)) return { kind: 'binary' }
    const content = await readFile(absPath, 'utf8')
    return { kind: 'text', content }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    throw err
  }
}

export async function writeTextFile(projectId: string, relPath: string, content: string): Promise<void> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  await writeFile(absPath, content, 'utf8')
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

export async function copyEntry(projectId: string, relPath: string, destDirRelPath: string): Promise<void> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  const destDirAbs = resolveAbsolute(project, destDirRelPath)
  await mkdir(destDirAbs, { recursive: true })
  const destAbs = path.join(destDirAbs, path.basename(absPath))
  await cp(absPath, destAbs, { recursive: true, errorOnExist: true })
}

export async function openInOS(projectId: string, relPath: string): Promise<void> {
  const project = requireProject(projectId)
  const absPath = resolveAbsolute(project, relPath)
  const error = await shell.openPath(absPath)
  if (error) throw new Error(error)
}

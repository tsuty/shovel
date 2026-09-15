import { shell } from 'electron'
import path from 'node:path'
import type { ChangedFile, ChangesSummary } from '@shared/types/changes'
import type { Project } from '@shared/types/project'
import { sbxExecCapture } from '../sbx/cli'
import { projectsStore } from '../persistence/store'

/**
 * 「変更」サイドバー。ui.md §11 / decisions.md A-3-7, N-3-7。
 * git は常にサンドボックス内で実行する（`sbx exec <sandbox> git ...`）。
 * ホストに git があるとは限らないため。UI に git の語彙は出さない
 * （ここでの `status` は文字列ラベルとしてのみ renderer に渡る）。
 */

function requireProject(projectId: string): Project {
  const project = projectsStore.list().find((p) => p.id === projectId)
  if (!project) throw new Error(`project not found: ${projectId}`)
  return project
}

async function isGitRepo(project: Project): Promise<boolean> {
  const result = await sbxExecCapture(project.sandboxName, ['git', 'rev-parse', '--is-inside-work-tree'], {
    cwd: project.sandboxPath
  })
  return result.code === 0 && result.stdout.trim() === 'true'
}

function parsePorcelain(output: string): ChangedFile[] {
  const files: ChangedFile[] = []
  for (const line of output.split('\n')) {
    if (line.trim().length < 4) continue
    const indexStatus = line.charAt(0)
    const worktreeStatus = line.charAt(1)
    let relPath = line.slice(3)
    // リネームは "OLD -> NEW" 形式。新しいパスを対象にする。
    const arrow = relPath.indexOf(' -> ')
    if (arrow >= 0) relPath = relPath.slice(arrow + 4)

    let status: ChangedFile['status'] = 'modified'
    if (indexStatus === '?' && worktreeStatus === '?') status = 'added'
    else if (indexStatus === 'A') status = 'added'
    else if (indexStatus === 'D' || worktreeStatus === 'D') status = 'deleted'
    files.push({ relPath, status })
  }
  return files
}

export async function listChanges(projectId: string): Promise<ChangesSummary> {
  const project = requireProject(projectId)
  if (!(await isGitRepo(project))) return { gitAvailable: false, files: [] }
  const result = await sbxExecCapture(project.sandboxName, ['git', 'status', '--porcelain=v1'], {
    cwd: project.sandboxPath
  })
  if (result.code !== 0) return { gitAvailable: false, files: [] }
  return { gitAvailable: true, files: parsePorcelain(result.stdout) }
}

export async function diffFile(projectId: string, relPath: string): Promise<string> {
  const project = requireProject(projectId)
  const tracked = await sbxExecCapture(project.sandboxName, ['git', 'diff', 'HEAD', '--', relPath], {
    cwd: project.sandboxPath
  })
  if (tracked.stdout.trim()) return tracked.stdout
  // 追跡外（新規作成）のファイルは HEAD に存在しないため、--no-index で丸ごと差分として見せる。
  const untracked = await sbxExecCapture(
    project.sandboxName,
    ['git', 'diff', '--no-index', '--', '/dev/null', relPath],
    { cwd: project.sandboxPath }
  )
  return untracked.stdout
}

/** 復元の実装。data-model.md §4 の規則: 追跡済みは git restore、追跡外はゴミ箱へ。 */
export async function restoreOne(projectId: string, relPath: string): Promise<void> {
  const project = requireProject(projectId)
  const summary = await listChanges(projectId)
  const file = summary.files.find((f) => f.relPath === relPath)
  if (file?.status === 'added') {
    await shell.trashItem(path.join(project.hostPath, relPath))
    return
  }
  await sbxExecCapture(project.sandboxName, ['git', 'restore', '--', relPath], { cwd: project.sandboxPath })
}

export async function restoreAll(projectId: string): Promise<void> {
  const summary = await listChanges(projectId)
  for (const file of summary.files) {
    await restoreOne(projectId, file.relPath)
  }
}

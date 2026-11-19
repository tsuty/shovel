import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { getAgentEntry } from '@shared/agentTable'
import { isSbxNotFoundMessage } from '@shared/sbxErrors'
import type { SbxLsEntry } from '@shared/types/sbx'
import { SbxCommandError } from '../sbx/types'
import { projectsStore } from '../persistence/store'
import { resolveLocale } from '../locale'
import { logAppEvent } from '../log'
import { openProjectWindow } from '../windows/mainWindow'
import { openProjectManagerWindow } from '../windows/projectManagerWindow'
import { hostPathsEqual } from './pathTranslate'
import { createFromExistingSandbox, findRegisteredProject, sbxLsRetryingPath } from './projectService'
import { type CliOpenRequest, matchSandboxesForPath, resolveCliTarget } from './cliCommand'

const labels = {
  en: {
    title: 'shovel',
    notFound: 'The folder does not exist.',
    notDirectory: 'This is not a folder.',
    sbxNotFound: 'Could not list the sandboxes: the sbx command (Docker Sandboxes) was not found.',
    sbxFailed: 'Could not list the sandboxes (sbx ls).',
    noSandbox: 'No sandbox uses this folder as its workspace.',
    noSandboxDetail:
      'shovel does not create a sandbox from the command line. Create the project from the Project Manager instead.',
    chooseSandbox: 'Several sandboxes use this folder as their workspace. Which one do you want to open?',
    cancel: 'Cancel',
    sandboxChoice: (name: string, agent: string, running: boolean) =>
      `${name} (${agent}, ${running ? 'running' : 'stopped'})`,
    addFailed: 'Could not add the project.'
  },
  ja: {
    title: 'shovel',
    notFound: 'フォルダが見つかりません。',
    notDirectory: 'フォルダではありません。',
    sbxNotFound: 'サンドボックスの一覧を取得できません。sbx コマンド（Docker Sandboxes）が見つかりません。',
    sbxFailed: 'サンドボックスの一覧（sbx ls）を取得できませんでした。',
    noSandbox: 'このフォルダをワークスペースにしているサンドボックスがありません。',
    noSandboxDetail:
      'コマンドラインからはサンドボックスを作りません。プロジェクトマネージャからプロジェクトを作成してください。',
    chooseSandbox: 'このフォルダをワークスペースにしているサンドボックスが複数あります。どれを開きますか？',
    cancel: 'キャンセル',
    sandboxChoice: (name: string, agent: string, running: boolean) =>
      `${name}（${agent}・${running ? '実行中' : '停止中'}）`,
    addFailed: 'プロジェクトを追加できませんでした。'
  }
} as const

type Labels = (typeof labels)['en' | 'ja']

/**
 * コマンドラインツールの要求でプロジェクトを開く。
 * 開けなかったときは理由をダイアログで知らせ、ウィンドウが1つも無ければプロジェクトマネージャを開く。
 */
export async function openFromCli(req: CliOpenRequest): Promise<void> {
  const t = labels[resolveLocale()]
  let opened = false
  try {
    opened = await openTarget(resolveCliTarget(req), t)
  } catch (err) {
    logAppEvent(`cli open failed: ${err instanceof Error ? err.message : String(err)}`)
    await showError(t.addFailed, err instanceof Error ? err.message : String(err))
  }
  if (!opened && BrowserWindow.getAllWindows().length === 0) openProjectManagerWindow()
}

async function openTarget(target: string, t: Labels): Promise<boolean> {
  const info = await stat(target).catch(() => null)
  if (!info) return fail(t.notFound, target)
  if (!info.isDirectory()) return fail(t.notDirectory, target)
  const real = await canonical(target)
  const samePlace = async (candidate: string): Promise<boolean> =>
    hostPathsEqual(candidate, target) || hostPathsEqual(await canonical(candidate), real)

  const registered = await findRegisteredProject(target)
  if (registered) {
    show(registered.id)
    return true
  }

  let sandboxes: SbxLsEntry[]
  try {
    sandboxes = await sbxLsRetryingPath()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isSbxNotFoundMessage(message)) return fail(t.sbxNotFound)
    return fail(t.sbxFailed, err instanceof SbxCommandError ? err.result.stderr.trim() || message : message)
  }
  const sameWorkspace = new Set<string>()
  for (const s of sandboxes) {
    const workspace = s.workspaces[0]
    if (workspace && (await samePlace(workspace))) sameWorkspace.add(workspace)
  }
  const matches = matchSandboxesForPath(sandboxes, target, {
    equals: (workspace) => sameWorkspace.has(workspace),
    isSupportedAgent: (agent) => getAgentEntry(agent) !== undefined,
    registeredSandboxIds: new Set(projectsStore.list().map((p) => p.sandboxId))
  })

  if (matches.length === 0) return fail(t.noSandbox, `${target}\n\n${t.noSandboxDetail}`)
  const sandbox = matches.length === 1 ? matches[0] : await chooseSandbox(matches, target, t)
  if (!sandbox) return false

  const project = await createFromExistingSandbox({
    sandboxName: sandbox.name,
    displayName: path.basename(real) || sandbox.name
  })
  show(project.id)
  return true
}

function show(projectId: string): void {
  // 別のアプリが前面にあっても、開いたウィンドウを前に出す。
  if (process.platform === 'darwin') app.focus({ steal: true })
  openProjectWindow(projectId)
}

async function chooseSandbox(matches: SbxLsEntry[], target: string, t: Labels): Promise<SbxLsEntry | undefined> {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: t.title,
    message: t.chooseSandbox,
    detail: target,
    buttons: [...matches.map((s) => t.sandboxChoice(s.name, s.agent, s.status === 'running')), t.cancel],
    cancelId: matches.length,
    defaultId: 0,
    noLink: true
  })
  return matches[response]
}

async function canonical(p: string): Promise<string> {
  return realpath(p).catch(() => p)
}

async function fail(message: string, detail?: string): Promise<false> {
  await showError(message, detail)
  return false
}

async function showError(message: string, detail?: string): Promise<void> {
  await dialog.showMessageBox({ type: 'error', title: labels[resolveLocale()].title, message, detail })
}

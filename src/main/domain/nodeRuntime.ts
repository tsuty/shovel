import type { SessionOpenStep } from '@shared/ipc'
import {
  NODE_INSTALL_SCRIPT,
  NODE_INSTALL_SUMMARY,
  NPX_CHECK_COMMAND,
  NPX_CHECK_SUMMARY,
  classifyNodeInstallFailure,
  nodeRuntimeMessage
} from '@shared/nodeRuntime'
import { sbxExecCapture } from '../sbx/cli'

/** インストールを打ち切るまでの時間（ms）。 */
const INSTALL_TIMEOUT_MS = 10 * 60_000

/** サンドボックス名 → 実行中のインストール。同じサンドボックスへ同時に apt-get を走らせないために共有する。 */
const installs = new Map<string, Promise<void>>()

/**
 * ACP アダプタの起動に使う `npx` をサンドボックスに用意する。
 * 有れば何もしない。無ければ apt で Node.js と npm を入れ、できなければ原因付きで投げる。
 */
export async function ensureNodeRuntime(
  sandboxName: string,
  onProgress?: (step: SessionOpenStep, detail?: string) => void
): Promise<void> {
  onProgress?.('nodeCheck', `sbx exec ${sandboxName} ${NPX_CHECK_SUMMARY}`)
  const check = await sbxExecCapture(sandboxName, NPX_CHECK_COMMAND)
  if (check.code === 0) return

  onProgress?.('nodeInstall', `sbx exec ${sandboxName} ${NODE_INSTALL_SUMMARY}`)
  let install = installs.get(sandboxName)
  if (!install) {
    install = installNodeRuntime(sandboxName).finally(() => installs.delete(sandboxName))
    installs.set(sandboxName, install)
  }
  await install
}

async function installNodeRuntime(sandboxName: string): Promise<void> {
  const result = await sbxExecCapture(sandboxName, ['sh', '-c', NODE_INSTALL_SCRIPT], {
    timeoutMs: INSTALL_TIMEOUT_MS
  })
  if (result.code === 0) return
  console.warn(`[node-runtime] installing Node.js in ${sandboxName} failed`, result)
  throw new Error(nodeRuntimeMessage(classifyNodeInstallFailure(sandboxName, result.code, result.stderr)))
}

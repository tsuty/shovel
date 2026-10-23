import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { withAcpRollback } from '@shared/acpVersion'
import type { DataDirKind, ProjectDiagnostics } from '@shared/ipc'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { NetworkBlocksSection } from './NetworkBlocksSection'

/**
 * プロジェクトの詳細ダイアログ。基本情報・操作（停止/OSターミナル）・診断情報（`sbx diagnose` 出力、
 * ACP トラフィックログ、エージェントの stderr、`sbx ls --json` の該当エントリ）をまとめ、
 * 丸ごとクリップボードにコピーできる。ログは最後に開いたセッションのログファイルから読み、
 * 無ければその節は表示しない。拒否された通信は「ネットワーク」欄（`NetworkBlocksSection`）に出す。
 */
export function ProjectDetailDialog({
  projectId,
  open,
  onOpenChange
}: {
  projectId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [diagnostics, setDiagnostics] = useState<ProjectDiagnostics | null>(null)
  const [copied, setCopied] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !projectId) return
    setDiagnostics(null)
    setOpenError(null)
    void window.shovel.projects.diagnostics(projectId).then(setDiagnostics)
  }, [open, projectId])

  function summaryText(): string {
    if (!diagnostics) return ''
    return [
      `# ${diagnostics.project.displayName}`,
      `hostPath: ${diagnostics.project.hostPath}`,
      `sandboxName: ${diagnostics.project.sandboxName}`,
      `sandboxId: ${diagnostics.project.sandboxId}`,
      `agent: ${agentLabel(diagnostics)}`,
      `logsDir: ${diagnostics.logsDir}`,
      `snapshotsDir: ${diagnostics.snapshotsDir}`,
      '',
      '## sbx diagnose',
      diagnostics.diagnoseOutput,
      ...(diagnostics.acpTrafficLog ? ['', '## ACP traffic log', diagnostics.acpTrafficLog] : []),
      ...(diagnostics.stderrLog ? ['', '## agent stderr', diagnostics.stderrLog] : []),
      '',
      '## sbx ls --json (this project)',
      JSON.stringify(diagnostics.sbxLsEntry, null, 2)
    ].join('\n')
  }

  async function openDataDir(kind: DataDirKind): Promise<void> {
    if (!diagnostics) return
    setOpenError(null)
    try {
      await window.shovel.projects.openDataDir(diagnostics.project.id, kind)
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err))
    }
  }

  async function rollbackAcp(): Promise<void> {
    if (!diagnostics) return
    const { id, acpVersion, previousAcpVersion } = diagnostics.project
    if (!previousAcpVersion) return
    if (!confirm(t('detail.confirmRollbackAcp', { current: acpVersion, previous: previousAcpVersion }))) return
    await window.shovel.agents.rollbackAcpVersion(id)
    const project = withAcpRollback(diagnostics.project)
    if (project) setDiagnostics({ ...diagnostics, project })
  }

  async function copyAll(): Promise<void> {
    await navigator.clipboard.writeText(summaryText())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{diagnostics?.project.displayName ?? t('common.loading')}</DialogTitle>
        </DialogHeader>

        {!diagnostics ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t('detail.hostPath')}</dt>
              <dd className="truncate">{diagnostics.project.hostPath}</dd>
              <dt className="text-muted-foreground">{t('detail.sandboxName')}</dt>
              <dd className="truncate">{diagnostics.project.sandboxName}</dd>
              <dt className="text-muted-foreground">{t('detail.agent')}</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span className="truncate">{agentLabel(diagnostics)}</span>
                {diagnostics.project.previousAcpVersion && (
                  <button className="shrink-0 text-primary hover:underline" onClick={() => void rollbackAcp()}>
                    {t('detail.rollbackAcp', { version: diagnostics.project.previousAcpVersion })}
                  </button>
                )}
              </dd>
              <dt className="text-muted-foreground">{t('detail.logsDir')}</dt>
              <DataDirRow path={diagnostics.logsDir} onOpen={() => void openDataDir('logs')} />
              <dt className="text-muted-foreground">{t('detail.snapshotsDir')}</dt>
              <DataDirRow path={diagnostics.snapshotsDir} onOpen={() => void openDataDir('snapshots')} />
            </dl>
            {openError && <p className="text-xs text-destructive">{openError}</p>}

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void window.shovel.projects.openTerminal(diagnostics.project.id)}
              >
                {t('detail.openTerminal')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void window.shovel.projects.stop(diagnostics.project.id)}
              >
                {t('detail.stop')}
              </Button>
            </div>

            <NetworkBlocksSection projectId={diagnostics.project.id} sandboxName={diagnostics.project.sandboxName} />

            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">{t('detail.diagnostics')}</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
                {summaryText()}
              </pre>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={!diagnostics} onClick={() => void copyAll()}>
            {copied ? t('detail.copied') : t('detail.copyAll')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** ディレクトリのパスと、OS のファイルマネージャーで開くボタンを表示する。 */
function DataDirRow({ path, onOpen }: { path: string; onOpen: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <dd className="flex min-w-0 items-center gap-2">
      <span className="truncate" title={path}>
        {path}
      </span>
      <button className="shrink-0 text-primary hover:underline" onClick={onOpen}>
        {t('detail.openDir')}
      </button>
    </dd>
  )
}

/** `Claude Agent 0.85.1` の形。版が未記録なら名前だけ。 */
function agentLabel(diagnostics: ProjectDiagnostics): string {
  const { agentName, project } = diagnostics
  return project.acpVersion ? `${agentName} ${project.acpVersion}` : agentName
}

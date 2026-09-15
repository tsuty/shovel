import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectDiagnostics } from '@shared/ipc'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../shared/components/ui/dialog'
import { Button } from '../shared/components/ui/button'

/**
 * ui.md §2「プロジェクトの詳細」。基本情報・操作（停止/OSターミナル）・
 * 診断情報（`sbx diagnose` 出力、`sbx ls --json` の該当エントリ）をまとめ、
 * 丸ごとクリップボードにコピーできる（decisions.md N-2-6）。
 *
 * ACP トラフィックログ・エージェントの stderr はセッション単位のファイルで
 * 保存されており（`src/main/log.ts`）、プロジェクトへの逆引きは未実装のため
 * ここには含めていない（follow-up）。
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

  useEffect(() => {
    if (!open || !projectId) return
    setDiagnostics(null)
    void window.shovel.projects.diagnostics(projectId).then(setDiagnostics)
  }, [open, projectId])

  function summaryText(): string {
    if (!diagnostics) return ''
    return [
      `# ${diagnostics.project.displayName}`,
      `hostPath: ${diagnostics.project.hostPath}`,
      `sandboxName: ${diagnostics.project.sandboxName}`,
      `sandboxId: ${diagnostics.project.sandboxId}`,
      `agentId: ${diagnostics.project.agentId}`,
      '',
      '## sbx diagnose',
      diagnostics.diagnoseOutput,
      '',
      '## sbx ls --json (this project)',
      JSON.stringify(diagnostics.sbxLsEntry, null, 2)
    ].join('\n')
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
              <dd>{diagnostics.project.agentId}</dd>
            </dl>

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

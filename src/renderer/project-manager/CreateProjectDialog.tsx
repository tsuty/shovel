import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentEntry } from '@shared/types/project'
import type { ImportableSandbox, ProjectProgress } from '@shared/ipc'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../shared/components/ui/dialog'
import { Button } from '../shared/components/ui/button'
import { Input } from '../shared/components/ui/input'
import { Checkbox } from '../shared/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../shared/components/ui/tabs'
import { friendlyErrorMessage } from '../shared/friendlyError'

type Flow = 'new' | 'existing' | 'sandbox'

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [flow, setFlow] = useState<Flow>('new')
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [progress, setProgress] = useState<ProjectProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void window.shovel.agents.list().then(setAgents)
    return window.shovel.projects.onProgress(setProgress)
  }, [open])

  useEffect(() => {
    if (!open) {
      setProgress(null)
      setError(null)
      setBusy(false)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('createFlow.title')}</DialogTitle>
        </DialogHeader>

        <Tabs value={flow} onValueChange={(v) => setFlow(v as Flow)}>
          <TabsList>
            <TabsTrigger value="new">{t('createFlow.tabNew')}</TabsTrigger>
            <TabsTrigger value="existing">{t('createFlow.tabExisting')}</TabsTrigger>
            <TabsTrigger value="sandbox">{t('createFlow.tabSandbox')}</TabsTrigger>
          </TabsList>
          <TabsContent value="new" className="pt-4">
            <NewDirForm
              agents={agents}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onCreated={onCreated}
            />
          </TabsContent>
          <TabsContent value="existing" className="pt-4">
            <ExistingDirForm
              agents={agents}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onCreated={onCreated}
            />
          </TabsContent>
          <TabsContent value="sandbox" className="pt-4">
            <ExistingSandboxForm open={open && flow === 'sandbox'} busy={busy} setBusy={setBusy} setError={setError} onCreated={onCreated} />
          </TabsContent>
        </Tabs>

        {progress && <p className="mt-3 text-xs text-muted-foreground">{progress.message}</p>}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}

function sanitizeSandboxNamePreview(seed: string): string {
  return (
    seed
      .replace(/[^a-zA-Z0-9.+-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

function NewDirForm(props: {
  agents: AgentEntry[]
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  onCreated: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { agents, busy, setBusy, setError, onCreated } = props
  const [agentId, setAgentId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [baseDir, setBaseDir] = useState('')
  const [dirName, setDirName] = useState('')

  useEffect(() => {
    if (agents.length > 0 && !agentId) setAgentId(agents[0]!.id)
  }, [agents, agentId])
  useEffect(() => {
    if (displayName && !dirName) setDirName(displayName)
  }, [displayName, dirName])

  const sandboxName = sanitizeSandboxNamePreview(dirName || displayName)
  const canSubmit = agentId && displayName && baseDir && dirName && !busy

  async function pickBaseDir(): Promise<void> {
    const dir = await window.shovel.projects.pickBaseDirectory()
    if (dir) setBaseDir(dir)
  }

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.shovel.projects.createNewDir({
        agentId,
        displayName,
        baseDir,
        dirName,
        sandboxName
      })
      onCreated()
    } catch (err) {
      setError(friendlyErrorMessage(err instanceof Error ? err.message : String(err), t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('createFlow.agent')}>
        <select
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('createFlow.projectName')}>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
      </Field>
      <Field label={t('createFlow.baseDirectory')}>
        <div className="flex gap-2">
          <Input value={baseDir} readOnly placeholder={t('createFlow.selectDirectory')} />
          <Button type="button" variant="outline" onClick={() => void pickBaseDir()}>
            {t('createFlow.browse')}
          </Button>
        </div>
      </Field>
      <Field label={t('createFlow.projectPath')}>
        <Input value={dirName} onChange={(e) => setDirName(e.target.value)} />
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {baseDir ? `${baseDir}/${dirName}` : dirName}
        </p>
      </Field>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">{t('createFlow.details')}</summary>
        <div className="mt-2 flex flex-col gap-2">
          <Field label={t('createFlow.sandboxName')}>
            <Input value={sandboxName} readOnly />
          </Field>
        </div>
      </details>
      <DialogFooter>
        <Button disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? t('common.creating') : t('common.create')}
        </Button>
      </DialogFooter>
    </div>
  )
}

function ExistingDirForm(props: {
  agents: AgentEntry[]
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  onCreated: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { agents, busy, setBusy, setError, onCreated } = props
  const [agentId, setAgentId] = useState('')
  const [hostPath, setHostPath] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [ack, setAck] = useState(false)

  useEffect(() => {
    if (agents.length > 0 && !agentId) setAgentId(agents[0]!.id)
  }, [agents, agentId])

  async function pickDir(): Promise<void> {
    const dir = await window.shovel.projects.pickBaseDirectory()
    if (dir) {
      setHostPath(dir)
      if (!displayName) setDisplayName(dir.split(/[\\/]/).pop() ?? dir)
    }
  }

  const canSubmit = agentId && hostPath && displayName && ack && !busy

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.shovel.projects.createExistingDir({ agentId, hostPath, displayName })
      onCreated()
    } catch (err) {
      setError(friendlyErrorMessage(err instanceof Error ? err.message : String(err), t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('createFlow.projectPath')}>
        <div className="flex gap-2">
          <Input value={hostPath} readOnly placeholder={t('createFlow.selectDirectory')} />
          <Button type="button" variant="outline" onClick={() => void pickDir()}>
            {t('createFlow.browse')}
          </Button>
        </div>
      </Field>
      <Field label={t('createFlow.agent')}>
        <select
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('createFlow.projectName')}>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
        <p>{t('createFlow.existingWarning')}</p>
        <label className="mt-2 flex items-center gap-2">
          <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} />
          {t('createFlow.acknowledge')}
        </label>
      </div>
      <DialogFooter>
        <Button disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? t('common.creating') : t('common.create')}
        </Button>
      </DialogFooter>
    </div>
  )
}

function ExistingSandboxForm(props: {
  open: boolean
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  onCreated: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { open, busy, setBusy, setError, onCreated } = props
  const [items, setItems] = useState<ImportableSandbox[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')

  useEffect(() => {
    if (!open) return
    void window.shovel.projects.listImportable().then(setItems)
  }, [open])

  const canSubmit = selected && displayName && !busy

  async function submit(): Promise<void> {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await window.shovel.projects.createFromExisting({ sandboxName: selected, displayName })
      onCreated()
    } catch (err) {
      setError(friendlyErrorMessage(err instanceof Error ? err.message : String(err), t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && <p className="text-sm text-muted-foreground">{t('createFlow.noImportable')}</p>}
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {items.map((item) => (
          <label
            key={item.sandboxId}
            className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
          >
            <input
              type="radio"
              name="sandbox"
              checked={selected === item.sandboxName}
              onChange={() => {
                setSelected(item.sandboxName)
                setDisplayName(item.sandboxName)
              }}
            />
            <span className="font-medium">{item.sandboxName}</span>
            <span className="text-muted-foreground">{item.sbxAgentRaw}</span>
            <span className="ml-auto text-xs text-muted-foreground">{item.hostPath}</span>
          </label>
        ))}
      </div>
      <Field label={t('createFlow.projectName')}>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? t('common.creating') : t('common.create')}
        </Button>
      </DialogFooter>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

import { useEffect, useReducer, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionMeta } from '@shared/types/session'
import type { AttachmentChip } from '@shared/types/transcript'
import { initialTranscriptState, transcriptReducer } from '../transcriptState'
import { flushAllEditors } from '../editorRegistry'
import { registerAttachHandler } from '../attachmentRegistry'
import { subscribeSessionEvents } from '../sessionEvents'
import { LiveThoughtArea, Transcript } from './Transcript'
import { Composer } from './Composer'

function chipFromRelPath(relPath: string): AttachmentChip {
  return { key: relPath, label: relPath.split('/').pop() ?? relPath, path: relPath }
}

export function SessionView({
  sessionId,
  initialMeta,
  initialAttachments = [],
  onOpenFile,
  onStatusChange,
  onRefreshed,
  sendKey
}: {
  sendKey?: 'enter' | 'modEnter'
  sessionId: string
  initialMeta: SessionMeta
  initialAttachments?: string[]
  onOpenFile: (relPath: string) => void
  /** ui.md §4「背景タブの通知」。TabBar が非アクティブなタブに反映する。 */
  onStatusChange?: (status: { sending: boolean; hasPendingPermission: boolean }) => void
  /** ↻ の完了。新しい会話の書き込み先スナップショット id を渡す。 */
  onRefreshed?: (snapshotId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [state, dispatch] = useReducer(transcriptReducer, initialTranscriptState)
  const [meta, setMeta] = useState(initialMeta)
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentChip[]>(() => initialAttachments.map(chipFromRelPath))

  useEffect(() => {
    return subscribeSessionEvents(sessionId, (event) => {
      if (event.type === 'sessionMeta') {
        const { modes, currentModeId, configOptions, usage, commands } = event
        setMeta((prev) => ({ ...prev, modes, currentModeId, configOptions, usage, commands }))
        return
      }
      dispatch(event)
    })
  }, [sessionId])

  // ui.md §7: ファイラーの右クリック「コンテキストに追加」を、今アクティブな
  // セッションのチップへ反映させるための購読。
  useEffect(() => {
    return registerAttachHandler(sessionId, (relPath) => {
      setAttachments((prev) => (prev.some((c) => c.path === relPath) ? prev : [...prev, chipFromRelPath(relPath)]))
    })
  }, [sessionId])

  const hasPendingPermission = Object.values(state.permissions).some((p) => p.status === 'pending')
  // ui.md §4「背景タブの通知」。親（TabBar）へ状態を伝える。onStatusChange を
  // 依存に含めると呼び出し側で新しい関数が渡されるたびに発火してしまうため、
  // sending / hasPendingPermission の実際の変化だけをトリガーにする。
  useEffect(() => {
    onStatusChange?.({ sending, hasPendingPermission })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, hasPendingPermission])

  async function send(text: string): Promise<void> {
    // flows.md §4: 送信時に未保存の Markdown 編集をディスクへフラッシュする
    // （エージェントは IDE のバッファではなくディスクを読むため）。書き込みの
    // 完了を待ってから送る。
    setSending(true)
    try {
      await flushAllEditors()
      await window.shovel.session.prompt(
        sessionId,
        text,
        attachments.map((c) => c.path)
      )
      setAttachments([])
    } finally {
      setSending(false)
    }
  }

  async function stop(): Promise<void> {
    await window.shovel.session.cancel(sessionId)
  }

  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      onRefreshed?.(await window.shovel.session.refresh(sessionId))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center border-b border-border px-1">
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          title={t('mainWindow.refreshTab')}
          disabled={sending || refreshing}
          onClick={() => void refresh()}
        >
          <RotateCw size={13} className={refreshing ? 'animate-spin' : undefined} />
        </button>
      </div>
      <Transcript
        state={state}
        onPermission={(permissionId, optionId) =>
          void window.shovel.session.dispatch({ type: 'permission', sessionId, id: permissionId, optionId })
        }
        onOpenFile={onOpenFile}
        onSubmitChoices={(markdown) => void send(markdown)}
      />
      {state.liveThought && <LiveThoughtArea markdown={state.liveThought.markdown} />}
      <Composer
        sendKey={sendKey}
        meta={meta}
        sending={sending}
        attachments={attachments}
        onRemoveAttachment={(key) => setAttachments((prev) => prev.filter((c) => c.key !== key))}
        onSend={(text) => void send(text)}
        onStop={() => void stop()}
        onSetMode={(modeId) => void window.shovel.session.setMode(sessionId, modeId)}
        onSetConfigOption={(configId, value) =>
          void window.shovel.session.setConfigOption(sessionId, configId, value)
        }
      />
    </div>
  )
}

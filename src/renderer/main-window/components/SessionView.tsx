import { useEffect, useReducer, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionMeta } from '@shared/types/session'
import type { DiffLayout } from '@shared/types/settings'
import type { AttachmentChip } from '@shared/types/transcript'
import { initialTranscriptState, transcriptReducer } from '../transcriptState'
import { flushAllEditors } from '../editorRegistry'
import { notifyTurnEnd } from '../turnEnd'
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
  onTitleChange,
  sendKey,
  diffLayout
}: {
  sendKey?: 'enter' | 'modEnter'
  diffLayout?: DiffLayout
  sessionId: string
  initialMeta: SessionMeta
  initialAttachments?: string[]
  onOpenFile: (relPath: string) => void
  /** 背景タブの通知状態。TabBar が非アクティブなタブに反映する。 */
  onStatusChange?: (status: { sending: boolean; hasPendingPermission: boolean }) => void
  /** ↻ の完了。新しい会話の書き込み先スナップショット id を渡す。 */
  onRefreshed?: (snapshotId: string) => void
  /** エージェントがセッションにタイトルを付けた。 */
  onTitleChange?: (title: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [state, dispatch] = useReducer(transcriptReducer, initialTranscriptState)
  const [meta, setMeta] = useState(initialMeta)
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentChip[]>(() => initialAttachments.map(chipFromRelPath))

  // 購読し直さずに最新のコールバックを呼ぶ。
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    return subscribeSessionEvents(sessionId, (event) => {
      if (event.type === 'sessionMeta') {
        const { modes, currentModeId, configOptions, usage, commands } = event
        setMeta((prev) => ({ ...prev, modes, currentModeId, configOptions, usage, commands }))
        return
      }
      if (event.type === 'title') {
        onTitleChangeRef.current?.(event.title)
        return
      }
      dispatch(event)
    })
  }, [sessionId])

  // ファイラーの「コンテキストに追加」を、このセッションの添付チップへ反映する。
  useEffect(() => {
    return registerAttachHandler(sessionId, (relPath) => {
      setAttachments((prev) => (prev.some((c) => c.path === relPath) ? prev : [...prev, chipFromRelPath(relPath)]))
    })
  }, [sessionId])

  const hasPendingPermission = Object.values(state.permissions).some((p) => p.status === 'pending')
  // sending / hasPendingPermission の変化を親（TabBar）へ伝える。
  useEffect(() => {
    onStatusChange?.({ sending, hasPendingPermission })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, hasPendingPermission])

  async function send(text: string): Promise<void> {
    // 未保存の Markdown 編集をディスクへ書き出してから送信する。
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
      // 中断・失敗でも途中までの編集は残りうるので、成否に関わらず読み直させる。
      notifyTurnEnd()
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
        diffLayout={diffLayout}
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

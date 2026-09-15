import { useEffect, useReducer, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionMeta } from '@shared/types/session'
import type { SessionEnvelope } from '@shared/ipc'
import type { AttachmentChip } from '@shared/types/transcript'
import { initialTranscriptState, transcriptReducer } from '../transcriptState'
import { flushAllEditors } from '../editorRegistry'
import { registerAttachHandler } from '../attachmentRegistry'
import { Transcript } from './Transcript'
import { Composer } from './Composer'

function chipFromRelPath(relPath: string): AttachmentChip {
  return { key: relPath, label: relPath.split('/').pop() ?? relPath, path: relPath }
}

export function SessionView({
  sessionId,
  initialMeta,
  initialAttachments = []
}: {
  sessionId: string
  initialMeta: SessionMeta
  initialAttachments?: string[]
}): React.JSX.Element {
  const { t } = useTranslation()
  const [state, dispatch] = useReducer(transcriptReducer, initialTranscriptState)
  const [meta, setMeta] = useState(initialMeta)
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentChip[]>(() => initialAttachments.map(chipFromRelPath))

  useEffect(() => {
    return window.shovel.session.onEvent((envelope: SessionEnvelope) => {
      if (envelope.sessionId !== sessionId) return
      const event = envelope.event
      if (event.type === 'sessionMeta') {
        const { modes, currentModeId, configOptions } = event
        setMeta((prev) => ({ ...prev, modes, currentModeId, configOptions }))
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

  async function send(text: string): Promise<void> {
    // flows.md §4: 送信時に未保存の Markdown 編集をディスクへフラッシュする
    // （エージェントは IDE のバッファではなくディスクを読むため）。
    flushAllEditors()
    setSending(true)
    try {
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
      await window.shovel.session.refresh(sessionId)
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
      />
      <Composer
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

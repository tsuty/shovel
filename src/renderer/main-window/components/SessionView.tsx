import { useEffect, useReducer, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionMeta } from '@shared/types/session'
import type { SessionEnvelope } from '@shared/ipc'
import { initialTranscriptState, transcriptReducer } from '../transcriptState'
import { flushAllEditors } from '../editorRegistry'
import { Transcript } from './Transcript'
import { Composer } from './Composer'

export function SessionView({
  sessionId,
  initialMeta
}: {
  sessionId: string
  initialMeta: SessionMeta
}): React.JSX.Element {
  const { t } = useTranslation()
  const [state, dispatch] = useReducer(transcriptReducer, initialTranscriptState)
  const [meta, setMeta] = useState(initialMeta)
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

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

  async function send(text: string): Promise<void> {
    // flows.md §4: 送信時に未保存の Markdown 編集をディスクへフラッシュする
    // （エージェントは IDE のバッファではなくディスクを読むため）。
    flushAllEditors()
    setSending(true)
    try {
      await window.shovel.session.prompt(sessionId, text)
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

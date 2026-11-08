import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FileInput,
  FilePenLine,
  Globe,
  Info,
  Lightbulb,
  Search,
  SquareTerminal,
  ToggleRight,
  Trash2,
  User,
  type LucideIcon
} from 'lucide-react'
import type { AskQuestion, ElicitationReply, ToolCallPayload } from '@shared/types/transcript'
import type { DiffLayout } from '@shared/types/settings'
import type { RenderBlock, RenderChoice, RenderPermission, TranscriptState } from '../transcriptState'
import { cn } from '../../shared/lib/utils'
import { Markdown } from '../../shared/components/Markdown'
import { TextDiffView } from '../../shared/components/DiffView'
import { Button } from '../../shared/components/ui/button'
import { ElicitationCard, QuestionMarkdown } from './ElicitationCard'
import { TranscriptImages } from './TranscriptImages'

function blockDomId(id: string): string {
  return `transcript-block-${id}`
}

/**
 * 各 USER ブロックを起点に、次の USER ブロックの直前までを1ターンとしてまとめる
 * （最初の USER ブロックより前は区切りの無いターンとして扱う）。
 */
function splitIntoTurns(order: TranscriptState['order'], blocks: TranscriptState['blocks']) {
  const turns: { userBlockId: string | null; entries: TranscriptState['order'] }[] = []
  let current: { userBlockId: string | null; entries: TranscriptState['order'] } = {
    userBlockId: null,
    entries: []
  }
  for (const entry of order) {
    const isUserBlock = entry.kind === 'block' && blocks[entry.id]?.role === 'USER'
    if (isUserBlock) {
      if (current.entries.length > 0) turns.push(current)
      current = { userBlockId: entry.id, entries: [entry] }
    } else {
      current.entries.push(entry)
    }
  }
  if (current.entries.length > 0) turns.push(current)
  return turns
}

export function Transcript({
  state,
  onPermission,
  onElicitation,
  onOpenFile,
  onSubmitChoices,
  diffLayout = 'split'
}: {
  state: TranscriptState
  onPermission: (permissionId: string, optionId: string) => void
  onElicitation: (elicitationId: string, reply: ElicitationReply) => void
  onOpenFile: (relPath: string) => void
  onSubmitChoices: (markdown: string) => void
  /** Diff ビューを開いたときの表示（設定の既定値）。 */
  diffLayout?: DiffLayout
}): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  /** 追記前に最下部（閾値 24px）にいたか。ユーザーのスクロールのたびに記録し、追記時の追従に使う。 */
  const stickToBottomRef = useRef(true)
  const [diffToolCall, setDiffToolCall] = useState<ToolCallPayload | null>(null)
  // 最下部より下に何かある間は、右下に「最新へ」ボタンを浮かせる。
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)

  function scrollToLatest(): void {
    const container = containerRef.current
    if (!container) return
    stickToBottomRef.current = true
    container.scrollTop = container.scrollHeight
  }

  // 描画の確定と同じタイミングで最下部へ追従させる。
  useLayoutEffect(() => {
    const container = containerRef.current
    if (container && container.clientHeight > 0 && stickToBottomRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [state])

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    function onScroll(): void {
      const distance = container!.scrollHeight - container!.scrollTop - container!.clientHeight
      stickToBottomRef.current = distance < 24
      setShowJumpToLatest(distance > 24)
    }
    // 中身と表示領域の大きさの変化を見て最下部へ追従する。
    const observer = new ResizeObserver(() => {
      // 非表示タブ（display: none）では何もしない。
      if (container.clientHeight === 0) return
      if (stickToBottomRef.current) container.scrollTop = container.scrollHeight
      else onScroll()
    })
    observer.observe(content)
    observer.observe(container)
    container.addEventListener('scroll', onScroll)
    return () => {
      observer.disconnect()
      container.removeEventListener('scroll', onScroll)
    }
  }, [])

  function jumpToTurnStart(userBlockId: string): void {
    document.getElementById(blockDomId(userBlockId))?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const turns = splitIntoTurns(state.order, state.blocks)

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={containerRef} className="h-full overflow-y-auto px-4 py-3">
        <div ref={contentRef} className="flex flex-col gap-3">
          {turns.map((turn, turnIndex) => (
            <div key={turn.userBlockId ?? `turn-${turnIndex}`} className="flex flex-col gap-3">
              {turn.entries.map((entry) =>
                entry.kind === 'block' ? (
                  <div key={entry.id} id={blockDomId(entry.id)}>
                    <BlockView
                      block={state.blocks[entry.id]!}
                      onOpenFile={onOpenFile}
                      onSubmitChoices={onSubmitChoices}
                    />
                  </div>
                ) : entry.kind === 'elicitation' ? (
                  <ElicitationCard key={entry.id} elicitation={state.elicitations[entry.id]!} onReply={onElicitation} />
                ) : (
                  <GroupView
                    key={entry.id}
                    closed={state.groups[entry.id]?.closed ?? false}
                    toolCalls={state.toolCallsByGroup[entry.id] ?? []}
                    permissions={state.permissions}
                    onPermission={onPermission}
                    onOpenFile={onOpenFile}
                    onOpenDiff={setDiffToolCall}
                    scrollContainerRef={containerRef}
                  />
                )
              )}
              {turn.userBlockId && (
                <button
                  className="self-start text-transcript-sm text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => jumpToTurnStart(turn.userBlockId!)}
                >
                  {t('transcript.backToTurnStart')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      {showJumpToLatest && (
        <button
          className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs shadow-md hover:bg-accent"
          onClick={scrollToLatest}
        >
          <ArrowDown size={12} />
          {t('transcript.jumpToLatest')}
        </button>
      )}
      {diffToolCall && <DiffModal toolCall={diffToolCall} initialLayout={diffLayout} onClose={() => setDiffToolCall(null)} />}
    </div>
  )
}

// choices として抜き出した行を prose から取り除く（main/acp/translate.ts の TASK_LIST_LINE と同じパターン）。
const TASK_LIST_LINE = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/

function stripChoiceLines(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !TASK_LIST_LINE.test(line))
    .join('\n')
    .trim()
}

/** クリップボードに書き込み、ボタンのアイコンを一時的にチェックマークへ切り替えて完了を示す。 */
function useCopyFeedback(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  function copy(text: string): void {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1200)
  }
  return [copied, copy]
}

/** エージェントの `notice`。見出しと補足を1行で出し、`severity` で色を変える。 */
function AgentNoticeView({ block }: { block: RenderBlock }): React.JSX.Element {
  const severity = block.agentNotice?.severity
  const description = block.agentNotice?.description
  return (
    <div
      className={cn(
        'text-center text-transcript-sm',
        severity === 'error'
          ? 'text-destructive'
          : severity === 'warning'
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-muted-foreground'
      )}
    >
      {block.markdown}
      {description && <span className="opacity-80">{` — ${description}`}</span>}
    </div>
  )
}

/** 文言のあるターンの停止理由。`cancelled` 以外は、返信が途中で終わったことを目立たせる。 */
const STOP_REASONS = ['cancelled', 'max_tokens', 'max_turn_requests', 'refusal']

/** ターンが `end_turn` 以外で終わった理由を1行で出す。 */
function StopReasonView({ reason }: { reason: string }): React.JSX.Element {
  const { t } = useTranslation()
  const known = STOP_REASONS.includes(reason)
  return (
    <div
      className={cn(
        'text-center text-transcript-sm',
        known && reason !== 'cancelled' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
      )}
    >
      {known ? t(`transcript.stopReason.${reason}`) : t('transcript.stopReason.other', { reason })}
    </div>
  )
}

/** コンテキストの圧縮。状態を1行で出し、要約は畳んでおく。 */
function CompactionView({ block }: { block: RenderBlock }): React.JSX.Element {
  const { t } = useTranslation()
  const status = block.compaction?.status ?? 'completed'
  const known = ['in_progress', 'completed', 'failed', 'cancelled'].includes(status)
  const label = known ? t(`transcript.compaction.${status}`) : t('transcript.compaction.other', { status })
  const error = block.compaction?.error
  const heading = (
    <span className={cn(status === 'failed' && 'text-destructive')}>
      {label}
      {error && ` — ${error}`}
    </span>
  )
  if (!block.markdown) {
    return <div className="text-center text-transcript-sm text-muted-foreground">{heading}</div>
  }
  return (
    <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-transcript-sm text-muted-foreground">
      <summary className="cursor-pointer select-none">{heading}</summary>
      <Markdown className="mt-2 text-transcript" text={block.markdown} />
    </details>
  )
}

function BlockView({
  block,
  onOpenFile,
  onSubmitChoices
}: {
  block: RenderBlock
  onOpenFile: (relPath: string) => void
  onSubmitChoices: (markdown: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, copy] = useCopyFeedback()

  if (block.role === 'THOUGHT') {
    return (
      <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-transcript text-muted-foreground">
        <summary className="cursor-pointer select-none">{t('transcript.thinking')}</summary>
        <div className="mt-2 whitespace-pre-wrap">{block.markdown}</div>
      </details>
    )
  }
  if (block.role === 'COMPACTION') {
    return <CompactionView block={block} />
  }
  if (block.agentNotice) {
    return <AgentNoticeView block={block} />
  }
  if (block.stopReason) {
    return <StopReasonView reason={block.stopReason} />
  }
  if (block.role === 'SYSTEM' || block.role === 'COMPLETION') {
    return (
      <div className="text-center text-transcript-sm text-muted-foreground">
        {block.noticeKey ? t(`transcript.notice.${block.noticeKey}`) : block.markdown}
      </div>
    )
  }
  if (block.role === 'ERROR') {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-transcript text-destructive">
        {block.markdown}
      </div>
    )
  }

  const label = block.role === 'USER' ? t('transcript.you') : block.role === 'PLAN' ? t('transcript.plan') : t('transcript.agent')
  const LabelIcon = block.role === 'USER' ? User : block.role === 'AGENT' ? Bot : null

  return (
    <div
      className={cn(
        // 名前付き group にして、内側のコードブロックのコピー ボタンと区別する。
        'group/message rounded-md border border-border px-3 py-2',
        // 自分の発言は背景色をわずかに変える。
        block.role === 'PLAN' && 'bg-muted/20',
        block.role === 'USER' && 'bg-muted/50'
      )}
    >
      <div className="mb-1 flex items-center justify-between text-transcript-sm font-medium text-muted-foreground">
        <span className="flex items-center gap-1">
          {LabelIcon && <LabelIcon size={12} />}
          {label}
        </span>
        {!block.streaming && (
          <button
            className="opacity-0 transition-opacity hover:text-foreground group-hover/message:opacity-100"
            title={t('transcript.copy')}
            onClick={() => copy(block.markdown)}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}
      </div>
      {block.chips && block.chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {block.chips.map((chip) => (
            <button
              key={chip.key}
              className="rounded-full border border-border bg-muted px-2 py-0.5 text-transcript-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              title={chip.path}
              onClick={() => onOpenFile(chip.path)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
      {block.streaming ? (
        <div className="whitespace-pre-wrap text-transcript">{block.markdown}</div>
      ) : (
        <Markdown
          className="text-transcript"
          text={block.choices ? stripChoiceLines(block.markdown) : block.markdown}
          onOpenFileLink={onOpenFile}
          collapseCodeBlocks
        />
      )}
      {block.images && block.images.length > 0 && <TranscriptImages images={block.images} className="mt-2" />}
      {block.choices && block.choices.length > 0 && (
        <ChoicesView choices={block.choices} onSubmit={onSubmitChoices} />
      )}
    </div>
  )
}

function ChoicesView({
  choices,
  onSubmit
}: {
  choices: RenderChoice[]
  onSubmit: (markdown: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)

  function toggle(id: string): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function submit(): void {
    const markdown = choices.map((c) => `- [${checked.has(c.id) ? 'x' : ' '}] ${c.label}`).join('\n')
    setSubmitted(true)
    onSubmit(markdown)
  }

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
      {choices.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-transcript">
          <input type="checkbox" disabled={submitted} checked={checked.has(c.id)} onChange={() => toggle(c.id)} />
          {c.label}
        </label>
      ))}
      <div className="mt-1 flex justify-end">
        <Button size="sm" disabled={submitted} onClick={submit}>
          {t('transcript.sendChoices')}
        </Button>
      </div>
    </div>
  )
}

const KIND_VERBS: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  search: 'Search',
  execute: 'Run',
  fetch: 'Fetch',
  switch_mode: 'Switch mode',
  think: 'Think',
  other: 'Tool'
}

/** ツールコールの種類ごとのアイコン。知らない種類は other。 */
const KIND_ICONS: Record<string, LucideIcon> = {
  read: Eye,
  edit: FilePenLine,
  delete: Trash2,
  move: FileInput,
  search: Search,
  execute: SquareTerminal,
  think: Lightbulb,
  fetch: Globe,
  switch_mode: ToggleRight,
  other: Info
}

/** 折り畳んだグループの要約に使う内訳（「Read ×3, Edit ×2」）。並びは初出順。 */
function kindBreakdown(toolCalls: ToolCallPayload[]): string {
  const counts = new Map<string, number>()
  for (const tc of toolCalls) {
    const verb = KIND_VERBS[tc.kind] ?? 'Tool'
    counts.set(verb, (counts.get(verb) ?? 0) + 1)
  }
  return [...counts].map(([verb, n]) => `${verb} ×${n}`).join(', ')
}

function toolCallLine(tc: ToolCallPayload): string {
  const verb = KIND_VERBS[tc.kind] ?? 'Tool'
  return `${verb} ${tc.title}`
}

// read/delete/move は1行で展開しない。switch_mode は plan 本文を常時展開する。
// それ以外は content か質問（ask）があれば末尾のキャレットで展開できる。
const NON_EXPANDABLE_KINDS = new Set<ToolCallPayload['kind']>(['read', 'delete', 'move', 'switch_mode'])

function GroupView({
  closed,
  toolCalls,
  permissions,
  onPermission,
  onOpenFile,
  onOpenDiff,
  scrollContainerRef
}: {
  closed: boolean
  toolCalls: ToolCallPayload[]
  permissions: Record<string, RenderPermission>
  onPermission: (permissionId: string, optionId: string) => void
  onOpenFile: (relPath: string) => void
  onOpenDiff: (toolCall: ToolCallPayload) => void
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const { t } = useTranslation()
  const pendingByToolCall = new Map<string, RenderPermission>()
  for (const p of Object.values(permissions)) {
    if (p.status === 'pending') pendingByToolCall.set(p.toolCallId, p)
  }

  // 作業中のグループは開いておき、閉じたら畳む。ユーザーが開閉したらそれを優先し、
  // 許可待ちのカードがある間は隠さない。
  const [groupOpenOverride, setGroupOpenOverride] = useState<boolean | null>(null)
  const groupOpen = pendingByToolCall.size > 0 || (groupOpenOverride ?? !closed)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const rowRefs = useRef(new Map<string, HTMLElement>())
  // トグルの前後で、クリックした行の画面上の位置を保つ。
  const pendingScrollAdjust = useRef<{ id: string; prevTop: number } | null>(null)

  function toggleExpand(id: string): void {
    const rowEl = rowRefs.current.get(id)
    if (rowEl) pendingScrollAdjust.current = { id, prevTop: rowEl.getBoundingClientRect().top }
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useLayoutEffect(() => {
    const pending = pendingScrollAdjust.current
    pendingScrollAdjust.current = null
    if (!pending) return
    const rowEl = rowRefs.current.get(pending.id)
    const container = scrollContainerRef.current
    if (!rowEl || !container) return
    const newTop = rowEl.getBoundingClientRect().top
    container.scrollTop += newTop - pending.prevTop
  }, [expanded, scrollContainerRef])

  return (
    <div className="text-transcript-sm">
      <button
        className="flex max-w-full items-center gap-1 text-muted-foreground hover:text-foreground"
        onClick={() => setGroupOpenOverride(!groupOpen)}
      >
        {groupOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
        <span className="truncate">
          {!closed && `${t('transcript.working')} `}
          {t('transcript.toolCallSummary', { count: toolCalls.length, breakdown: kindBreakdown(toolCalls) })}
        </span>
      </button>
      <ul className={cn('mt-1 flex flex-col gap-1 pl-4', !groupOpen && 'hidden')}>
        {toolCalls.map((tc) => {
          const permission = pendingByToolCall.get(tc.id)
          const hasImages = !!tc.images && tc.images.length > 0
          const canExpand = !NON_EXPANDABLE_KINDS.has(tc.kind) && (!!tc.content || !!tc.ask || hasImages)
          const isExpanded = expanded.has(tc.id)
          const KindIcon = KIND_ICONS[tc.kind] ?? Info
          return (
            <li
              key={tc.id}
              ref={(el) => {
                if (el) rowRefs.current.set(tc.id, el)
                else rowRefs.current.delete(tc.id)
              }}
            >
              <div className="flex items-center gap-1">
                {/* 展開できない行にも同じ幅を空けて、アイコンの縦位置を揃える。 */}
                {canExpand ? (
                  <button
                    className="w-3 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => toggleExpand(tc.id)}
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <KindIcon
                  className={cn(
                    'h-[1.15em] w-[1.15em] shrink-0',
                    tc.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                  )}
                  aria-hidden
                />
                <div className="truncate" title={toolCallLine(tc)}>
                  {toolCallLine(tc)}
                  {tc.diffs.length > 0 && (
                    <span className="ml-2 text-muted-foreground">
                      +{tc.diffs.reduce((s, d) => s + d.added, 0)} -{tc.diffs.reduce((s, d) => s + d.removed, 0)}
                    </span>
                  )}
                </div>
              </div>
              {(tc.locations.length > 0 || tc.diffs.length > 0) && (
                <div className="ml-[calc(1.25rem+1.15em)] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-transcript-xs">
                  {tc.locations.map((loc, i) => (
                    <button
                      key={i}
                      className="truncate text-primary hover:underline"
                      onClick={() => onOpenFile(loc.path)}
                    >
                      {loc.path}
                      {loc.line ? `:${loc.line}` : ''}
                    </button>
                  ))}
                  {tc.diffs.length > 0 && (
                    <button className="text-primary hover:underline" onClick={() => onOpenDiff(tc)}>
                      {t('transcript.viewDiff')}
                    </button>
                  )}
                </div>
              )}
              {canExpand && isExpanded && tc.ask && <AskQuestionsView questions={tc.ask} />}
              {canExpand && isExpanded && !tc.ask && tc.content && (
                <div className="ml-[calc(1.25rem+1.15em)] mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-muted/40 px-2 py-1 text-transcript-xs text-muted-foreground">
                  {tc.content}
                </div>
              )}
              {canExpand && isExpanded && !tc.ask && tc.images && tc.images.length > 0 && (
                <TranscriptImages images={tc.images} className="ml-[calc(1.25rem+1.15em)] mt-1" />
              )}
              {permission && <PermissionCard permission={permission} onPermission={onPermission} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * ユーザーへの質問ツールの行を開いたときの中身。尋ねた質問と選択肢をそのまま並べる
 * （何と答えたかはツールコールには含まれない）。選択肢の `preview` は「プレビュー」で開閉する。
 * 見出しと選択肢の名前はプレーンテキスト、それ以外は質問カードと同じく `QuestionMarkdown` で描く。
 */
function AskQuestionsView({ questions }: { questions: AskQuestion[] }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="ml-[calc(1.25rem+1.15em)] mt-1 flex flex-col gap-2 rounded border border-border px-2 py-1.5 text-transcript-xs">
      {questions.map((question, i) => (
        <div key={i} className={cn('flex flex-col gap-1', i > 0 && 'border-t border-dotted border-border pt-2')}>
          {question.header && <div className="font-medium text-muted-foreground">{question.header}</div>}
          <QuestionMarkdown className="text-transcript-xs" text={question.question} />
          <div className="text-muted-foreground">
            {t(question.multiSelect ? 'transcript.ask.selectMany' : 'transcript.ask.selectOne')}
          </div>
          <ul className="flex flex-col gap-1">
            {question.options.map((option, j) => (
              <AskOptionRow key={j} option={option} multiSelect={question.multiSelect} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function AskOptionRow({
  option,
  multiSelect
}: {
  option: AskQuestion['options'][number]
  multiSelect: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [showPreview, setShowPreview] = useState(false)
  return (
    <li className="flex items-start gap-1.5">
      {/* 記号は1行目の高さの中で上下中央に置く（文字の記号はフォントで位置がずれるので枠線で描く）。 */}
      <span className="flex h-[1lh] shrink-0 items-center" aria-hidden>
        <span
          className={cn('h-[0.8em] w-[0.8em] border border-muted-foreground', multiSelect ? 'rounded-[2px]' : 'rounded-full')}
        />
      </span>
      <div className="flex min-w-0 flex-col">
        <span>{option.label}</span>
        {option.description && <QuestionMarkdown className="text-transcript-xs text-muted-foreground" text={option.description} />}
        {option.preview && (
          <>
            <button
              className="self-start text-primary hover:underline"
              aria-expanded={showPreview}
              onClick={() => setShowPreview((v) => !v)}
            >
              {t('transcript.ask.preview')}
            </button>
            {showPreview && (
              <div className="mt-0.5 max-h-48 overflow-auto rounded border border-border bg-background px-2 py-1">
                <QuestionMarkdown preformatted className="font-mono text-transcript-xs" text={option.preview} />
              </div>
            )}
          </>
        )}
      </div>
    </li>
  )
}

function PermissionCard({
  permission,
  onPermission
}: {
  permission: RenderPermission
  onPermission: (permissionId: string, optionId: string) => void
}): React.JSX.Element {
  return (
    <div className="mt-2 rounded-md border border-l-4 border-border border-l-primary p-2">
      <div className="mb-1 text-transcript font-medium">{permission.headline}</div>
      {permission.bodyMarkdown && <Markdown className="text-transcript" text={permission.bodyMarkdown} />}
      <div className="mt-2 flex flex-wrap gap-2">
        {permission.options.map((opt) => (
          <button
            key={opt.optionId}
            className={cn(
              'rounded-md border px-2 py-1 text-transcript-sm',
              opt.kind.startsWith('allow')
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-transparent'
            )}
            disabled={permission.status !== 'pending'}
            onClick={() => onPermission(permission.id, opt.optionId)}
          >
            {opt.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * ツールコールの diff の行数の増減を表示し、クリックで Diff ビューを開く。表示（左右／1列）の
 * 既定値は設定から受け取り、見出しのトグルではこのモーダルを開いている間だけ切り替える。
 * 左右のときは2列分の幅をとるため、モーダルを広げる。
 */
function DiffModal({
  toolCall,
  initialLayout,
  onClose
}: {
  toolCall: ToolCallPayload
  initialLayout: DiffLayout
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [layout, setLayout] = useState(initialLayout)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={cn(
          'flex max-h-[80vh] flex-col rounded-lg border bg-card p-4',
          layout === 'split' ? 'w-[90vw] max-w-7xl' : 'w-[80vw] max-w-3xl'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <h3 className="truncate text-sm font-medium">{toolCall.title}</h3>
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label={t('diff.layout')}>
              {(['split', 'unified'] as const).map((value) => (
                <button
                  key={value}
                  className={cn(
                    'rounded px-2 py-0.5',
                    layout === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                  aria-pressed={layout === value}
                  onClick={() => setLayout(value)}
                >
                  {t(value === 'split' ? 'diff.split' : 'diff.unified')}
                </button>
              ))}
            </div>
            <button className="text-xs text-muted-foreground hover:underline" onClick={onClose}>
              {t('common.dismiss')}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {toolCall.diffs.map((diff, i) => (
            <div key={i} className="mb-4 last:mb-0">
              <div className="mb-1 flex items-baseline gap-2 text-xs text-muted-foreground">
                <span className="truncate">{diff.path}</span>
                <span className="shrink-0">
                  +{diff.added} -{diff.removed}
                </span>
              </div>
              <TextDiffView
                oldText={diff.oldText ?? ''}
                newText={diff.newText ?? ''}
                layout={layout}
                className="rounded border border-border py-1"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * ストリーミング中の思考を入力欄の上に直近数行だけ表示する。確定するとトランスクリプト本体の
 * 折り畳みへ移るので、ストリーミング中しか現れない。
 */
export function LiveThoughtArea({ markdown }: { markdown: string }): React.JSX.Element {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [markdown])

  return (
    <div className="border-t border-border bg-muted/30 px-3 py-1.5 text-transcript-sm text-muted-foreground">
      <div className="mb-1 font-medium">{t('transcript.thinking')}</div>
      <div ref={scrollRef} className="max-h-16 overflow-y-auto whitespace-pre-wrap">
        {markdown}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Tree, type NodeRendererProps, type TreeApi } from 'react-arborist'
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Link,
  PanelRight,
  RefreshCw,
  SquarePen,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FsEntry } from '@shared/types/filer'
import { cn } from '../../shared/lib/utils'
import { MenuItem } from './MenuItem'

interface FsNode extends FsEntry {
  children?: FsNode[]
  /** `readdir` に失敗したディレクトリの下に置く「…」の1行。開く・右クリック・D&D の対象にしない。 */
  placeholder?: true
}

/** 失敗したディレクトリの下に置くプレースホルダ。id は実在のパスと衝突しない形にする。 */
function unreadablePlaceholder(dirRelPath: string): FsNode {
  return {
    relPath: `${dirRelPath}/\u0000unreadable`,
    name: '…',
    isDir: false,
    ignored: false,
    placeholder: true
  }
}

interface ClipboardEntry {
  relPath: string
  /**
   * アプリ内で「コピー」した時点で OS のクリップボードにあったファイル一覧。
   * 貼り付け時に OS 側の一覧がこれと違えば、アプリ外のファイルを貼り付ける。
   */
  osSignature: string
}

/** 一覧を読み直したとき、残っているディレクトリの読み込み済みの中身を引き継ぐ。 */
function mergeLoadedChildren(fresh: FsNode[], previous: FsNode[] | undefined): FsNode[] {
  if (!previous) return fresh
  const byPath = new Map(previous.map((node) => [node.relPath, node]))
  return fresh.map((node) => {
    const old = byPath.get(node.relPath)
    return node.isDir && old?.isDir && old.children ? { ...node, children: old.children } : node
  })
}

/** 「OS のファイラーで開く」の文言を OS に合わせて返す。 */
function openInOsLabelKey(): string {
  if (window.shovel.platform === 'darwin') return 'filer.openInFinder'
  if (window.shovel.platform === 'win32') return 'filer.openInExplorer'
  return 'filer.openInFileManager'
}

function toNode(entry: FsEntry): FsNode {
  return entry.isDir ? { ...entry, children: [] } : { ...entry }
}

function findNode(nodes: FsNode[], relPath: string): FsNode | null {
  for (const node of nodes) {
    if (node.relPath === relPath) return node
    if (node.children) {
      const found = findNode(node.children, relPath)
      if (found) return found
    }
  }
  return null
}

function replaceChildren(nodes: FsNode[], relPath: string, children: FsNode[]): FsNode[] {
  return nodes.map((node) => {
    if (node.relPath === relPath) return { ...node, children }
    if (node.children) return { ...node, children: replaceChildren(node.children, relPath, children) }
    return node
  })
}

/** 右クリックされたノード（無ければルート）から見た「作成/貼り付け先ディレクトリ」を決める。 */
function targetDirFor(node: FsNode | null): string {
  if (!node) return ''
  if (node.isDir) return node.relPath
  return node.relPath.includes('/') ? node.relPath.slice(0, node.relPath.lastIndexOf('/')) : ''
}

/**
 * `react-arborist` による遅延展開のファイルツリー。`.gitignore` 対象は薄く表示する。
 * 見出しの更新ボタンで展開中のフォルダを読み直す。アプリ外からの貼り付け・ドロップはコピーとして取り込む。
 */
export function Filer({
  projectId,
  onOpenFile,
  onAddToContext,
  onAttachMarkdown,
  canAttachMarkdown
}: {
  projectId: string
  onOpenFile: (relPath: string, isMarkdown: boolean) => void
  onAddToContext: (relPath: string) => void
  /** Markdown を今のチャットタブの右に添える。 */
  onAttachMarkdown: (relPath: string) => void
  canAttachMarkdown: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [data, setDataState] = useState<FsNode[]>([])
  /** ツリーの最新値。読み直しの計算はここを基準に同期的に行う。 */
  const dataRef = useRef<FsNode[]>([])
  function setData(next: FsNode[]): void {
    dataRef.current = next
    setDataState(next)
  }
  /** 右クリックメニューを開いた時点で OS のクリップボードにあったファイル。 */
  const [osClipboardFiles, setOsClipboardFiles] = useState<string[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [loadedDirs, setLoadedDirs] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; node: FsNode | null } | null>(null)
  const [renaming, setRenaming] = useState<FsNode | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardEntry | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<TreeApi<FsNode> | undefined>(undefined)
  const [containerHeight, setContainerHeight] = useState(400)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerHeight(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  async function loadDir(relPath: string): Promise<FsNode[]> {
    let entries: FsEntry[]
    try {
      entries = await window.shovel.fs.list(projectId, relPath)
    } catch {
      // 失敗したら淡色の「…」を1行出す。読み込み済みにはしないので、開き直せば再試行する。
      if (relPath !== '') setData(replaceChildren(dataRef.current, relPath, [unreadablePlaceholder(relPath)]))
      return []
    }
    const current = dataRef.current
    const nodes = mergeLoadedChildren(
      entries.map(toNode),
      relPath === '' ? current : findNode(current, relPath)?.children
    )
    setData(relPath === '' ? nodes : replaceChildren(current, relPath, nodes))
    // 中身を引き継いだサブフォルダ以外の配下は「読み込み済み」の印を外す。
    const keptDirs = new Set(nodes.filter((node) => node.isDir && node.children?.length).map((node) => node.relPath))
    setLoadedDirs((prev) => {
      const prefix = relPath ? `${relPath}/` : ''
      const next = new Set<string>()
      for (const dir of prev) {
        if (dir === relPath || !dir.startsWith(prefix)) {
          next.add(dir)
          continue
        }
        const top = prefix + dir.slice(prefix.length).split('/')[0]
        if (keptDirs.has(top)) next.add(dir)
      }
      return next.add(relPath)
    })
    return nodes
  }

  /** 見出しの更新ボタン: 読み込み済み（展開したことのある）フォルダを浅い順に読み直す。 */
  async function refreshAll(): Promise<void> {
    setRefreshing(true)
    try {
      const dirs = [...loadedDirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
      if (!dirs.includes('')) dirs.unshift('')
      for (const dir of dirs) await loadDir(dir)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    setLoadedDirs(new Set())
    void loadDir('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  function handleToggle(id: string): void {
    if (loadedDirs.has(id)) return
    void loadDir(id)
  }

  function handleActivate(node: FsNode): void {
    if (node.isDir || node.placeholder) return
    onOpenFile(node.relPath, node.name.toLowerCase().endsWith('.md'))
  }

  async function refreshParent(relPath: string): Promise<void> {
    const parent = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
    await loadDir(parent)
  }

  async function copyPath(node: FsNode): Promise<void> {
    await navigator.clipboard.writeText(node.relPath)
    setMenu(null)
  }

  async function handleDelete(node: FsNode): Promise<void> {
    setMenu(null)
    await window.shovel.fs.remove(projectId, node.relPath)
    await refreshParent(node.relPath)
  }

  async function commitRename(node: FsNode, newName: string): Promise<void> {
    setRenaming(null)
    if (!newName || newName === node.name) return
    await window.shovel.fs.rename(projectId, node.relPath, newName)
    await refreshParent(node.relPath)
  }

  /** 作成/貼り付け後: 対象ディレクトリを開いた上で一覧を再取得する。 */
  async function revealDir(dirRelPath: string): Promise<FsNode[]> {
    if (dirRelPath) treeRef.current?.open(dirRelPath)
    return loadDir(dirRelPath)
  }

  async function handleNewFolder(targetNode: FsNode | null): Promise<void> {
    setMenu(null)
    const parent = targetDirFor(targetNode)
    const newRelPath = await window.shovel.fs.mkdir(projectId, parent)
    const nodes = await revealDir(parent)
    const created = findNode(nodes, newRelPath)
    if (created) setRenaming(created)
  }

  async function handleNewFile(targetNode: FsNode | null): Promise<void> {
    setMenu(null)
    const parent = targetDirFor(targetNode)
    const newRelPath = await window.shovel.fs.createMarkdownFile(projectId, parent)
    const nodes = await revealDir(parent)
    const created = findNode(nodes, newRelPath)
    if (created) setRenaming(created)
  }

  function handleCopy(node: FsNode): void {
    setClipboard({ relPath: node.relPath, osSignature: osClipboardFiles.join('\n') })
    setMenu(null)
  }

  /** アプリ内でのコピーより後に OS 側でファイルがコピーされていれば、そちらを貼り付ける。 */
  function externalFilesToPaste(): string[] {
    if (osClipboardFiles.length === 0) return []
    if (clipboard && clipboard.osSignature === osClipboardFiles.join('\n')) return []
    return osClipboardFiles
  }

  async function handlePaste(targetNode: FsNode | null): Promise<void> {
    setMenu(null)
    const destDir = targetDirFor(targetNode)
    const external = externalFilesToPaste()
    if (external.length > 0) {
      await window.shovel.fs.copyExternal(projectId, external, destDir)
    } else if (clipboard) {
      await window.shovel.fs.copy(projectId, clipboard.relPath, destDir)
    } else {
      return
    }
    await revealDir(destDir)
  }

  function openMenu(e: React.MouseEvent, node: FsNode | null): void {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, node })
    void window.shovel.fs.readClipboardFiles().then(setOsClipboardFiles)
  }

  async function handleOpenInOS(node: FsNode | null): Promise<void> {
    setMenu(null)
    await window.shovel.fs.openInOS(projectId, node?.relPath ?? '')
  }

  /** ドロップ先の行（`data-relpath`）から、取り込み先のディレクトリを決める。 */
  function dropDirFor(target: EventTarget | null): string {
    const row = (target as HTMLElement | null)?.closest('[data-relpath]') as HTMLElement | null
    if (!row) return ''
    const node = findNode(data, row.dataset.relpath ?? '')
    return targetDirFor(node && !node.placeholder ? node : null)
  }

  /** アプリ外からのドロップを、プロジェクト内へのコピーとして取り込む。 */
  async function handleExternalDrop(e: React.DragEvent): Promise<void> {
    setDropTarget(null)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    e.preventDefault()
    const destDir = dropDirFor(e.target)
    const paths = files.map((file) => window.shovel.fs.pathForFile(file)).filter(Boolean)
    if (paths.length === 0) return
    await window.shovel.fs.copyExternal(projectId, paths, destDir)
    await revealDir(destDir)
  }

  return (
    <div className="flex h-full flex-col" onClick={() => setMenu(null)}>
      <div className="flex items-center justify-between border-b border-border px-2 py-1 text-xs">
        <span className="font-medium text-muted-foreground">{t('sidebar.filer')}</span>
        <button
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          title={t('filer.refresh')}
          disabled={refreshing}
          onClick={() => void refreshAll()}
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} />
        </button>
      </div>
      <div
        ref={containerRef}
        className={cn('relative flex-1 overflow-hidden', dropTarget === '' && 'bg-accent/40')}
        onContextMenu={(e) => openMenu(e, null)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          const dir = dropDirFor(e.target)
          if (dir !== dropTarget) setDropTarget(dir)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null)
        }}
        onDrop={(e) => void handleExternalDrop(e)}
      >
        <Tree<FsNode>
          ref={treeRef}
          data={data}
          idAccessor="relPath"
          childrenAccessor="children"
          openByDefault={false}
          width="100%"
          height={containerHeight}
          rowHeight={24}
          onToggle={handleToggle}
          disableDrag={(node) => node.placeholder === true}
          disableDrop={({ parentNode }) => parentNode.data.placeholder === true}
          onActivate={(node) => handleActivate(node.data)}
          onRename={({ id, name }) => {
            const node = findNode(data, id)
            if (node) void commitRename(node, name)
          }}
          onMove={({ dragIds, parentId }) => {
            for (const id of dragIds) {
              void window.shovel.fs.move(projectId, id, parentId ?? '').then(async () => {
                await refreshParent(id)
                await loadDir(parentId ?? '')
              })
            }
          }}
        >
          {(props) =>
            props.node.data.placeholder ? (
              <div
                style={props.style}
                className="flex cursor-default items-center text-sm text-muted-foreground/60"
                title={t('filer.unreadable')}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
              >
                {/* 名前の列（キャレット＋アイコンの右）に揃える */}
                <span className="pl-[38px]">…</span>
              </div>
            ) : (
              <FilerRow
                {...props}
                isRenaming={renaming?.relPath === props.node.data.relPath}
                isDropTarget={dropTarget !== null && dropTarget !== '' && dropTarget === props.node.data.relPath}
                onContextMenu={(e) => openMenu(e, props.node.data)}
                onCommitRename={(name) => void commitRename(props.node.data, name)}
              />
            )
          }
        </Tree>
      </div>
      {menu && (
        <div
          className="fixed z-50 min-w-40 rounded-md border bg-popover p-1 text-sm shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.node && (
            <MenuItem icon={<Link size={14} />} onClick={() => void copyPath(menu.node!)}>
              {t('filer.copyPath')}
            </MenuItem>
          )}
          {menu.node && !menu.node.isDir && (
            <MenuItem
              icon={<FilePlus size={14} />}
              onClick={() => {
                onAddToContext(menu.node!.relPath)
                setMenu(null)
              }}
            >
              {t('filer.addToContext')}
            </MenuItem>
          )}
          {menu.node && !menu.node.isDir && menu.node.name.toLowerCase().endsWith('.md') && (
            <MenuItem
              icon={<PanelRight size={14} />}
              disabled={!canAttachMarkdown}
              onClick={() => {
                onAttachMarkdown(menu.node!.relPath)
                setMenu(null)
              }}
            >
              {t('filer.attachToChat')}
            </MenuItem>
          )}
          {(!menu.node || menu.node.isDir) && (
            <MenuItem icon={<FolderOpen size={14} />} onClick={() => void handleOpenInOS(menu.node)}>
              {t(openInOsLabelKey())}
            </MenuItem>
          )}
          <div className="my-1 border-t border-border" />
          <MenuItem icon={<FolderPlus size={14} />} onClick={() => void handleNewFolder(menu.node)}>
            {t('filer.newFolder')}
          </MenuItem>
          <MenuItem icon={<FileText size={14} />} onClick={() => void handleNewFile(menu.node)}>
            {t('filer.newMarkdownFile')}
          </MenuItem>
          {menu.node && (
            <MenuItem icon={<ClipboardCopy size={14} />} onClick={() => handleCopy(menu.node!)}>
              {t('filer.copy')}
            </MenuItem>
          )}
          {(clipboard || externalFilesToPaste().length > 0) && (
            <MenuItem icon={<ClipboardPaste size={14} />} onClick={() => void handlePaste(menu.node)}>
              {t('filer.paste')}
            </MenuItem>
          )}
          {menu.node && (
            <>
              <div className="my-1 border-t border-border" />
              <MenuItem
                icon={<SquarePen size={14} />}
                onClick={() => {
                  setRenaming(menu.node)
                  setMenu(null)
                }}
              >
                {t('common.rename')}
              </MenuItem>
              <MenuItem icon={<Trash2 size={14} />} onClick={() => void handleDelete(menu.node!)}>
                {t('common.delete')}
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function FilerRow({
  node,
  style,
  dragHandle,
  isRenaming,
  isDropTarget,
  onContextMenu,
  onCommitRename
}: NodeRendererProps<FsNode> & {
  isRenaming: boolean
  /** アプリ外からのドロップの取り込み先として強調する。 */
  isDropTarget: boolean
  onContextMenu: (e: React.MouseEvent) => void
  onCommitRename: (name: string) => void
}): React.JSX.Element {
  const entry = node.data
  const composingRef = useRef(false)
  return (
    <div
      ref={dragHandle}
      style={style}
      data-relpath={entry.relPath}
      className={cn(
        'flex cursor-pointer items-center gap-1 truncate rounded px-1 text-sm hover:bg-accent',
        (node.isSelected || isDropTarget) && 'bg-accent',
        entry.ignored && 'opacity-45'
      )}
      onClick={() => (entry.isDir ? node.toggle() : node.activate())}
      onContextMenu={onContextMenu}
    >
      {entry.isDir ? (
        node.isOpen ? (
          <ChevronDown size={14} className="shrink-0" />
        ) : (
          <ChevronRight size={14} className="shrink-0" />
        )
      ) : (
        <span className="w-[14px] shrink-0" />
      )}
      {entry.isDir ? <Folder size={14} className="shrink-0" /> : <File size={14} className="shrink-0" />}
      {isRenaming ? (
        <input
          autoFocus
          defaultValue={entry.name}
          className="min-w-0 flex-1 rounded border border-input bg-background px-1"
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => {
            // ファイルは拡張子を除いた部分だけを選択状態にする。
            const dot = entry.isDir ? -1 : entry.name.lastIndexOf('.')
            if (dot > 0) e.target.setSelectionRange(0, dot)
            else e.target.select()
          }}
          onCompositionStart={() => (composingRef.current = true)}
          onCompositionEnd={() => (composingRef.current = false)}
          onKeyDown={(e) => {
            // IME 変換中の Enter / Escape は無視する。
            if (composingRef.current || e.nativeEvent.isComposing) return
            if (e.key === 'Enter') onCommitRename((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') onCommitRename(entry.name)
          }}
          onBlur={(e) => onCommitRename(e.target.value)}
        />
      ) : (
        <span className="truncate">{entry.name}</span>
      )}
    </div>
  )
}

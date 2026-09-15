import { useEffect, useRef, useState } from 'react'
import { Tree, type NodeRendererProps } from 'react-arborist'
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FsEntry } from '@shared/types/filer'
import { cn } from '../../shared/lib/utils'

interface FsNode extends FsEntry {
  children?: FsNode[]
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

/**
 * ui.md §9 / decisions.md N-3-4, N-3-5: `react-arborist` による遅延展開の
 * ファイルツリー。`.gitignore` 対象は薄く表示し、`.git` は既定で非表示。
 */
export function Filer({
  projectId,
  onOpenFile
}: {
  projectId: string
  onOpenFile: (relPath: string, isMarkdown: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [data, setData] = useState<FsNode[]>([])
  const [showGit, setShowGit] = useState(false)
  const [loadedDirs, setLoadedDirs] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; node: FsNode } | null>(null)
  const [renaming, setRenaming] = useState<FsNode | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
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

  async function loadDir(relPath: string): Promise<void> {
    const entries = await window.shovel.fs.list(projectId, relPath, showGit)
    const nodes = entries.map(toNode)
    setData((prev) => (relPath === '' ? nodes : replaceChildren(prev, relPath, nodes)))
    setLoadedDirs((prev) => new Set(prev).add(relPath))
  }

  useEffect(() => {
    setLoadedDirs(new Set())
    void loadDir('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, showGit])

  function handleToggle(id: string): void {
    if (loadedDirs.has(id)) return
    void loadDir(id)
  }

  function handleActivate(node: FsNode): void {
    if (node.isDir) return
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

  return (
    <div className="flex h-full flex-col" onClick={() => setMenu(null)}>
      <div className="flex items-center justify-between border-b border-border px-2 py-1 text-xs">
        <span className="font-medium text-muted-foreground">{t('sidebar.filer')}</span>
        <label className="flex items-center gap-1 text-muted-foreground">
          <input type="checkbox" checked={showGit} onChange={(e) => setShowGit(e.target.checked)} />
          .git
        </label>
      </div>
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <Tree<FsNode>
          data={data}
          idAccessor="relPath"
          childrenAccessor="children"
          openByDefault={false}
          width="100%"
          height={containerHeight}
          rowHeight={24}
          onToggle={handleToggle}
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
          {(props) => (
            <FilerRow
              {...props}
              isRenaming={renaming?.relPath === props.node.data.relPath}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenu({ x: e.clientX, y: e.clientY, node: props.node.data })
              }}
              onCommitRename={(name) => void commitRename(props.node.data, name)}
            />
          )}
        </Tree>
      </div>
      {menu && (
        <div
          className="fixed z-50 min-w-[10rem] rounded-md border bg-popover p-1 text-sm shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem onClick={() => void copyPath(menu.node)}>{t('filer.copyPath')}</MenuItem>
          <MenuItem
            onClick={() => {
              setRenaming(menu.node)
              setMenu(null)
            }}
          >
            {t('common.rename')}
          </MenuItem>
          <MenuItem onClick={() => void handleDelete(menu.node)}>{t('common.delete')}</MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className="flex w-full items-center rounded-sm px-2 py-1.5 text-left hover:bg-accent"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function FilerRow({
  node,
  style,
  dragHandle,
  isRenaming,
  onContextMenu,
  onCommitRename
}: NodeRendererProps<FsNode> & {
  isRenaming: boolean
  onContextMenu: (e: React.MouseEvent) => void
  onCommitRename: (name: string) => void
}): React.JSX.Element {
  const entry = node.data
  return (
    <div
      ref={dragHandle}
      style={style}
      className={cn(
        'flex cursor-pointer items-center gap-1 truncate rounded px-1 text-sm hover:bg-accent',
        node.isSelected && 'bg-accent',
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
          onKeyDown={(e) => {
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

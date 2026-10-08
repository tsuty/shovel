import { useEffect, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FILE_SEARCH_MAX_RESULTS, type FileSearchResult } from '@shared/types/filer'
import { Dialog, DialogContent, DialogTitle } from '../../shared/components/ui/dialog'
import { InfoTip } from '../../shared/components/InfoTip'

const DEBOUNCE_MS = 200

interface SearchMemory {
  query: string
  /** 検索範囲のフォルダ（空ならプロジェクト全体）。 */
  scope: string
  results: FileSearchResult[] | null
  /** 最後に開いた結果。開き直したときに、どこまで見たか分かるよう印を付ける。 */
  lastOpened: string | null
}

/** プロジェクトごとの前回の検索。ウィンドウを閉じるまで残る。 */
const memories = new Map<string, SearchMemory>()

function memoryFor(projectId: string): SearchMemory {
  return memories.get(projectId) ?? { query: '', scope: '', results: null, lastOpened: null }
}

/** 右クリックの「このフォルダ内を検索」: 検索語はそのままで、範囲だけ差し替える。 */
export function setFileSearchScope(projectId: string, scope: string): void {
  const memory = memoryFor(projectId)
  if (memory.scope === scope) return
  memories.set(projectId, { ...memory, scope, results: null, lastOpened: null })
}

function splitPath(relPath: string): { name: string; dir: string } {
  const slash = relPath.lastIndexOf('/')
  return slash < 0 ? { name: relPath, dir: '' } : { name: relPath.slice(slash + 1), dir: relPath.slice(0, slash) }
}

/**
 * ファイラーの中身検索ダイアログ。入力を約200msデバウンスし、新しいクエリが来たら前の検索は捨てる。
 * 開き直したときは前回の結果をすぐ出し、裏で検索し直して差し替える。
 */
export function FileSearchDialog({
  projectId,
  open,
  onOpenChange,
  onOpenResult
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenResult: (result: FileSearchResult) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [memory, setMemoryState] = useState<SearchMemory>(() => memoryFor(projectId))
  const [searching, setSearching] = useState(false)
  const requestRef = useRef(0)
  const lastOpenedRef = useRef<HTMLButtonElement>(null)

  function updateMemory(patch: Partial<SearchMemory>): void {
    setMemoryState((prev) => {
      const next = { ...prev, ...patch }
      memories.set(projectId, next)
      return next
    })
  }

  // 開くたびに、前回の検索（右クリックで範囲が変わっていればそれも）を読み込む。
  useEffect(() => {
    if (open) setMemoryState(memoryFor(projectId))
  }, [open, projectId])

  const { query, scope } = memory
  useEffect(() => {
    const request = ++requestRef.current
    if (!open) return
    if (!query.trim()) {
      setSearching(false)
      updateMemory({ results: null })
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      void window.shovel.fs
        .search(projectId, scope, query)
        .catch(() => [] as FileSearchResult[])
        .then((found) => {
          if (found === null || request !== requestRef.current) return
          setSearching(false)
          updateMemory({ results: found })
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, query, scope, open])

  // 前回開いた結果が見えるようにする。
  useEffect(() => {
    if (open) lastOpenedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open, memory.results])

  const results = memory.results
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-xl flex-col gap-3 p-4">
        <div className="flex items-center gap-1.5">
          <DialogTitle className="text-sm font-medium">{t('fileSearch.title')}</DialogTitle>
          {/* 検索しないもの。普段は要らない情報なのでツールチップに留める。 */}
          <InfoTip text={t('fileSearch.excluded')} />
        </div>
        <div className="flex items-center gap-2 rounded-md border border-input px-2">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            autoFocus
            className="h-8 flex-1 bg-transparent text-sm outline-hidden"
            value={query}
            placeholder={t('fileSearch.placeholder')}
            onChange={(e) => updateMemory({ query: e.target.value, lastOpened: null })}
            onFocus={(e) => e.target.select()}
          />
          {searching && <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />}
          {query && (
            <button
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title={t('search.clear')}
              onClick={() => updateMemory({ query: '', lastOpened: null })}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {scope && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate" title={scope}>
              {t('fileSearch.scope', { path: `${scope}/` })}
            </span>
            <button
              className="shrink-0 rounded px-1 hover:bg-accent hover:text-foreground"
              title={t('fileSearch.clearScope')}
              onClick={() => updateMemory({ scope: '', lastOpened: null })}
            >
              <X size={12} />
            </button>
          </div>
        )}
        {results !== null && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-1 text-xs font-medium text-muted-foreground">{t('search.results')}</div>
            {results.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{t('fileSearch.noResults')}</p>
            ) : (
              <ul className="flex flex-col">
                {results.map((result) => {
                  const { name, dir } = splitPath(result.relPath)
                  const isLastOpened = result.relPath === memory.lastOpened
                  return (
                    <li key={result.relPath}>
                      <button
                        ref={isLastOpened ? lastOpenedRef : undefined}
                        className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent ${isLastOpened ? 'bg-accent/60' : ''}`}
                        title={result.relPath}
                        onClick={() => {
                          updateMemory({ lastOpened: result.relPath })
                          onOpenResult(result)
                          onOpenChange(false)
                        }}
                      >
                        <div className="flex w-full items-baseline gap-2">
                          <span className="shrink-0 truncate text-sm font-semibold">{name}</span>
                          <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                            {dir ? `${dir}/ · ` : ''}
                            {t('fileSearch.lineAt', { line: result.line })}
                          </span>
                        </div>
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {result.snippet.before}
                          <strong className="font-semibold text-foreground">{result.snippet.match}</strong>
                          {result.snippet.after}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {results.length >= FILE_SEARCH_MAX_RESULTS && (
              <p className="pt-2 text-xs text-muted-foreground">
                {t('fileSearch.truncated', { count: FILE_SEARCH_MAX_RESULTS })}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

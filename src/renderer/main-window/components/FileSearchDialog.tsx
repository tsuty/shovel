import { useEffect, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FILE_SEARCH_MAX_RESULTS, type FileSearchResults } from '@shared/types/filer'
import { Dialog, DialogContent, DialogTitle } from '../../shared/components/ui/dialog'
import { InfoTip } from '../../shared/components/InfoTip'

const DEBOUNCE_MS = 200

interface SearchMemory {
  query: string
  /** 検索範囲のフォルダ（空ならプロジェクト全体）。 */
  scope: string
  results: FileSearchResults | null
  /** 最後に開いた結果（`resultKey`）。開き直したときに、どこまで見たか分かるよう印を付ける。 */
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

/** 結果の行の識別子。同じファイルがファイル名とコンテンツの両方に出ても区別する。 */
function resultKey(kind: 'name' | 'content', relPath: string): string {
  return `${kind}:${relPath}`
}

function splitPath(relPath: string): { name: string; dir: string } {
  const slash = relPath.lastIndexOf('/')
  return slash < 0 ? { name: relPath, dir: '' } : { name: relPath.slice(slash + 1), dir: relPath.slice(0, slash) }
}

/**
 * ファイラーの検索ダイアログ。ファイル名の一致とコンテンツの一致を分けて並べる。入力を約200msデバウンスし、新しいクエリが来たら前の検索は捨てる。
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
  /** `at` はコンテンツの一致のときだけ（一致箇所へ移る）。 */
  onOpenResult: (relPath: string, at?: { line: number; column: number; length: number }) => void
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
        .catch((): FileSearchResults => ({ names: [], contents: [] }))
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

  function openResult(key: string, relPath: string, at?: { line: number; column: number; length: number }): void {
    updateMemory({ lastOpened: key })
    onOpenResult(relPath, at)
    onOpenChange(false)
  }

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
            {results.names.length === 0 && results.contents.length === 0 ? (
              <>
                <div className="mb-1 text-xs font-medium text-muted-foreground">{t('search.results')}</div>
                <p className="py-2 text-sm text-muted-foreground">{t('fileSearch.noResults')}</p>
              </>
            ) : (
              <>
                {results.names.length > 0 && (
                  <ResultSection title={t('fileSearch.nameMatches')} count={results.names.length}>
                    {results.names.map((result) => {
                      const { name, dir } = splitPath(result.relPath)
                      const key = resultKey('name', result.relPath)
                      return (
                        <ResultRow
                          key={key}
                          ref={key === memory.lastOpened ? lastOpenedRef : undefined}
                          relPath={result.relPath}
                          highlighted={key === memory.lastOpened}
                          onClick={() => openResult(key, result.relPath)}
                        >
                          <span className="shrink-0 truncate text-sm">
                            {name.slice(0, result.start)}
                            <strong className="font-semibold">
                              {name.slice(result.start, result.start + result.length)}
                            </strong>
                            {name.slice(result.start + result.length)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                            {dir ? `${dir}/` : ''}
                          </span>
                        </ResultRow>
                      )
                    })}
                  </ResultSection>
                )}
                {results.contents.length > 0 && (
                  <ResultSection title={t('fileSearch.contentMatches')} count={results.contents.length}>
                    {results.contents.map((result) => {
                      const { name, dir } = splitPath(result.relPath)
                      const key = resultKey('content', result.relPath)
                      return (
                        <ResultRow
                          key={key}
                          ref={key === memory.lastOpened ? lastOpenedRef : undefined}
                          relPath={result.relPath}
                          highlighted={key === memory.lastOpened}
                          onClick={() =>
                            openResult(key, result.relPath, {
                              line: result.line,
                              column: result.column,
                              length: result.length
                            })
                          }
                          snippet={
                            <>
                              {result.snippet.before}
                              <strong className="font-semibold text-foreground">{result.snippet.match}</strong>
                              {result.snippet.after}
                            </>
                          }
                        >
                          <span className="shrink-0 truncate text-sm font-semibold">{name}</span>
                          <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                            {dir ? `${dir}/ · ` : ''}
                            {t('fileSearch.lineAt', { line: result.line })}
                          </span>
                        </ResultRow>
                      )
                    })}
                  </ResultSection>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ResultSection({
  title,
  count,
  children
}: {
  title: string
  count: number
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section className="mb-3 last:mb-0">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      <ul className="flex flex-col">{children}</ul>
      {count >= FILE_SEARCH_MAX_RESULTS && (
        <p className="pt-2 text-xs text-muted-foreground">
          {t('fileSearch.truncated', { count: FILE_SEARCH_MAX_RESULTS })}
        </p>
      )}
    </section>
  )
}

/** 結果の1行。1行目（ファイル名・フォルダ）は `children`、2行目は `snippet`（コンテンツの一致のときだけ）。 */
function ResultRow({
  ref,
  relPath,
  highlighted,
  onClick,
  snippet,
  children
}: {
  ref?: React.Ref<HTMLButtonElement>
  relPath: string
  highlighted: boolean
  onClick: () => void
  snippet?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <li>
      <button
        ref={ref}
        className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent ${highlighted ? 'bg-accent/60' : ''}`}
        title={relPath}
        onClick={onClick}
      >
        <div className="flex w-full items-baseline gap-2">{children}</div>
        {snippet && <span className="line-clamp-2 text-xs text-muted-foreground">{snippet}</span>}
      </button>
    </li>
  )
}

import { app } from 'electron'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LocalRecordKind, LocalRecordSummary, SessionSnapshot } from '@shared/types/session'

/**
 * セッションのトランスクリプトスナップショット。data-model.md §3 / §4、F-2。
 * decisions.md C-1/C-2（Local Record First）により、過去のやり取りの内容は
 * このローカル記録を正とする。保存先はプロジェクトツリーの外の
 * プロジェクトごとのディレクトリ（`userData/snapshots/{projectId}`）、書き込みは
 * 一時ファイル経由のアトミックな move。プロジェクトごとに分けるのは、一覧・
 * ローカル検索が他のプロジェクトの記録を読まずに済むようにするため
 * （以前は全プロジェクト共通の1ディレクトリだった。`migrateFlatSnapshots`）。
 *
 * 各ディレクトリに3種類のファイルが並ぶ:
 *   - `{sessionId}.json`                    現行の記録
 *   - `{sessionId}.json.{epochMillis}.backup`  食い違い検出時の退避（C-4）
 *   - `{sessionId}.json.{epochMillis}.deleted` ソフトデリート（C-5）
 * バックアップ・削除済みはどちらも自動削除しない（無期限に保持）。
 */

const SCHEMA_VERSION = 1 as const

const RECORD_FILE_RE = /^(.+)\.json(?:\.(\d+)\.(backup|deleted))?$/

function snapshotRootDir(): string {
  return path.join(app.getPath('userData'), 'snapshots')
}

/** プロジェクト id はディレクトリ名になるので、パスの外へ出られない形に限る。 */
export function safeProjectSegment(projectId: string): string {
  if (!projectId || path.basename(projectId) !== projectId || projectId === '.' || projectId === '..') {
    throw new Error(`invalid project id: ${projectId}`)
  }
  return projectId
}

export function snapshotDir(projectId: string): string {
  return path.join(snapshotRootDir(), safeProjectSegment(projectId))
}

function snapshotPath(projectId: string, sessionId: string): string {
  return path.join(snapshotDir(projectId), `${sessionId}.json`)
}

interface ParsedRecordName {
  sessionId: string
  kind: LocalRecordKind
  /** `backup` / `deleted` のときのファイル名の epochMillis。 */
  epochMillis?: number
}

function parseRecordName(fileName: string): ParsedRecordName | null {
  if (fileName.startsWith('.')) return null
  const m = fileName.match(RECORD_FILE_RE)
  if (!m) return null
  const sessionId = m[1]!
  if (!m[3]) return { sessionId, kind: 'current' }
  return { sessionId, kind: m[3] as LocalRecordKind, epochMillis: Number(m[2]) }
}

/**
 * renderer から渡されたファイル名を、スナップショットディレクトリ内の
 * 既知の形式のファイルに限って絶対パスへ解決する（`../` 等で外へ出られない
 * ように、形式に合わないものは拒否する）。
 */
function resolveRecordPath(projectId: string, fileName: string): string {
  if (path.basename(fileName) !== fileName || !parseRecordName(fileName)) {
    throw new Error(`invalid snapshot file name: ${fileName}`)
  }
  return path.join(snapshotDir(projectId), fileName)
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

/**
 * `{sessionId}.json.{epochMillis}.{suffix}` の空き名前を探す。同じミリ秒の
 * ファイルが既にあれば +1ms してリトライする（decisions.md C-4）。
 * shovel の main プロセスはこのディレクトリの唯一の書き手なので、
 * 存在確認 → rename の間の競合は考えなくてよい。
 */
async function availableTimestampedPath(
  projectId: string,
  sessionId: string,
  epochMillis: number,
  suffix: 'backup' | 'deleted'
): Promise<string> {
  const dir = snapshotDir(projectId)
  for (let ms = epochMillis; ; ms++) {
    const candidate = path.join(dir, `${sessionId}.json.${ms}.${suffix}`)
    if (!(await exists(candidate))) return candidate
  }
}

async function writeAtomically(finalPath: string, content: string): Promise<void> {
  const dir = path.dirname(finalPath)
  await mkdir(dir, { recursive: true })
  const tmpPath = path.join(dir, `.${path.basename(finalPath)}.${randomUUID()}.tmp`)
  await writeFile(tmpPath, content, 'utf8')
  await rename(tmpPath, finalPath)
}

function parseSnapshot(raw: string): SessionSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as SessionSnapshot
    // 移行経路の無いバージョンは「履歴なし」として破棄する（読み込み失敗で
    // 接続そのものを壊さないため）。
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

export async function saveSnapshot(snapshot: SessionSnapshot): Promise<void> {
  await writeAtomically(snapshotPath(snapshot.projectId, snapshot.sessionId), JSON.stringify(snapshot))
}

export async function loadSnapshot(projectId: string, sessionId: string): Promise<SessionSnapshot | null> {
  try {
    return parseSnapshot(await readFile(snapshotPath(projectId, sessionId), 'utf8'))
  } catch {
    return null
  }
}

/**
 * decisions.md C-4: 現在の `{sessionId}.json` の中身を、そのまま
 * `{sessionId}.json.{epochMillis}.backup` へ退避する（元ファイルはこの時点では
 * 残す。呼び出し側がこの後で replay の内容を書き込む）。書き込みは一時
 * ファイル経由のアトミックな move。退避する記録が無ければ null を返す。
 */
export async function backupSnapshot(projectId: string, sessionId: string): Promise<string | null> {
  let raw: string
  try {
    raw = await readFile(snapshotPath(projectId, sessionId), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const target = await availableTimestampedPath(projectId, sessionId, Date.now(), 'backup')
  await writeAtomically(target, raw)
  return path.basename(target)
}

/**
 * decisions.md C-5: ソフトデリート。`{sessionId}.json` を
 * `{sessionId}.json.{削除時刻}.deleted` へリネームし、続けてそのセッションの
 * バックアップをそれぞれ `{sessionId}.json.{バックアップの元の epochMillis}.deleted`
 * へリネームする（バックアップが `.backup` のまま残ると、削除したはずの
 * セッションが通常のローカル検索に引っかかり続けるため）。
 *
 * 本体のリネームが失敗したら（例外を投げて）バックアップには触らない。
 * どの段階で失敗しても「一覧には出ないのに一部だけ検索に残る」半端な状態に
 * ならないよう、本体を先に動かす。
 */
export async function softDeleteSnapshot(projectId: string, sessionId: string): Promise<void> {
  const dir = snapshotDir(projectId)
  await rename(
    snapshotPath(projectId, sessionId),
    await availableTimestampedPath(projectId, sessionId, Date.now(), 'deleted')
  )

  let fileNames: string[]
  try {
    fileNames = await readdir(dir)
  } catch {
    return
  }
  for (const fileName of fileNames) {
    const parsed = parseRecordName(fileName)
    if (!parsed || parsed.sessionId !== sessionId || parsed.kind !== 'backup') continue
    const target = await availableTimestampedPath(projectId, sessionId, parsed.epochMillis!, 'deleted')
    await rename(path.join(dir, fileName), target)
  }
}

/**
 * flows.md §6「名前変更: ACP に session/rename が無いため、shovel 側に
 * タイトルの上書きを保存し…」。永続化済みのスナップショットがあれば、その
 * `title` も書き換えておく（履歴一覧が次のターンを待たずに新しい名前を
 * 表示できるように）。スナップショットがまだ無いセッションは何もしない
 * （呼び出し側の `sessionTitleStore` への保存だけで、次回保存時に反映される）。
 */
export async function renameSnapshotTitle(projectId: string, sessionId: string, title: string): Promise<void> {
  const existing = await loadSnapshot(projectId, sessionId)
  if (!existing) return
  await saveSnapshot({ ...existing, title })
}

/** 現行の記録（`{sessionId}.json`）だけを、新しい順に返す。 */
export async function listSnapshotsForProject(projectId: string): Promise<SessionSnapshot[]> {
  const records = await readRecordsForProject(projectId, () => true)
  return records
    .filter(({ summary }) => summary.kind === 'current')
    .map(({ snapshot }) => snapshot)
    .sort((a, b) => b.savedAt - a.savedAt)
}

/**
 * プロジェクトのローカル記録（現在・バックアップ・削除済み）をすべて
 * 要約として返す（新しい順）。チャット履歴パネル（ui.md「チャット履歴
 * パネル」）のバックアップ展開・削除済みトグル・検索アイコンの表示条件に使う。
 */
export async function listLocalRecords(projectId: string): Promise<LocalRecordSummary[]> {
  const records = await readRecordsForProject(projectId, () => true)
  return records.map(({ summary }) => summary).sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * flows.md §9: プロジェクトの削除に伴い、そのプロジェクトのローカル記録
 * （現在・バックアップ・削除済み）をすべて破棄する。セッション単位の削除
 * （`softDeleteSnapshot`）と違い、プロジェクトごと消える以上は退避しない。
 */
export async function removeAllRecordsForProject(projectId: string): Promise<void> {
  await rm(snapshotDir(projectId), { recursive: true, force: true })
}

/** バックアップ・削除済みを含め、ファイル名で指定したローカル記録の中身を読む。 */
export async function readLocalRecord(projectId: string, fileName: string): Promise<SessionSnapshot | null> {
  try {
    return parseSnapshot(await readFile(resolveRecordPath(projectId, fileName), 'utf8'))
  } catch {
    return null
  }
}

export interface LoadedRecord {
  summary: LocalRecordSummary
  snapshot: SessionSnapshot
}

/**
 * プロジェクトに属するローカル記録を1ファイルずつ読む。`shouldContinue` が
 * false を返したら途中で打ち切る（ローカル検索が新しいクエリに追い越された
 * ときのキャンセル用）。壊れたファイル・移行経路の無いバージョンは無視する。
 */
export async function readRecordsForProject(
  projectId: string,
  shouldContinue: () => boolean,
  kinds?: ReadonlySet<LocalRecordKind>
): Promise<LoadedRecord[]> {
  const dir = snapshotDir(projectId)
  let fileNames: string[]
  try {
    fileNames = await readdir(dir)
  } catch {
    return []
  }
  const records: LoadedRecord[] = []
  for (const fileName of fileNames) {
    if (!shouldContinue()) return records
    const parsed = parseRecordName(fileName)
    if (!parsed || (kinds && !kinds.has(parsed.kind))) continue
    let raw: string
    try {
      raw = await readFile(path.join(dir, fileName), 'utf8')
    } catch {
      continue
    }
    const snapshot = parseSnapshot(raw)
    if (!snapshot || snapshot.projectId !== projectId) continue
    records.push({
      snapshot,
      summary: {
        fileName,
        kind: parsed.kind,
        sessionId: parsed.sessionId,
        title: snapshot.title,
        timestamp: parsed.epochMillis ?? snapshot.savedAt,
        sizeBytes: Buffer.byteLength(raw, 'utf8')
      }
    })
  }
  return records
}

/**
 * 以前の保存形式（全プロジェクト共通の `userData/snapshots` 直下）のファイルを、
 * 中身の `projectId` を見てプロジェクトごとのディレクトリへ移す。起動時に1回
 * 呼ぶ。移し先に同名ファイルがあれば上書きせずに残す（どちらも消さない）。
 * 読めない・プロジェクトの分からないファイルはそのまま置いておく。
 */
export async function migrateFlatSnapshots(): Promise<void> {
  const root = snapshotRootDir()
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile() || !parseRecordName(entry.name)) continue
    const from = path.join(root, entry.name)
    try {
      const parsed = JSON.parse(await readFile(from, 'utf8')) as { projectId?: unknown }
      if (typeof parsed.projectId !== 'string') continue
      const dir = snapshotDir(parsed.projectId)
      const to = path.join(dir, entry.name)
      if (await exists(to)) continue
      await mkdir(dir, { recursive: true })
      await rename(from, to)
    } catch (err) {
      console.warn(`[snapshot] could not migrate ${entry.name}; leaving it in place`, err)
    }
  }
}

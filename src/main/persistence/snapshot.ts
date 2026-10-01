import { app } from 'electron'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LocalRecordKind, LocalRecordSummary, SessionSnapshot } from '@shared/types/session'

/**
 * セッションのトランスクリプトスナップショット。
 * 保存先は `userData/snapshots/{projectId}`、書き込みは一時ファイル経由のアトミックな move。
 *
 * 各ディレクトリに3種類のファイルが並ぶ:
 *   - `{sessionId}.json`                       現行の記録
 *   - `{sessionId}.json.{epochMillis}.backup`  食い違い検出時の退避
 *   - `{sessionId}.json.{epochMillis}.deleted` ソフトデリート
 */

const SCHEMA_VERSION = 1

const RECORD_FILE_RE = /^(.+)\.json(?:\.(\d+)\.(backup|deleted))?$/

function snapshotRootDir(): string {
  return path.join(app.getPath('userData'), 'snapshots')
}

/** プロジェクト id がディレクトリ名として安全な形か判定する。 */
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
 * renderer から渡されたファイル名を、スナップショットディレクトリ内の既知の形式の
 * ファイルに限って絶対パスへ解決する。形式に合わないものは拒否する。
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
 * `{sessionId}.json.{epochMillis}.{suffix}` の空き名前を探す。同じミリ秒のファイルが
 * 既にあれば +1ms してリトライする。
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
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown }
    // 移行経路の無いバージョンは「履歴なし」として扱う。
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null
    return parsed as SessionSnapshot
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
 * 現在の `{sessionId}.json` の中身を `{sessionId}.json.{epochMillis}.backup` へ退避する
 * （元ファイルは残す）。退避する記録が無ければ null を返す。
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
 * ソフトデリート。`{sessionId}.json` を `{sessionId}.json.{削除時刻}.deleted` へリネームし、
 * 続けてバックアップをそれぞれ `{sessionId}.json.{バックアップの epochMillis}.deleted` へリネームする。
 * 本体のリネームが失敗したらバックアップには触らない。
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

/** 永続化済みのスナップショットがあれば、その `title` を書き換える。 */
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

/** プロジェクトのローカル記録（現在・バックアップ・削除済み）をすべて要約として返す（新しい順）。 */
export async function listLocalRecords(projectId: string): Promise<LocalRecordSummary[]> {
  const records = await readRecordsForProject(projectId, () => true)
  return records.map(({ summary }) => summary).sort((a, b) => b.timestamp - a.timestamp)
}

/** プロジェクトのローカル記録（現在・バックアップ・削除済み）をすべて削除する。 */
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
 * プロジェクトに属するローカル記録を1ファイルずつ読む。`shouldContinue` が false を返したら
 * 途中で打ち切る。壊れたファイル・移行経路の無いバージョンは無視する。
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
 * 旧形式（`userData/snapshots` 直下）のファイルを、中身の `projectId` を見てプロジェクトごとの
 * ディレクトリへ移す。移し先に同名ファイルがあれば移さない。読めないファイルはそのまま残す。
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

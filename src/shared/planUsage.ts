/** プランの使用率（Claude Code の `/usage` の出力）の型と、その出力のパース。 */

/** 使用率の1項目（`Current session` / `Current week (…)` の1行）。 */
export interface PlanUsageMeter {
  kind: 'session' | 'week'
  /** `Current week (all models)` の `all models` など、括弧の中。session では null。 */
  label: string | null
  /** 使用率（%）。 */
  percent: number
  /** リセット日時（epoch ms）。出力に無いか、読めなければ null。 */
  resetsAt: number | null
}

export interface PlanUsage {
  meters: PlanUsageMeter[]
}

/**
 * 直近の取得の失敗理由。
 * - `noRunningSandbox`: 使用率を取得できるエージェントの、実行中のサンドボックスが無い
 * - `unreadable`: コマンドは動いたが、出力から使用率を読めなかった（API キー利用・出力形式の変更など）
 * - `failed`: コマンドが失敗した・時間切れになった
 */
export type PlanUsageError = 'noRunningSandbox' | 'unreadable' | 'failed'

/** main が全ウィンドウへ配る、プランの使用率の状態。 */
export interface PlanUsageState {
  /** 取得中か。 */
  loading: boolean
  /** 最後に取得できた値。 */
  usage: PlanUsage | null
  /** `usage` を取得した時刻（epoch ms）。 */
  fetchedAt: number | null
  /** 直近の取得の失敗理由。成功したら null。 */
  error: PlanUsageError | null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** 年を補ったリセット日時が、この日数より過去なら翌年とみなす。 */
const PAST_TOLERANCE_MS = 30 * 24 * 60 * 60 * 1000

const SESSION_LINE = /^\s*Current session:\s*(\d+(?:\.\d+)?)%\s*used(?:\s*·\s*resets\s+(.+?))?\s*$/i
const WEEK_LINE = /^\s*Current week\s*\(([^)]+)\):\s*(\d+(?:\.\d+)?)%\s*used(?:\s*·\s*resets\s+(.+?))?\s*$/i
/** `Nov 22, 7pm (UTC)` / `Oct 29, 7:30pm (UTC)`。 */
const RESETS = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(([^)]+)\))?$/i

/** `/usage` の出力から使用率を読む。1行も読めなければ null。 */
export function parsePlanUsage(text: string, now: number = Date.now()): PlanUsage | null {
  const meters: PlanUsageMeter[] = []
  for (const line of text.split(/\r\n|\n/)) {
    const session = SESSION_LINE.exec(line)
    if (session) {
      meters.push({
        kind: 'session',
        label: null,
        percent: Number(session[1]),
        resetsAt: session[2] ? parseResets(session[2], now) : null
      })
      continue
    }
    const week = WEEK_LINE.exec(line)
    if (week) {
      meters.push({
        kind: 'week',
        label: week[1]!.trim(),
        percent: Number(week[2]),
        resetsAt: week[3] ? parseResets(week[3], now) : null
      })
    }
  }
  return meters.length > 0 ? { meters } : null
}

/** リセット日時の文字列を epoch ms にする。年は `now` から補う。読めなければ null。 */
export function parseResets(text: string, now: number): number | null {
  const m = RESETS.exec(text.trim())
  if (!m) return null
  const month = MONTHS.indexOf(m[1]!.toLowerCase())
  if (month < 0) return null
  const day = Number(m[2])
  let hour = Number(m[3]) % 12
  if (m[5]!.toLowerCase() === 'pm') hour += 12
  const minute = m[4] ? Number(m[4]) : 0
  const timeZone = m[6]?.trim() ?? 'UTC'
  const year = new Date(now).getUTCFullYear()
  for (const y of [year, year + 1]) {
    const at = zonedTimeToEpoch(y, month, day, hour, minute, timeZone)
    if (at === null) return null
    if (at >= now - PAST_TOLERANCE_MS) return at
  }
  return null
}

/** タイムゾーン `timeZone` での壁時計の時刻を epoch ms にする。知らないタイムゾーンなら null。 */
function zonedTimeToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number | null {
  const wall = Date.UTC(year, month, day, hour, minute)
  if (/^(utc|gmt|z)$/i.test(timeZone)) return wall
  try {
    const first = wall - offsetOf(wall, timeZone)
    return wall - offsetOf(first, timeZone)
  } catch {
    return null
  }
}

/** その時刻での、タイムゾーンの UTC からのずれ（ms）。 */
function offsetOf(epoch: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }).formatToParts(new Date(epoch))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return asUtc - Math.floor(epoch / 60000) * 60000
}

/** 項目のうち、最も高い使用率。項目が無ければ null。 */
export function highestPercent(usage: PlanUsage): number | null {
  if (usage.meters.length === 0) return null
  return Math.max(...usage.meters.map((m) => m.percent))
}

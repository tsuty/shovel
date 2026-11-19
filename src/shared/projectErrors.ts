/**
 * 同じフォルダがすでにプロジェクトとして登録されているため作成できないことを、renderer へ伝える Error の message に使う目印。
 * 形式は `PROJECT_ALREADY_REGISTERED:<登録済みのプロジェクト名>`。
 */
export const PROJECT_ALREADY_REGISTERED_MARKER = 'PROJECT_ALREADY_REGISTERED'

export function alreadyRegisteredMessage(displayName: string): string {
  return `${PROJECT_ALREADY_REGISTERED_MARKER}:${displayName}`
}

/** 目印を含んでいれば登録済みのプロジェクト名を返す。含まなければ null。 */
export function parseAlreadyRegisteredMessage(message: string): string | null {
  const at = message.indexOf(`${PROJECT_ALREADY_REGISTERED_MARKER}:`)
  if (at < 0) return null
  return message.slice(at + PROJECT_ALREADY_REGISTERED_MARKER.length + 1)
}

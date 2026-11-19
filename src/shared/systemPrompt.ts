/**
 * プロジェクトのシステムプロンプト（追記）の入力値を保存する形に整える。
 * 前後の空白を取り除き、空になれば undefined を返す。
 */
export function normalizeSystemPrompt(text: string | undefined): string | undefined {
  const trimmed = text?.trim()
  return trimmed ? trimmed : undefined
}

import type { TFunction } from 'i18next'
import { isSbxNotFoundMessage } from '@shared/sbxErrors'

/**
 * decisions.md A-3-1「エラーは『環境が悪い』ではなく『こうすれば直る』を示す」。
 * main から届く Error はそのまま画面に出さず、既知のマーカーだけ案内文言に
 * 差し替える。未知のエラーはそのまま出す（隠すと「こうすれば直る」を示せない）。
 */
export function friendlyErrorMessage(rawMessage: string, t: TFunction): string {
  if (isSbxNotFoundMessage(rawMessage)) return t('errors.sbxNotFound')
  return rawMessage
}

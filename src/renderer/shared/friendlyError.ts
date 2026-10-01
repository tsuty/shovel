import type { TFunction } from 'i18next'
import { isSbxNotFoundMessage } from '@shared/sbxErrors'

/** main から届く Error のうち、既知のマーカーを持つものを案内文言に差し替える。未知のエラーはそのまま出す。 */
export function friendlyErrorMessage(rawMessage: string, t: TFunction): string {
  if (isSbxNotFoundMessage(rawMessage)) return t('errors.sbxNotFound')
  return rawMessage
}

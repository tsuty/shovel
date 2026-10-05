import type { TFunction } from 'i18next'
import { isSbxNotFoundMessage } from '@shared/sbxErrors'

/** `ipcRenderer.invoke` が main の例外に付ける前置き（`Error invoking remote method '<channel>': Error: `）。 */
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:\w*Error: )?/

/** main から届く Error のうち、既知のマーカーを持つものを案内文言に差し替える。未知のエラーは IPC の前置きだけ外して出す。 */
export function friendlyErrorMessage(rawMessage: string, t: TFunction): string {
  if (isSbxNotFoundMessage(rawMessage)) return t('errors.sbxNotFound')
  return rawMessage.replace(IPC_ERROR_PREFIX, '')
}

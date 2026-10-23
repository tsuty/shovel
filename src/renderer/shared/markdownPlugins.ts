import remarkGemoji from 'remark-gemoji'
import remarkGfm from 'remark-gfm'
import { remarkDetails } from './remarkDetails'

/** トランスクリプトなどで使う remark プラグイン。 */
export const DEFAULT_PLUGINS = [remarkGfm, remarkGemoji]
/** Markdown ファイルの表示で使う remark プラグイン。remarkDetails を先に通して、summary の文字列にも絵文字の置き換えが効くようにする。 */
export const DETAILS_PLUGINS = [remarkGfm, remarkDetails, remarkGemoji]

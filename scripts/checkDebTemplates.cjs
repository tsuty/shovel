// electron-builder の beforePack フック。
// deb の after-install / after-remove は electron-builder のテンプレートを写して手を加えたもの
// （resources/linux/）なので、写したときの内容（resources/linux/upstream/）と、いま入っている
// electron-builder のテンプレートを比べ、違っていればビルドを止める。
const { readFileSync } = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TEMPLATES = ['after-install.tpl', 'after-remove.tpl']

function upstreamTemplateDir() {
  const builderDir = path.dirname(require.resolve('electron-builder/package.json', { paths: [ROOT] }))
  const libDir = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [builderDir] }))
  return path.join(libDir, 'templates', 'linux')
}

exports.default = async function checkDebTemplates(context) {
  if (context.electronPlatformName !== 'linux') return
  const dir = upstreamTemplateDir()
  const changed = TEMPLATES.filter(
    (name) =>
      readFileSync(path.join(dir, name), 'utf8') !== readFileSync(path.join(ROOT, 'resources', 'linux', 'upstream', name), 'utf8')
  )
  if (changed.length > 0) {
    throw new Error(
      `electron-builder の deb テンプレートが変わった: ${changed.join(', ')}（${dir}）。` +
        'resources/linux/ の写しに変更を取り込み、resources/linux/upstream/ を新しいテンプレートで置き換えてから、もう一度ビルドする。'
    )
  }
}

/**
 * サンドボックス内で PTY を作ってコマンドを動かすための起動引数を組み立てる。
 * ホストと `sbx exec -i` の間はパイプのまま。PTY は `python3` の `pty.fork()` が作る。
 */

/** `python3` が見つからなかったときに stderr へ出す目印。 */
export const NO_PYTHON_MARKER = '__shovel_tty_no_python3__'

/** 端末サイズの変更を stdin に混ぜて送るための制御列。ラッパーが取り除いて `TIOCSWINSZ` にする。 */
export function resizeSequence(cols: number, rows: number): string {
  return `\x1b]777;shovel-resize;${clampSize(cols)};${clampSize(rows)}\x07`
}

/**
 * 引数: 列数 行数 コマンド argv…
 * - 子プロセスに `TERM=xterm-256color` を設定する。
 * - stdin の中の `resizeSequence()` を取り除いて端末サイズを変える（途中で切れた列は次の読み込みに持ち越す）。
 * - stdin が閉じたら子のプロセスグループに SIGHUP を送る。
 * - 終了コードはそのまま、シグナルで終わったときは 128＋シグナル番号で終わる。
 */
const WRAPPER_SOURCE = `
import os, pty, sys, select, struct, fcntl, termios, signal, re
cols, rows, argv = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    try:
        os.execvp(argv[0], argv)
    except OSError as e:
        sys.stderr.write(str(e) + '\\n')
        os._exit(127)
def setsize(c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
def writeall(f, data):
    while data:
        n = os.write(f, data)
        data = data[n:]
setsize(cols, rows)
RESIZE = re.compile(rb'\\x1b\\]777;shovel-resize;(\\d+);(\\d+)\\x07')
PREFIX = b'\\x1b]777;'
pending = b''
stdin_open = True
while True:
    rl = [fd] + ([0] if stdin_open else [])
    r, _, _ = select.select(rl, [], [])
    if 0 in r:
        data = os.read(0, 4096)
        if not data:
            stdin_open = False
            try:
                os.killpg(pid, signal.SIGHUP)
            except OSError:
                pass
        else:
            pending += data
            out = b''
            while True:
                m = RESIZE.search(pending)
                if not m:
                    break
                out += pending[:m.start()]
                setsize(int(m.group(1)), int(m.group(2)))
                pending = pending[m.end():]
            k = pending.rfind(PREFIX)
            if k != -1 and len(pending) - k < 64:
                out += pending[:k]
                pending = pending[k:]
            else:
                out += pending
                pending = b''
            if out:
                writeall(fd, out)
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b''
        if not data:
            break
        writeall(1, data)
_, status = os.waitpid(pid, 0)
code = os.waitstatus_to_exitcode(status)
sys.exit(128 - code if code < 0 else code)
`

const SH_BOOTSTRAP = `command -v python3 >/dev/null 2>&1 || { echo ${NO_PYTHON_MARKER} >&2; exit 127; }; exec python3 -c "$0" "$@"`

/** `sbx exec -i <sandbox>` に続ける argv。`command` はサンドボックス内の `/bin/sh -lc` に渡る。 */
export function ttyCommandArgv(command: string, cols: number, rows: number): string[] {
  const encoded = Buffer.from(WRAPPER_SOURCE, 'utf8').toString('base64')
  const pythonBoot = `import base64;exec(base64.b64decode('${encoded}'))`
  return [
    '/bin/sh',
    '-c',
    SH_BOOTSTRAP,
    pythonBoot,
    String(clampSize(cols)),
    String(clampSize(rows)),
    '/bin/sh',
    '-lc',
    command
  ]
}

function clampSize(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(Math.max(Math.floor(n), 1), 9999)
}

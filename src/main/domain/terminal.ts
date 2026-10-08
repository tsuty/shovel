import { spawn } from 'node:child_process'

/**
 * OS のターミナルアプリを開き、サンドボックス内でコマンドを実行させる。
 * コマンドが成功したらターミナルを閉じ、失敗したときは出力を読めるよう残す。
 */
export function openSandboxCommand(sandboxName: string, argv: string[]): void {
  openTerminalCommand(['sbx', 'exec', '-it', sandboxName, ...argv], { closeOnSuccess: true })
}

/**
 * OS のターミナルアプリを開き、`sbx login`（Docker へのサインイン）を実行させる。
 * 成功したらターミナルを閉じ、失敗したときは出力を読めるよう残す。
 */
export function openSbxLoginTerminal(): void {
  openTerminalCommand(['sbx', 'login'], { closeOnSuccess: true })
}

export function openSandboxTerminal(sandboxName: string): void {
  openTerminalCommand(['sbx', 'exec', '-it', sandboxName, '/bin/bash', '-l'], {
    closeOnSuccess: false
  })
}

interface TerminalOptions {
  /** true: 終了コード 0 ならウィンドウを閉じる。false: 終了後もウィンドウを残す。 */
  closeOnSuccess: boolean
}

/** OS のターミナルアプリを開き、ホストでコマンドを実行させる。 */
function openTerminalCommand(argv: string[], options: TerminalOptions): void {
  if (process.platform === 'darwin') {
    openMacTerminal(argv.map(posixQuote).join(' '), options)
    return
  }

  if (process.platform === 'win32') {
    openWindowsTerminal(argv.map(windowsQuote).join(' '), options)
    return
  }

  // Linux：端末エミュレータは bash の終了とともに閉じるので、失敗時だけ Enter 待ちで止める。
  const command = argv.map(posixQuote).join(' ')
  const script = options.closeOnSuccess
    ? `${command} || { echo; read -r -p 'Press Enter to close...'; }`
    : command
  spawn('x-terminal-emulator', ['-e', 'bash', '-lc', script], {
    detached: true,
    stdio: 'ignore'
  }).unref()
}

/**
 * Terminal.app でコマンドを実行する。
 * コマンド文字列は AppleScript のリテラルに埋め込まず、osascript の引数（argv）で渡す。
 */
function openMacTerminal(command: string, options: TerminalOptions): void {
  const script = options.closeOnSuccess ? MAC_CLOSE_ON_SUCCESS_SCRIPT : MAC_KEEP_OPEN_SCRIPT
  const shellCommand = options.closeOnSuccess ? `${command} && exit` : command
  spawn('osascript', ['-e', script, shellCommand], { detached: true, stdio: 'ignore' }).unref()
}

/**
 * コマンドを実行し、ウィンドウはそのまま残す。
 * Terminal.app を新たに起動した場合は、起動時に開く既定ウィンドウを使い回す。
 */
const MAC_KEEP_OPEN_SCRIPT = `on run argv
  set wasRunning to application "Terminal" is running
  tell application "Terminal"
    activate
    if (not wasRunning) and ((count of windows) > 0) then
      do script (item 1 of argv) in window 1
    else
      do script (item 1 of argv)
    end if
  end tell
end run`

/**
 * コマンド（末尾に `&& exit` 付き）を実行し、終わるまで待つ。
 * シェルが終了していれば（＝成功）ウィンドウを閉じ、起動前に Terminal.app が
 * 動いていなかった場合で他にウィンドウが無ければアプリも終了する。
 * 失敗時はシェルが残るので何もしない。
 * Terminal.app を新たに起動した場合は、起動時に開く既定ウィンドウを使い回す。
 */
const MAC_CLOSE_ON_SUCCESS_SCRIPT = `on run argv
  set wasRunning to application "Terminal" is running
  tell application "Terminal"
    activate
    if (not wasRunning) and ((count of windows) > 0) then
      set t to do script (item 1 of argv) in window 1
    else
      set t to do script (item 1 of argv)
    end if
    set wid to id of front window
  end tell
  delay 1
  repeat
    try
      tell application "Terminal" to set stillBusy to busy of t
    on error
      exit repeat
    end try
    if not stillBusy then exit repeat
    delay 1
  end repeat
  delay 0.5
  tell application "Terminal"
    try
      if (count of processes of t) is 0 then close (window id wid)
    end try
    if (not wasRunning) and ((count of windows) is 0) then quit
  end tell
end run`

/**
 * cmd.exe の新しいウィンドウでコマンドを実行する。
 * closeOnSuccess のときは `/c` で実行し、失敗時だけ `pause` で止める。
 * それ以外は `/k` でシェルを残す。
 * 引数の解釈を cmd.exe に任せるため、Node による引数のクォートは無効にする。
 */
function openWindowsTerminal(command: string, options: TerminalOptions): void {
  const inner = options.closeOnSuccess ? `/s /c "${command} || pause"` : `/s /k "${command}"`
  spawn('cmd.exe', [`/c start "" cmd.exe ${inner}`], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsVerbatimArguments: true
  }).unref()
}

function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** cmd.exe 向けのクォート。空白や特殊文字を含む場合だけダブルクォートで囲む。 */
function windowsQuote(value: string): string {
  if (value !== '' && !/[\s"&|<>^()%!]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

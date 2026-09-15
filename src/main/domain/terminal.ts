import { spawn } from 'node:child_process'

/**
 * OS のターミナルアプリを開き、サンドボックス内でコマンドを実行させる
 * （decisions.md N-4, N-2-7b）。フル機能のターミナルが必要な場合や、
 * ブラウザを伴う認証フローを走らせる場合の唯一の逃げ道。
 * `node-pty` は使わない方針（F-2b）のため、ここだけは OS ごとの分岐が要る。
 */
export function openSandboxCommand(sandboxName: string, argv: string[]): void {
  const command = ['sbx', 'exec', '-it', sandboxName, ...argv].map(shellQuote).join(' ')

  if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script "${command.replace(/"/g, '\\"')}"`
    spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref()
    return
  }

  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/k', command], {
      detached: true,
      stdio: 'ignore',
      shell: false
    }).unref()
    return
  }

  // Linux（開発環境向け。要求仕様のサポート対象 OS ではない）。
  spawn('x-terminal-emulator', ['-e', 'bash', '-lc', command], {
    detached: true,
    stdio: 'ignore'
  }).unref()
}

export function openSandboxTerminal(sandboxName: string): void {
  openSandboxCommand(sandboxName, ['/bin/bash', '-l'])
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

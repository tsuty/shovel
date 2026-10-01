import { spawn } from 'node:child_process'

/** OS のターミナルアプリを開き、サンドボックス内でコマンドを実行させる。 */
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

  // Linux
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

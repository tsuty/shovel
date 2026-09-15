import { spawn } from 'node:child_process'

/**
 * OS のターミナルアプリを開き、`sbx exec -it <sandbox> /bin/bash -l` を
 * 渡す（decisions.md N-4）。フル機能のターミナルが必要な場合の唯一の逃げ道。
 * `node-pty` は使わない方針（F-2b）のため、ここだけは OS ごとの分岐が要る。
 */
export function openSandboxTerminal(sandboxName: string): void {
  const command = `sbx exec -it ${shellQuote(sandboxName)} /bin/bash -l`

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

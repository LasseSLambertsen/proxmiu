import ssh2, { type Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import type { WebSocket } from 'ws'
import { sleep } from './proxmox.js'
import { store } from './store.js'

export interface SshTarget {
  host: string
  port?: number
  username: string
  password?: string
  privateKey?: string
  /** use the app-wide key that proxmiu injects into the guests it creates */
  useAppKey?: boolean
}

function connectConfig(t: SshTarget): ConnectConfig {
  return {
    host: t.host,
    port: t.port ?? 22,
    username: t.username,
    password: t.password || undefined,
    privateKey: t.privateKey || (t.useAppKey ? store.sshKey().private : undefined),
    readyTimeout: 15_000,
    keepaliveInterval: 15_000,
    // Guests on the LAN regenerate host keys on every rebuild; there is no known_hosts to pin against.
    hostVerifier: () => true,
    tryKeyboard: true,
  }
}

export function connect(t: SshTarget): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client()
    conn.once('ready', () => resolve(conn))
    conn.once('error', reject)
    conn.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => t.password ?? '')))
    conn.connect(connectConfig(t))
  })
}

/** Retries until SSH accepts the connection (fresh guests take a while to boot sshd). */
export async function waitForSsh(t: SshTarget, timeoutMs = 180_000): Promise<Client> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      return await connect(t)
    } catch (err) {
      lastErr = err
      await sleep(3000)
    }
  }
  throw new Error(`SSH to ${t.host} never became ready: ${(lastErr as Error)?.message}`)
}

/** Runs a bash script (piped to stdin), streaming combined output line by line. Resolves with the exit code. */
export function runScript(conn: Client, script: string, opts: { sudo?: boolean; onLine: (line: string) => void }): Promise<number> {
  const cmd = opts.sudo ? 'sudo -n bash -s' : 'bash -s'
  return new Promise((resolve, reject) => {
    conn.exec(cmd, { pty: false }, (err, stream) => {
      if (err) return reject(err)
      let buf = ''
      const push = (chunk: Buffer) => {
        buf += chunk.toString('utf8').replace(/\r(?!\n)/g, '\n')
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const l of lines) opts.onLine(l)
      }
      stream.on('data', push)
      stream.stderr.on('data', push)
      stream.on('close', (code: number | null) => {
        if (buf) opts.onLine(buf)
        resolve(code ?? 0)
      })
      stream.end(script)
    })
  })
}

type ClientMsg =
  | ({ type: 'connect'; cols: number; rows: number; token?: string } & SshTarget)
  | { type: 'data'; data: string }
  | { type: 'resize'; cols: number; rows: number }

/** Bridges a browser WebSocket (xterm.js) to an interactive SSH shell. */
export function handleTerminalSocket(ws: WebSocket, authorize: (token?: string) => boolean) {
  let conn: Client | undefined
  let shell: ClientChannel | undefined
  const send = (msg: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg))

  ws.on('message', async (raw) => {
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type === 'connect' && !conn) {
      if (!authorize(msg.token)) {
        send({ type: 'error', message: 'Not logged in' })
        return ws.close(4401, 'Not logged in')
      }
      try {
        send({ type: 'status', status: 'connecting' })
        conn = await connect(msg)
        store.rememberSshUser(msg.host, msg.username)
        conn.shell({ term: 'xterm-256color', cols: msg.cols, rows: msg.rows }, (err, stream) => {
          if (err) {
            send({ type: 'error', message: err.message })
            return ws.close()
          }
          shell = stream
          send({ type: 'status', status: 'connected' })
          stream.setEncoding('utf8')
          stream.on('data', (d: string) => send({ type: 'data', data: d }))
          stream.stderr.on('data', (d: Buffer) => send({ type: 'data', data: d.toString('utf8') }))
          stream.on('close', () => {
            send({ type: 'status', status: 'closed' })
            ws.close()
          })
        })
        conn.on('error', (e) => send({ type: 'error', message: e.message }))
        conn.on('close', () => ws.close())
      } catch (err) {
        send({ type: 'error', message: (err as Error).message })
        ws.close()
      }
    } else if (msg.type === 'data') {
      shell?.write(msg.data)
    } else if (msg.type === 'resize') {
      shell?.setWindow(msg.rows, msg.cols, 0, 0)
    }
  })
  ws.on('close', () => conn?.end())
}

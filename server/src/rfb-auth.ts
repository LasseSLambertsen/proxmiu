import { createCipheriv } from 'node:crypto'

const version = Buffer.from('RFB 003.008\n')
const limit = 4096
const failure = () => new Error('Unsupported or invalid graphical console handshake.')

export function vncResponse(password: string, challenge: Buffer): Buffer {
  if (!/^[\x20-\x7e]{8}$/.test(password) || challenge.length !== 16) throw failure()
  const key = Buffer.alloc(24)
  for (let i = 0; i < 8; i++) {
    let n = password.charCodeAt(i)
    n = ((n & 0xf0) >> 4) | ((n & 0x0f) << 4)
    n = ((n & 0xcc) >> 2) | ((n & 0x33) << 2)
    n = ((n & 0xaa) >> 1) | ((n & 0x55) << 1)
    key[i] = key[i + 8] = key[i + 16] = n
  }
  try {
    // Three identical DES keys are equivalent to VNC's DES ECB operation.
    const cipher = createCipheriv('des-ede3', key, null)
    cipher.setAutoPadding(false)
    return Buffer.concat([cipher.update(challenge), cipher.final()])
  } finally { key.fill(0) }
}

type Hooks = { toUpstream: (bytes: Buffer) => void; toBrowser: (bytes: Buffer) => void; ready: () => void; connected?: () => void }
export class RfbAuthBridge {
  private up = Buffer.alloc(0)
  private down = Buffer.alloc(0)
  private upstreamPhase: 'version' | 'types' | 'challenge' | 'result' | 'ready' | 'relay' = 'version'
  private browserPhase: 'waiting' | 'version' | 'security' | 'init' | 'relay' = 'waiting'
  private disposed = false
  private password: string | undefined

  constructor(password: string, private hooks: Hooks) {
    if (!/^[\x20-\x7e]{8}$/.test(password)) throw failure()
    this.password = password
  }

  upstream(bytes: Buffer) {
    if (this.disposed) return
    try {
      if (this.upstreamPhase === 'relay') { this.hooks.toBrowser(bytes); return }
      if (this.upstreamPhase === 'ready' || this.up.length + bytes.length > limit) throw failure()
      this.up = Buffer.concat([this.up, bytes])
      while (this.up.length && !this.disposed) {
        if (this.upstreamPhase === 'version') {
          if (this.up.length < 12) return
          if (!this.takeUp(12).equals(version)) throw failure()
          this.upstreamPhase = 'types'
          this.hooks.toUpstream(version)
        } else if (this.upstreamPhase === 'types') {
          const count = this.up[0]
          if (count < 1 || count > 32) throw failure()
          if (this.up.length < count + 1) return
          if (!this.takeUp(count + 1).subarray(1).includes(2)) throw failure()
          this.upstreamPhase = 'challenge'
          this.hooks.toUpstream(Buffer.from([2]))
        } else if (this.upstreamPhase === 'challenge') {
          if (this.up.length < 16) return
          const response = vncResponse(this.password!, this.takeUp(16))
          this.password = undefined
          this.upstreamPhase = 'result'
          this.hooks.toUpstream(response)
        } else if (this.upstreamPhase === 'result') {
          if (this.up.length < 4) return
          if (this.takeUp(4).readUInt32BE() !== 0) throw failure()
          this.upstreamPhase = 'ready'
          this.browserPhase = 'version'
          this.hooks.ready()
          this.hooks.toBrowser(version)
        } else throw failure()
      }
    } catch (error) { this.dispose(); throw error }
  }

  browser(bytes: Buffer) {
    if (this.disposed) return
    try {
      if (this.browserPhase === 'waiting') throw failure()
      if (this.browserPhase === 'relay') { this.hooks.toUpstream(bytes); return }
      if (this.down.length + bytes.length > limit) throw failure()
      this.down = Buffer.concat([this.down, bytes])
      while (this.down.length && !this.disposed) {
        if (this.browserPhase === 'version') {
          if (this.down.length < 12) return
          if (!this.takeDown(12).equals(version)) throw failure()
          this.browserPhase = 'security'
          this.hooks.toBrowser(Buffer.from([1, 1]))
        } else if (this.browserPhase === 'security') {
          if (this.takeDown(1)[0] !== 1) throw failure()
          this.browserPhase = 'init'
          this.hooks.toBrowser(Buffer.alloc(4))
        } else if (this.browserPhase === 'init') {
          const init = this.takeDown(1)
          if (init[0] > 1 || this.upstreamPhase !== 'ready') throw failure()
          this.browserPhase = 'relay'
          this.upstreamPhase = 'relay'
          this.hooks.toUpstream(init)
          this.hooks.connected?.()
        } else {
          const remaining = this.down
          this.down = Buffer.alloc(0)
          this.hooks.toUpstream(remaining)
        }
      }
    } catch (error) { this.dispose(); throw error }
  }

  dispose() {
    this.disposed = true
    this.password = undefined
    this.up.fill(0); this.down.fill(0)
    this.up = Buffer.alloc(0); this.down = Buffer.alloc(0)
  }
  private takeUp(n: number): Buffer { const bytes = this.up.subarray(0, n); this.up = this.up.subarray(n); return bytes }
  private takeDown(n: number): Buffer { const bytes = this.down.subarray(0, n); this.down = this.down.subarray(n); return bytes }
}

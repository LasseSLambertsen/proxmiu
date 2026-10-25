import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ssh2 from 'ssh2'
import type { TemplateDef } from './templates.js'

export const DATA_DIR = resolve(process.env.PROXMIU_DATA_DIR ?? 'data')
const STATE_FILE = join(DATA_DIR, 'state.json')
const KEY_FILE = join(DATA_DIR, 'secret.key')

export interface ClusterRecord {
  id: string
  name: string
  host: string
  port: number
  authType: 'token' | 'password'
  /** token: "user@realm!tokenid", password: "user@realm" */
  username: string
  /** encrypted token secret or password */
  secret: string
  verifyTls: boolean
  createdAt: string
}

interface State {
  clusters: ClusterRecord[]
  templates: TemplateDef[]
  sshKey?: { public: string; private: string; createdAt: string }
  /** last username used per SSH host, so the terminal dialog can prefill it */
  sshUsers: Record<string, string>
}

mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })

function loadKey(): Buffer {
  if (process.env.PROXMIU_SECRET_KEY) return Buffer.from(process.env.PROXMIU_SECRET_KEY, 'base64')
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32).toString('base64'), { mode: 0o600 })
  return Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'base64')
}
const key = loadKey()
if (key.length !== 32) throw new Error('PROXMIU_SECRET_KEY / secret.key must be 32 bytes (base64)')

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':')
}

/** HMAC with the data key, used to sign stateless session tokens. */
export const sign = (data: string) => createHmac('sha256', key).update(data).digest('base64url')

export function decrypt(payload: string): string {
  const [v, iv, tag, enc] = payload.split(':')
  if (v !== 'v1') throw new Error('Unknown secret format')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8')
}

function load(): State {
  const empty: State = { clusters: [], templates: [], sshUsers: {} }
  if (!existsSync(STATE_FILE)) return empty
  return { ...empty, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }
}

const state = load()

function save() {
  const tmp = `${STATE_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  renameSync(tmp, STATE_FILE)
}

export const store = {
  listClusters: () => state.clusters,
  getCluster(id: string) {
    const c = state.clusters.find((c) => c.id === id)
    if (!c) throw Object.assign(new Error(`Unknown connection ${id}`), { statusCode: 404 })
    return c
  },
  addCluster(input: Omit<ClusterRecord, 'id' | 'createdAt' | 'secret'> & { secret: string }) {
    const rec: ClusterRecord = { ...input, id: randomUUID(), secret: encrypt(input.secret), createdAt: new Date().toISOString() }
    state.clusters.push(rec)
    save()
    return rec
  },
  removeCluster(id: string) {
    state.clusters = state.clusters.filter((c) => c.id !== id)
    save()
  },

  listCustomTemplates: () => state.templates,
  saveTemplate(t: TemplateDef) {
    const i = state.templates.findIndex((x) => x.id === t.id)
    if (i >= 0) state.templates[i] = t
    else state.templates.push(t)
    save()
  },
  removeTemplate(id: string) {
    state.templates = state.templates.filter((t) => t.id !== id)
    save()
  },

  /** The app-wide SSH key, injected into every guest it creates. Generated on first use. */
  sshKey() {
    if (!state.sshKey) return store.regenerateSshKey()
    return { public: state.sshKey.public, private: decrypt(state.sshKey.private), createdAt: state.sshKey.createdAt }
  },
  regenerateSshKey() {
    const pair = ssh2.utils.generateKeyPairSync('ed25519', { comment: 'proxmiu' })
    state.sshKey = { public: pair.public.trim(), private: encrypt(pair.private), createdAt: new Date().toISOString() }
    save()
    return { public: state.sshKey.public, private: pair.private, createdAt: state.sshKey.createdAt }
  },

  sshUser: (host: string) => state.sshUsers[host],
  rememberSshUser(host: string, user: string) {
    if (state.sshUsers[host] === user) return
    state.sshUsers[host] = user
    save()
  },
}

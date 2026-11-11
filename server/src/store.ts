import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ssh2 from 'ssh2'
import type { TemplateDef } from './templates.js'
import type { UpdatersState } from './host-updates.js'
import { guestMetadataParamsSchema, guestMetadataPatchSchema, type GuestMetadata } from './guest-insights.js'

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
  guestMetadata: Record<string, GuestMetadata>
  ai?: { provider: 'openai' | 'anthropic' | 'openrouter'; model: string; token: string }
  hostUpdaters?: UpdatersState
}

mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })

function loadKey(): Buffer {
  if (process.env.PROXMIU_SECRET_KEY) return Buffer.from(process.env.PROXMIU_SECRET_KEY, 'base64')
  if (!existsSync(KEY_FILE)) {
    const fd = openSync(KEY_FILE, 'wx', 0o600)
    try { writeFileSync(fd, randomBytes(32).toString('base64')); fsyncSync(fd) } finally { closeSync(fd) }
  }
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
  const empty: State = { clusters: [], templates: [], sshUsers: {}, guestMetadata: {} }
  if (!existsSync(STATE_FILE)) return empty
  return { ...empty, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }
}

const state = load()

function save() {
  const tmp = `${STATE_FILE}.tmp`
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2))
    fsyncSync(fd)
  } finally { closeSync(fd) }
  renameSync(tmp, STATE_FILE)
  if (process.platform !== 'win32') {
    const directory = openSync(DATA_DIR, 'r')
    try { fsyncSync(directory) } finally { closeSync(directory) }
  }
}

export const store = {
  hostUpdaterState: (): UpdatersState => structuredClone(state.hostUpdaters ?? { targets: {} }),
  saveHostUpdaterState(input: UpdatersState) {
    const previous = state.hostUpdaters
    state.hostUpdaters = structuredClone(input)
    try { save() } catch (error) { state.hostUpdaters = previous; throw error }
  },
  aiSettings() {
    return { configured: !!state.ai, provider: state.ai?.provider ?? 'openai' as const, model: state.ai?.model ?? 'gpt-4o-mini' }
  },
  aiCredentials() {
    if (!state.ai) throw Object.assign(new Error('Add an AI token in Settings first.'), { statusCode: 409 })
    return { ...state.ai, token: decrypt(state.ai.token) }
  },
  saveAiSettings(input: { provider: 'openai' | 'anthropic' | 'openrouter'; model: string; token?: string }) {
    if (!input.token && (!state.ai || state.ai.provider !== input.provider)) throw Object.assign(new Error('Enter a new token when choosing a provider.'), { statusCode: 400 })
    state.ai = { provider: input.provider, model: input.model, token: input.token ? encrypt(input.token) : state.ai!.token }
    save()
    return store.aiSettings()
  },
  removeAiSettings() {
    delete state.ai
    save()
    return store.aiSettings()
  },
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
  updateClusterSettings(id: string, input: { name: string; authType: 'token' | 'password'; username: string; verifyTls: boolean; secret?: string }) {
    const previous = store.getCluster(id)
    const index = state.clusters.findIndex(c => c.id === id)
    const updated = { ...previous, ...input, secret: input.secret === undefined ? previous.secret : encrypt(input.secret) }
    state.clusters[index] = updated
    try { save() } catch (error) { state.clusters[index] = previous; throw error }
    return updated
  },
  removeCluster(id: string) {
    if (state.hostUpdaters?.reservation?.key.startsWith(`${id}/`)) throw Object.assign(new Error('A host update is unresolved for this connection.'), { statusCode: 409 })
    state.clusters = state.clusters.filter((c) => c.id !== id)
    if (state.hostUpdaters) for (const [key, target] of Object.entries(state.hostUpdaters.targets)) if (target.clusterId === id) delete state.hostUpdaters.targets[key]
    for (const key of Object.keys(state.guestMetadata)) {
      if (key.startsWith(`${id}/`)) delete state.guestMetadata[key]
    }
    save()
  },

  listGuestMetadata: () => structuredClone(state.guestMetadata),
  updateGuestMetadata(id: string, type: 'qemu' | 'lxc', vmid: number, patch: { favorite?: boolean; notes?: string }): GuestMetadata {
    store.getCluster(id)
    guestMetadataParamsSchema.parse({ id, type, vmid: String(vmid) })
    const changes = guestMetadataPatchSchema.parse(patch)
    const key = `${id}/${type}/${vmid}`
    const previous = state.guestMetadata[key] ?? { favorite: false, notes: '' }
    const metadata = { ...previous, ...changes, updatedAt: new Date().toISOString() }
    state.guestMetadata[key] = metadata
    save()
    return { ...metadata }
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

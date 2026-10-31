import { templateSourceSchema, type TemplateDef, type TemplateOption, type TemplateSource } from './templates.js'

const COMMUNITY_SCRIPTS_DB = process.env.PROXMIU_COMMUNITY_SCRIPTS_DB ?? 'https://db.community-scripts.org'
const COMMUNITY_SCRIPTS_SITE = process.env.PROXMIU_COMMUNITY_SCRIPTS_SITE ?? 'https://community-scripts.org'
const SCRIPTS_REPO = 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE'
const CORE_REPO = 'https://raw.githubusercontent.com/community-scripts/core'

export interface CommunityScriptSummary {
  slug: string
  name: string
  description: string
  logo?: string
  category?: string
  updateable: boolean
  architectures: string[]
  resources: { cpu: number; ram: number; hdd: number; os?: string; version?: string }
}

interface CommunityRecord {
  slug: string
  name: string
  description?: string
  logo?: string
  updateable?: boolean
  privileged?: boolean
  architectures?: string[]
  app_vars?: { name: string; label?: string; type?: string; default?: string; options?: string[]; help?: string }[] | null
  categories?: string[]
  default_user?: string
  default_passwd?: string
  notes?: { text: string; type?: string }[]
  install_methods?: { type?: string; resources?: { cpu?: number; ram?: number; hdd?: number; os?: string; version?: string } }[]
  expand?: { type?: { type?: string }; categories?: { name?: string; icon?: string }[] }
  is_dev?: boolean
  is_deleted?: boolean
  is_disabled?: boolean
}

interface CommunityDetail {
  script: CommunityRecord
}

export function githubRawUrl(source: Extract<TemplateSource, { type: 'github' }>) {
  const parsed = templateSourceSchema.parse(source)
  if (parsed.type !== 'github') throw new Error('Expected a GitHub script source')
  return `https://raw.githubusercontent.com/${parsed.repo}/${parsed.ref}/${parsed.path.replace(/^\/+/, '')}`
}

async function fetchText(url: string, label: string, timeoutMs = 20_000): Promise<string> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'proxmiu' } })
  } catch (err) {
    throw Object.assign(new Error(`Could not fetch ${label}: ${(err as Error).message}`), { statusCode: 502 })
  }
  if (!res.ok) {
    throw Object.assign(new Error(`Could not fetch ${label} (${res.status} ${res.statusText})`), { statusCode: 502 })
  }
  const text = await res.text()
  if (!text.trim()) throw Object.assign(new Error(`${label} is empty`), { statusCode: 502 })
  if (text.length > 1_000_000) throw Object.assign(new Error(`${label} is too large`), { statusCode: 502 })
  return text
}

export const fetchGitHubScript = (source: Extract<TemplateSource, { type: 'github' }>) =>
  fetchText(githubRawUrl(source), `${source.repo}/${source.path}`)

const communityBase = (ref: string) => `${SCRIPTS_REPO}/${ref}`

export interface ResolvedCommunityScript {
  install: string
  engine: string
  scriptsBase: string
  coreBase: string
}
let cachedScripts: { at: number; scripts: CommunityScriptSummary[] } | undefined
let listing: Promise<CommunityScriptSummary[]> | undefined

function recordResources(record: CommunityRecord) {
  const methods = record.install_methods ?? []
  const method = methods.find((m) => m.type === 'default') ?? methods[0]
  const resources = method?.resources ?? {}
  return {
    cpu: resources.cpu ?? 2,
    ram: resources.ram ?? 2048,
    hdd: resources.hdd ?? 8,
    os: resources.os,
    version: resources.version,
  }
}

function summarize(record: CommunityRecord): CommunityScriptSummary {
  return {
    slug: record.slug,
    name: record.name,
    description: record.description ?? '',
    logo: record.logo,
    category: record.expand?.categories?.[0]?.name,
    updateable: record.updateable ?? false,
    architectures: record.architectures ?? ['amd64'],
    resources: recordResources(record),
  }
}

async function fetchCommunityRecords(): Promise<CommunityRecord[]> {
  const records: CommunityRecord[] = []
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: '200',
      sort: 'name',
      expand: 'type,categories',
      filter: '(is_deleted=false&&is_disabled=false&&is_dev=false)',
    })
    let res: Response
    try {
      res = await fetch(`${COMMUNITY_SCRIPTS_DB}/api/collections/script_scripts/records?${params}`, {
        signal: AbortSignal.timeout(20_000),
        headers: { 'User-Agent': 'proxmiu' },
      })
    } catch (err) {
      throw Object.assign(new Error(`Could not reach Community Scripts: ${(err as Error).message}`), { statusCode: 502 })
    }
    if (!res.ok) throw Object.assign(new Error(`Could not list Community Scripts (${res.status})`), { statusCode: 502 })
    const body = (await res.json()) as { items: CommunityRecord[]; totalPages?: number }
    records.push(...(body.items ?? []))
    if (!body.totalPages || page >= body.totalPages) break
  }
  return records.filter((r) => r.expand?.type?.type === 'lxc' && !r.is_dev)
}

export async function listCommunityScripts(): Promise<CommunityScriptSummary[]> {
  if (cachedScripts && Date.now() - cachedScripts.at < 10 * 60_000) return cachedScripts.scripts
  listing ??= fetchCommunityRecords()
    .then((records) => {
      const scripts = records.map(summarize).sort((a, b) => a.name.localeCompare(b.name))
      cachedScripts = { at: Date.now(), scripts }
      return scripts
    })
    .finally(() => {
      listing = undefined
    })
  return listing
}

async function communityDetail(slug: string): Promise<CommunityRecord> {
  const detail = await fetchText(`${COMMUNITY_SCRIPTS_SITE}/api/script-detail?slug=${encodeURIComponent(slug)}`, `Community Scripts entry "${slug}"`)
  try {
    return (JSON.parse(detail) as CommunityDetail).script
  } catch {
    throw Object.assign(new Error(`Community Scripts returned invalid metadata for "${slug}"`), { statusCode: 502 })
  }
}

/** Fetches the upstream installer and the engine it sources, using the same layout as `pct exec`. */
export async function resolveCommunityScript(slug: string, ref = 'main'): Promise<ResolvedCommunityScript> {
  const parsed = templateSourceSchema.parse({ type: 'community-scripts', slug, ref })
  if (parsed.type !== 'community-scripts') throw new Error('Expected a Community Scripts source')
  const [install, engine] = await Promise.all([
    fetchText(`${communityBase(parsed.ref)}/install/${parsed.slug}-install.sh`, `Community Scripts installer "${parsed.slug}"`),
    fetchText(`${CORE_REPO}/main/lxc/install.func`, 'Community Scripts engine'),
  ])
  return {
    install,
    engine,
    scriptsBase: communityBase(parsed.ref),
    coreBase: `${CORE_REPO}/main`,
  }
}

const shellQuote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`

function heredoc(path: string, content: string) {
  let marker = 'PROXMIU_SCRIPT_EOF'
  while (content.includes(marker)) marker += '_X'
  return `cat > ${shellQuote(path)} <<'${marker}'\n${content}\n${marker}`
}

/** Community Scripts installers expect the same environment the host-side `pct exec` provides. */
export function buildCommunityScript(template: TemplateDef, env: Record<string, string>, resolved: ResolvedCommunityScript) {
  const [pctOs = 'debian', ...versionParts] = (template.os[0] ?? 'debian-12').split('-')
  const pctVersion = versionParts.join('-')
  const exports = Object.entries({
    ...env,
    APPLICATION: template.name,
    app: template.source?.type === 'community-scripts' ? template.source.slug : template.id,
    MODE: 'default',
    DIAGNOSTICS: 'no',
    TERM: 'dumb',
    DEBIAN_FRONTEND: 'noninteractive',
    PCT_OSTYPE: pctOs,
    PCT_OSVERSION: pctVersion,
    var_os: pctOs,
    var_version: pctVersion,
    CTTYPE: template.privileged ? '0' : '1',
    CT_TYPE: template.privileged ? '0' : '1',
    var_unprivileged: template.privileged ? '0' : '1',
    COMMUNITY_SCRIPTS_URL: resolved.scriptsBase,
    COMMUNITY_SCRIPTS_CORE_URL: resolved.coreBase,
  })
    .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
    .join('\n')
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'log() { echo "==> $*"; }',
    'retry() { local n=0; until "$@"; do n=$((n+1)); [ "$n" -ge 3 ] && return 1; sleep 5; done; }',
    exports,
    '# The host-side builder normally installs these before lxc-attach; mirror it here.',
    'log "Installing base packages"',
    'retry apt-get update -q || true',
    'retry apt-get install -y -q --no-install-recommends sudo curl ca-certificates gnupg jq || true',
    'install -d -m 700 /root/.proxmiu-install',
    heredoc('/root/.proxmiu-install/install.func', resolved.engine),
    'export FUNCTIONS_FILE_PATH="$(cat /root/.proxmiu-install/install.func)"',
    heredoc('/root/.proxmiu-install/install.sh', resolved.install),
    'log "Running the Community Scripts installer"',
    'bash /root/.proxmiu-install/install.sh < /dev/null',
    '',
  ].join('\n')
}

const osTemplate = (resources: { os?: string; version?: string }) => {
  const os = resources.os?.toLowerCase()
  if (!os || !resources.version) return ['debian-12', 'ubuntu-24.04']
  const name = os === 'alpine' ? `alpine-${resources.version}` : `${os}-${resources.version}`
  return [name, 'debian-12', 'ubuntu-24.04']
}

const optionKey = (name: string) =>
  name
    .replace(/^var_/, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/^([0-9])/, '_$1')

function communityOptions(record: CommunityRecord): TemplateOption[] {
  return (record.app_vars ?? []).map((v) => {
    const type = v.type === 'boolean' ? 'boolean' : v.type === 'password' ? 'secret' : 'text'
    const help = [v.help, v.options?.length ? `Options: ${v.options.join(', ')}` : undefined].filter(Boolean).join(' ')
    const raw = v.default
    return {
      key: optionKey(v.name),
      label: v.label || v.name.replace(/^var_/, '').replace(/_/g, ' '),
      type,
      default: type === 'boolean' ? raw === 'yes' || raw === 'true' || raw === '1' : type === 'text' ? (raw ?? '') : undefined,
      help: help || undefined,
      env: v.name,
    } as TemplateOption
  })
}

/** Builds an unsaved template from a Community Scripts entry. */
export async function communityScriptTemplate(slug: string, ref = 'main'): Promise<TemplateDef> {
  const source = templateSourceSchema.parse({ type: 'community-scripts', slug, ref })
  if (source.type !== 'community-scripts') throw new Error('Expected a Community Scripts source')
  const record = await communityDetail(source.slug)
  const resources = recordResources(record)
  const notes = (record.notes ?? []).map((n) => n.text).filter(Boolean)
  if (record.default_user || record.default_passwd) {
    notes.push(`Default login: \`${record.default_user || 'root'}\` / \`${record.default_passwd || 'see the app docs'}\`.`)
  }
  notes.push('Installed with a script from community-scripts.org.')

  const category = record.expand?.categories?.[0]?.name
  return {
    id: `cs-${source.slug}`,
    name: record.name,
    description: record.description ?? '',
    icon: 'box',
    tags: ['community-scripts', ...(category ? [category.toLowerCase()] : [])],
    kind: 'lxc',
    os: osTemplate(resources),
    resources: { cores: resources.cpu, memory: resources.ram, disk: resources.hdd, swap: 512 },
    nesting: true,
    privileged: record.privileged ?? false,
    user: 'root',
    options: communityOptions(record),
    script: '',
    source: { type: 'community-scripts', slug: source.slug, ref: source.ref },
    notes: notes.join('\n'),
  }
}

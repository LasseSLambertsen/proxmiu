import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { store } from './store.js'

export const templateOptionSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'Use UPPER_SNAKE_CASE'),
  label: z.string().min(1),
  type: z.enum(['text', 'secret', 'boolean']),
  default: z.union([z.string(), z.boolean()]).optional(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  /** env var the script reads; defaults to OPT_<KEY>, or var_<key> for community-scripts */
  env: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
})

const ownerRepo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const safeRef = /^[A-Za-z0-9_./-]+$/
const safePath = /^[A-Za-z0-9_./-]+$/
const noTraversal = (p: string) => !p.includes('..') && !p.startsWith('/')

/** Where a template's install script comes from. Inline scripts are the default. */
export const templateSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('github'),
    repo: z
      .string()
      .regex(ownerRepo, 'Use owner/repository')
      .refine((r) => r.split('/').every((p) => p !== '.' && p !== '..'), 'Invalid repository'),
    ref: z.string().regex(safeRef, 'Invalid branch or tag').refine(noTraversal, 'Invalid branch or tag').default('main'),
    path: z.string().regex(safePath, 'Invalid file path').refine(noTraversal, 'Invalid file path'),
  }),
  z.object({
    type: z.literal('community-scripts'),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    ref: z.string().regex(safeRef, 'Invalid branch or tag').refine(noTraversal, 'Invalid branch or tag').default('main'),
  }),
])

export const templateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().default(''),
  icon: z.string().default('box'),
  tags: z.array(z.string()).default([]),
  kind: z.enum(['lxc', 'qemu']).default('lxc'),
  /** preferred LXC OS templates, matched as prefixes against Proxmox' template list */
  os: z.array(z.string()).default(['debian-12', 'ubuntu-24.04']),
  resources: z.object({
    cores: z.number().int().min(1).max(128),
    memory: z.number().int().min(256),
    disk: z.number().int().min(2),
    swap: z.number().int().min(0).default(512),
  }),
  nesting: z.boolean().default(true),
  privileged: z.boolean().default(false),
  user: z.string().regex(/^[a-z_][a-z0-9_-]*$/).default('dev'),
  options: z.array(templateOptionSchema).default([]),
  script: z.string().default(''),
  source: templateSourceSchema.optional(),
  notes: z.string().default(''),
  builtin: z.boolean().optional(),
})

export type TemplateDef = z.infer<typeof templateSchema>
export type TemplateOption = z.infer<typeof templateOptionSchema>
export type TemplateSource = z.infer<typeof templateSourceSchema>

const devOptions: TemplateOption[] = [
  { key: 'TMUX_AUTOATTACH', label: 'Persistent tmux session on login', type: 'boolean', default: true, help: 'SSH drops into the same tmux session every time, so agents keep running when you disconnect.' },
  { key: 'GIT_NAME', label: 'Git name', type: 'text', placeholder: 'Ada Lovelace' },
  { key: 'GIT_EMAIL', label: 'Git email', type: 'text', placeholder: 'ada@example.com' },
  { key: 'GITHUB_TOKEN', label: 'GitHub token', type: 'secret', help: 'Installs the GitHub CLI and logs it in, so the agent can clone, push and open PRs.' },
  { key: 'REPO_URL', label: 'Clone repository', type: 'text', placeholder: 'https://github.com/you/project.git', help: 'Cloned into ~/code.' },
  { key: 'TAILSCALE_AUTHKEY', label: 'Tailscale auth key', type: 'secret', help: 'Joins your tailnet with Tailscale SSH, so you can reach the box from anywhere.' },
]

const anthropicKey: TemplateOption = {
  key: 'ANTHROPIC_API_KEY',
  label: 'Anthropic API key',
  type: 'secret',
  help: 'Optional. Leave empty to log in with your Claude subscription on first run.',
}
const openaiKey: TemplateOption = {
  key: 'OPENAI_API_KEY',
  label: 'OpenAI API key',
  type: 'secret',
  help: 'Optional. Leave empty to sign in with ChatGPT using `codex login --device-auth`.',
}

const installClaude = `
log "Installing Claude Code"
install_node
# pipefail: a failed download would otherwise look like success (bash happily runs an empty script).
if ! as_user_sh 'set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash'; then
  log "Native installer failed, falling back to npm"
  npm install -g @anthropic-ai/claude-code
fi
as_user_sh 'claude --version'
if [ -n "\${OPT_ANTHROPIC_API_KEY:-}" ]; then persist_env ANTHROPIC_API_KEY "$OPT_ANTHROPIC_API_KEY"; fi
`

const installCodex = `
log "Installing OpenAI Codex CLI"
install_node
npm install -g @openai/codex
as_user_sh 'codex --version'
if [ -n "\${OPT_OPENAI_API_KEY:-}" ]; then
  persist_env OPENAI_API_KEY "$OPT_OPENAI_API_KEY"
  printf '%s' "$OPT_OPENAI_API_KEY" | as_user codex login --with-api-key >/dev/null 2>&1 || true
fi
`

const installOpencode = `
log "Installing OpenCode"
install_node
apt_install ripgrep
# pipefail: a failed download would otherwise look like success (bash happily runs an empty script).
if ! as_user_sh 'set -o pipefail; curl -fsSL https://opencode.ai/install | bash'; then
  log "Native installer failed, falling back to npm"
  npm install -g opencode-ai
fi
as_user_sh 'export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"; opencode --version'

if [ -n "\${OPT_ANTHROPIC_API_KEY:-}" ]; then persist_env ANTHROPIC_API_KEY "$OPT_ANTHROPIC_API_KEY"; fi
if [ -n "\${OPT_OPENAI_API_KEY:-}" ]; then persist_env OPENAI_API_KEY "$OPT_OPENAI_API_KEY"; fi
if [ -n "\${OPT_OPENROUTER_API_KEY:-}" ]; then persist_env OPENROUTER_API_KEY "$OPT_OPENROUTER_API_KEY"; fi
`

const PROXMIU_SCRIPTS_REPO = 'LasseSLambertsen/proxmiu-scripts'
const proxmiuScript = (name: string): TemplateDef['source'] => ({ type: 'github', repo: PROXMIU_SCRIPTS_REPO, ref: 'main', path: `scripts/${name}.sh` })

export const builtinTemplates: TemplateDef[] = [
  {
    id: 'claude-code',
    name: 'Claude Code server',
    description: 'A remote dev box with Claude Code, Node.js, git and tmux. SSH in from any device and let Claude work while you are away.',
    icon: 'sparkles',
    tags: ['ai', 'dev'],
    kind: 'lxc',
    os: ['debian-12', 'debian-13', 'ubuntu-24.04'],
    resources: { cores: 4, memory: 8192, disk: 32, swap: 1024 },
    nesting: true,
    user: 'dev',
    options: [anthropicKey, ...devOptions],
    script: installClaude,
    source: proxmiuScript('claude-code'),
    notes: 'Connect with `ssh {user}@{ip}` and run `claude`. If you did not set an API key, the first run walks you through logging in with your Claude account.',
  },
  {
    id: 'codex',
    name: 'Codex server',
    description: "A remote dev box with OpenAI's Codex CLI, Node.js, git and tmux. Ready for long-running agent sessions.",
    icon: 'terminal',
    tags: ['ai', 'dev'],
    kind: 'lxc',
    os: ['debian-12', 'debian-13', 'ubuntu-24.04'],
    resources: { cores: 4, memory: 8192, disk: 32, swap: 1024 },
    nesting: true,
    user: 'dev',
    options: [openaiKey, ...devOptions],
    script: installCodex,
    source: proxmiuScript('codex'),
    notes: 'Connect with `ssh {user}@{ip}` and run `codex`. Without an API key, sign in with `codex login --device-auth`.',
  },
  {
    id: 'opencode',
    name: 'OpenCode server',
    description: 'A remote dev box with OpenCode, Node.js, git and tmux. SSH in from any device and keep an agent session running while you are away.',
    icon: 'terminal',
    tags: ['ai', 'dev'],
    kind: 'lxc',
    os: ['debian-12', 'debian-13', 'ubuntu-24.04'],
    resources: { cores: 4, memory: 8192, disk: 32, swap: 1024 },
    nesting: true,
    user: 'dev',
    options: [
      anthropicKey,
      openaiKey,
      { key: 'OPENROUTER_API_KEY', label: 'OpenRouter API key', type: 'secret', help: 'Optional. Lets OpenCode use OpenRouter models; leave empty to connect a provider on first run.' },
      ...devOptions,
    ],
    source: proxmiuScript('opencode'),
    script: installOpencode,
    notes: 'Connect with `ssh {user}@{ip}` and run `opencode`. Use `/connect` to add or change a provider.',
  },
  {
    id: 'ai-devbox',
    name: 'AI dev box',
    description: 'Claude Code and Codex side by side on one box. Same toolchain, pick the agent per task.',
    icon: 'bot',
    tags: ['ai', 'dev'],
    kind: 'lxc',
    os: ['debian-12', 'debian-13', 'ubuntu-24.04'],
    resources: { cores: 6, memory: 12288, disk: 48, swap: 1024 },
    nesting: true,
    user: 'dev',
    options: [anthropicKey, openaiKey, ...devOptions],
    script: installClaude + installCodex,
    source: proxmiuScript('ai-devbox'),
    notes: 'Connect with `ssh {user}@{ip}`, then run `claude` or `codex`.',
  },
  {
    id: 'docker-host',
    name: 'Docker host',
    description: 'Docker Engine and Compose, with your user in the docker group.',
    icon: 'container',
    tags: ['infra'],
    kind: 'lxc',
    os: ['debian-12', 'debian-13', 'ubuntu-24.04'],
    resources: { cores: 2, memory: 4096, disk: 32, swap: 512 },
    nesting: true,
    user: 'dev',
    options: [devOptions[0]],
    script: `
log "Installing Docker"
curl -fsSL https://get.docker.com | sh
usermod -aG docker "$PM_USER"
systemctl enable --now docker
`,
    source: proxmiuScript('docker-host'),
    notes: 'Connect with `ssh {user}@{ip}` and run `docker compose up`.',
  },
  {
    id: 'base',
    name: 'Plain server',
    description: 'A clean, updated Debian box with a sudo user, SSH keys and the basics.',
    icon: 'server',
    tags: ['infra'],
    kind: 'lxc',
    os: ['debian-12', 'debian-13', 'ubuntu-24.04'],
    resources: { cores: 1, memory: 1024, disk: 8, swap: 512 },
    nesting: false,
    user: 'dev',
    options: [],
    script: '',
    notes: 'Connect with `ssh {user}@{ip}`.',
  },
].map((t) => ({ ...t, privileged: false, builtin: true }) as TemplateDef)

export function allTemplates(): TemplateDef[] {
  return [...builtinTemplates, ...store.listCustomTemplates().map((t) => ({ ...t, privileged: t.privileged ?? false, builtin: false }))]
}

export function getTemplate(id: string) {
  const t = allTemplates().find((t) => t.id === id)
  if (!t) throw Object.assign(new Error(`Unknown template ${id}`), { statusCode: 404 })
  return t
}



const script = (name: string) => readFileSync(new URL(`./scripts/${name}`, import.meta.url), 'utf8')
const HELPERS = script('helpers.sh')
const PRELUDE = script('prelude.sh')
const EPILOGUE = script('epilogue.sh')

const shellQuote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`

const scriptExports = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
    .join('\n')

export function buildScript(t: TemplateDef, env: Record<string, string>, body = t.script) {
  return ['#!/usr/bin/env bash', scriptExports(env), HELPERS, PRELUDE, '# --- template ---', body, '# --- extras ---', EPILOGUE, 'log "Provisioning finished"', ''].join('\n')
}

/** Re-runs a template's install body without repeating the base setup. */
export function buildUpdateScript(t: TemplateDef, env: Record<string, string>, body = t.script) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'export DEBIAN_FRONTEND=noninteractive',
    scriptExports(env),
    HELPERS,
    '# --- update ---',
    body,
    'log "Update finished"',
    '',
  ].join('\n')
}

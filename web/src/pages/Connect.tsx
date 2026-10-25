import { AlertTriangle, ArrowRight, ExternalLink, Info, ShieldCheck, Smartphone, Terminal } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { CopyButton } from '@/components/CopyButton'
import { Logo } from '@/components/Layout'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { addressSpace, agentFetch, isAppleWebKit, isLocalhostUrl, isMixedContent, localNetworkAccessSupported, normalizeAgentUrl, probeAgent, setAgent } from '@/lib/agent'

const REPO = 'https://github.com/lasseslambertsen/proxmiu'

function Hint({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 text-faint [&_svg]:size-4">{icon}</span>
      <span>{children}</span>
    </li>
  )
}

function CodeLine({ text }: { text: string }) {
  return (
    <div className="mt-1.5 flex items-start gap-1 rounded-md border border-border bg-inset py-1.5 pl-3 pr-1">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all py-0.5 text-[12px] text-foreground">{text}</code>
      <CopyButton text={text} />
    </div>
  )
}

/**
 * Shown when no agent is reachable yet (hosted UI) or the agent needs a password.
 * sameOrigin: the agent serves this page, so only the password is asked for.
 */
export function Connect({ initialUrl, sameOrigin, onConnected }: { initialUrl?: string; sameOrigin: boolean; onConnected: () => void }) {
  const [url, setUrl] = useState(initialUrl ?? '')
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(sameOrigin)
  const [error, setError] = useState<{ message: string; network: boolean; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [lna, setLna] = useState(false)
  useEffect(() => {
    localNetworkAccessSupported.then(setLna)
  }, [])
  const origin = location.origin
  const target = sameOrigin ? '' : normalizeAgentUrl(url)

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      const health = await probeAgent(target).catch((err: Error) => {
        throw Object.assign(err, { network: err.name === 'TypeError' || err.name === 'TimeoutError' })
      })
      let token: string | undefined
      if (health.authRequired) {
        if (!password) {
          setNeedsPassword(true)
          return
        }
        const res = await agentFetch(`${target}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? 'Login failed')
        token = data.token
      }
      setAgent({ url: target, token })
      onConnected()
    } catch (err) {
      const e = err as Error & { network?: boolean }
      setError({ message: e.network ? 'Could not reach the agent.' : e.message, network: !!e.network, url: target })
    } finally {
      setBusy(false)
    }
  }

  const mixed = !sameOrigin && !!target && isMixedContent(target)
  // Chrome may reach http:// agents on private IPs from this https page, after asking the user.
  const chromeLocal = mixed && lna && addressSpace(target) === 'local'
  const blocked = mixed && !chromeLocal
  const apple = isAppleWebKit()
  const httpsAgent = target.startsWith('https:')

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,var(--glow),transparent_70%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_30%,black,transparent)]"
        style={{ backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)', backgroundSize: '48px 48px' }}
      />
      <div className="relative w-full max-w-[420px]">
        <div className="mb-8 flex justify-center">
          <Logo size={32} />
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-float)]">
          <h1 className="text-[18px] tracking-[-0.02em]">{sameOrigin ? 'Log in' : 'Connect to your agent'}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            {sameOrigin
              ? 'Enter the password this agent was started with.'
              : 'Proxmiu talks to your Proxmox hosts through a small agent running on your network. Enter its address.'}
          </p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              connect()
            }}
          >
            {!sameOrigin && (
              <Field label="Agent address">
                <Input
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value)
                    setError(null)
                  }}
                  placeholder="https://192.168.1.20:8787"
                  autoFocus
                  spellCheck={false}
                  className="font-mono"
                />
              </Field>
            )}
            {needsPassword && (
              <Field label="Password">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={sameOrigin || needsPassword} />
              </Field>
            )}
            {chromeLocal && (
              <div className="flex gap-2.5 rounded-lg bg-info-soft p-3 text-[12.5px] leading-relaxed text-info">
                <Info className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                <span>Chrome will ask to let this site access devices on your local network. Choose Allow.</span>
              </div>
            )}
            {blocked && (
              <div className="flex gap-2.5 rounded-lg bg-warning-soft p-3 text-[12.5px] leading-relaxed text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                <span>
                  {apple ? 'Safari and iOS browsers' : 'This browser'} block plain <code>http://</code> agents from an https page. Use an{' '}
                  <code>https://</code> address for the agent{apple ? ' (see "Using it on iPhone" below).' : ', e.g. start it with PROXMIU_TLS=1.'}
                </span>
              </div>
            )}
            {error && <p className="text-[13px] text-destructive">{error.message}</p>}
            <Button variant="brand" size="lg" className="w-full" loading={busy} type="submit" disabled={!sameOrigin && !url.trim()}>
              {sameOrigin ? 'Log in' : needsPassword ? 'Connect' : 'Continue'}
              {!busy && <ArrowRight strokeWidth={2} />}
            </Button>
          </form>
        </div>

        {error?.network && !sameOrigin && (
          <div className="mt-4 rounded-xl border border-border bg-card p-5 text-[13px] text-muted">
            <div className="mb-3 font-medium text-foreground">Things to check</div>
            <ul className="space-y-3">
              <Hint icon={<Terminal />}>Is the agent running, and is this device on the same network?</Hint>
              {httpsAgent && !isLocalhostUrl(error.url) && (
                <Hint icon={<ShieldCheck />}>
                  The agent uses a self-signed certificate. Open{' '}
                  <a href={error.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                    {error.url}
                    <ExternalLink className="size-3" />
                  </a>{' '}
                  once, accept the warning, then try again.
                </Hint>
              )}
              <Hint icon={<ShieldCheck />}>
                The agent must allow this site. Start it with:
                <CodeLine text={`PROXMIU_ALLOWED_ORIGINS=${origin}`} />
              </Hint>
            </ul>
          </div>
        )}

        {!sameOrigin && apple && (
          <details className="group mt-4 rounded-xl border border-border bg-card text-[13px] text-muted" open={blocked || error?.network}>
            <summary className="cursor-pointer list-none px-5 py-3.5 font-medium text-foreground marker:hidden">
              <span className="inline-flex items-center gap-2">
                <Smartphone className="size-3.5 text-faint" strokeWidth={2} />
                Using it on iPhone or iPad
              </span>
            </summary>
            <div className="space-y-3 border-t border-border-subtle px-5 py-4 leading-relaxed">
              <p>
                iOS only lets this page reach agents with a trusted HTTPS certificate. The simplest way is Tailscale, which also works away from home. On
                the agent machine (with Tailscale installed and HTTPS enabled for your tailnet):
              </p>
              <CodeLine text="tailscale serve --bg 8787" />
              <p>
                Then, with the Tailscale app on, connect to <code className="text-foreground">https://&lt;machine&gt;.&lt;tailnet&gt;.ts.net</code>. Tip: use
                Share → Add to Home Screen to install Proxmiu as an app.
              </p>
            </div>
          </details>
        )}

        {!sameOrigin && (
          <details className="group mt-4 rounded-xl border border-border bg-card text-[13px] text-muted">
            <summary className="cursor-pointer list-none px-5 py-3.5 font-medium text-foreground marker:hidden">
              <span className="inline-flex items-center gap-2">
                <ArrowRight className="size-3.5 text-faint transition-transform group-open:rotate-90" strokeWidth={2} />
                Don't have an agent yet?
              </span>
            </summary>
            <div className="space-y-3 border-t border-border-subtle px-5 py-4 leading-relaxed">
              <p>Run it with Docker on any always-on machine on your LAN (a Proxmox container works well):</p>
              <CodeLine text={`git clone ${REPO}.git && cd proxmiu\nPROXMIU_PASSWORD='pick-a-long-one' \\\nPROXMIU_ALLOWED_ORIGINS=${origin} \\\nPROXMIU_TLS=1 docker compose up -d --build`} />
              <p>
                Then connect to <code className="text-foreground">https://&lt;that-machine&gt;:8787</code>. The agent also serves this UI itself, so you can use it
                without a hosted site.
              </p>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

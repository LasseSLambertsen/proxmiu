import { Activity, ArrowLeft, ArrowRight, Cpu, HardDrive, LayoutDashboard, LayoutTemplate, MemoryStick, Moon, Server, ShieldCheck, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/form'
import { TemplateTile } from '@/components/TemplateIcon'
import { Meter } from '@/components/Meter'
import { Sparkline } from '@/components/Sparkline'
import { ResourceHistory } from '@/components/ResourceHistory'
import { cn } from '@/lib/utils'
import logo from '../../public/logo.png'
import { guests, metricsFor, runs, snapshot, templates, type SampleGuest } from './data'
import '../index.css'
import './style.css'

const sections = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/guests', label: 'Guests', icon: Server },
  { href: '/templates', label: 'Templates', icon: LayoutTemplate },
  { href: '/activity', label: 'Activity', icon: Activity },
]
function initialTheme() { try { return localStorage.getItem('proxmiu-demo-theme') !== 'light' } catch { return true } }
function hashRoute() { return window.location.hash.slice(1) || '/' }
function App() {
  const [route, setRoute] = useState(hashRoute)
  const [dark, setDark] = useState(initialTheme)
  useEffect(() => { const change = () => setRoute(hashRoute()); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change) }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--background').trim())
    try { localStorage.setItem('proxmiu-demo-theme', dark ? 'dark' : 'light') } catch { /* In-memory theme remains useful when storage is unavailable. */ }
  }, [dark])
  useEffect(() => { document.querySelector('main')?.scrollTo(0, 0) }, [route])
  const section = '/' + (route.split('/')[1] || '')
  let content
  if (route === '/') content = <Overview />
  else if (route === '/guests') content = <GuestInventory />
  else if (route === '/templates') content = <Templates />
  else if (route === '/activity') content = <ActivityList />
  else if (route.startsWith('/guests/')) { const guest = guests.find(guest => route === `/guests/${guest.id}`); content = guest ? <GuestWorkspace key={guest.id} guest={guest} /> : <NotFound /> }
  else if (route.startsWith('/templates/')) { const template = templates.find(template => route === `/templates/${template.id}`); content = template ? <TemplateDetails template={template} /> : <NotFound /> }
  else if (route.startsWith('/activity/')) { const run = runs.find(run => route === `/activity/${run.id}`); content = run ? <RunDetails key={run.id} run={run} /> : <NotFound /> }
  else content = <NotFound />
  return <div className="demo-shell">
    <a href="#demo-content" className="demo-skip" onClick={event => { event.preventDefault(); document.getElementById('demo-content')?.focus() }}>Skip to content</a>
    <aside className="demo-rail nav-glass"><div className="demo-rail-glass nav-sheen" /><div className="demo-rail-content">
      <a href="#/" className="demo-logo" aria-label="Proxmiu sample overview"><img src={logo} alt="" width="30" height="30" /><span>Proxmiu</span></a>
      <div className="demo-rail-note">A little room to explore.</div>
      <Navigation section={section} />
      <div className="demo-rail-footer"><ShieldCheck size={18} /><span>Read-only by design<br /><small>No agent connected</small></span></div>
    </div></aside>
    <main id="demo-content" tabIndex={-1} className="demo-main">
      <div className="demo-banner"><div><span className="demo-sample-dot" /><strong>Demo · Sample data</strong><span className="demo-banner-description">Explore freely. Your infrastructure stays yours.</span></div><Button variant="ghost" size="icon" aria-label="Toggle demo theme" title={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark(!dark)}>{dark ? <Sun /> : <Moon />}</Button></div>
      <div className="demo-content"><div className="demo-links"><a href="/">Exit demo</a><Button asChild variant="primary"><a href="/#install">Install Proxmiu <ArrowRight /></a></Button></div>{content}<footer className="demo-footnote">Fixed sample snapshot · {snapshot}. All hosts, guests and history are synthetic. Exploration resets on reload.</footer></div>
    </main>
    <div className="demo-dock nav-glass"><Navigation section={section} /></div>
  </div>
}
function Navigation({ section }: { section: string }) {
  return <nav aria-label="Demo sections">{sections.map(({ href, label, icon: Icon }) => <a key={href} href={'#' + href} aria-current={section === href ? 'page' : undefined} title={label} className={cn(section === href && 'active')}><Icon size={18} strokeWidth={1.75} /><span>{label}</span></a>)}</nav>
}
function Heading({ title, description }: { title: string; description: string }) { return <header className="demo-heading"><h1>{title}</h1><p>{description}</p></header> }
function Status({ status }: { status: string }) { return <Badge tone={status === 'running' || status === 'Success' ? 'success' : status === 'Error' ? 'destructive' : status === 'Interrupted' ? 'warning' : 'neutral'}>{status}</Badge> }
function Overview() {
  const totalMemory = guests.reduce((total, guest) => total + guest.memory, 0)
  const usedMemory = guests.reduce((total, guest) => total + guest.used, 0)
  const nodeCount = new Set(guests.map(guest => guest.node)).size
  const runningCount = guests.filter(guest => guest.status === 'running').length
  return <><Heading title="Overview" description="Your lab, at a glance. This one's a carefully staged sample." />
    <div className="demo-stats">{[
      { label: 'Sample nodes', value: String(nodeCount), note: 'Across one synthetic lab', icon: Server, tint: 'tint-warm' },
      { label: 'Running guests', value: `${runningCount} / ${guests.length}`, note: 'One stopped VM to inspect', icon: Cpu, tint: 'tint-cool' },
      { label: 'Memory in use', value: `${usedMemory.toFixed(1)} GiB`, note: `Of ${totalMemory} GiB guest allocation`, icon: MemoryStick, tint: 'tint-blue' },
    ].map(({ label, value, note, icon: Icon, tint }) => <Card className={tint} key={label}><CardContent><div className="flex items-center justify-between text-muted"><span>{label}</span><Icon size={16} /></div><div className="tnum my-2 text-[30px] font-semibold tracking-[-0.035em]">{value}</div><p className="text-[12px] text-muted">{note}</p></CardContent></Card>)}</div>
    <div className="demo-overview-columns"><Card><CardHeader><CardTitle>Sample nodes</CardTitle><Badge>Fixed snapshot</Badge></CardHeader><CardContent className="space-y-6">{[{ name: 'pve-amber', ip: '192.0.2.10', cpu: 24, memory: 38 }, { name: 'pve-teal', ip: '192.0.2.20', cpu: 41, memory: 62 }].map(node => <div key={node.name}><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><Server size={18} className="text-brand" /><div><h3 className="text-[13px]">{node.name}</h3><p className="font-mono text-[11px] text-muted">{node.ip}</p></div></div><Badge tone="success">Sample online</Badge></div><div className="grid grid-cols-2 gap-5"><div><div className="mb-2 flex justify-between text-[11px] text-muted"><span>CPU</span><span>{node.cpu}%</span></div><Meter value={node.cpu} /></div><div><div className="mb-2 flex justify-between text-[11px] text-muted"><span>Memory</span><span>{node.memory}%</span></div><Meter value={node.memory} /></div></div></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>A sharp eye helps</CardTitle><img src={logo} alt="" className="size-7 rounded-md" /></CardHeader><CardContent><p className="text-[15px] font-medium leading-relaxed">A busy moment isn't a pattern.</p><p className="my-3 text-[13px] leading-relaxed text-muted">Papertrail uses more memory than its neighbours. Open a guest and inspect the history before drawing conclusions. Even a lynx checks twice.</p><a className="demo-text-link" href="#/guests/201">Inspect papertrail <ArrowRight size={14} /></a><div className="mt-5 border-t border-border-subtle pt-4 text-[12px] text-muted">Read-only tour. No terminal, credentials or infrastructure actions.</div></CardContent></Card></div>
    <Card><CardHeader><CardTitle>Guest inventory</CardTitle><a href="#/guests" className="demo-text-link">Browse all <ArrowRight size={14} /></a></CardHeader><div>{guests.slice(0, 3).map(guest => <GuestRow key={guest.id} guest={guest} />)}</div></Card>
  </>
}
function GuestRow({ guest }: { guest: SampleGuest }) { return <div className="demo-guest-row"><div className="flex min-w-0 items-center gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-inset text-muted"><Server size={17} /></div><div className="min-w-0"><a href={`#/guests/${guest.id}`} className="demo-guest-name">{guest.name}</a><div className="font-mono text-[11px] text-muted">{guest.id} · {guest.type === 'lxc' ? 'LXC' : 'VM'} · {guest.node}</div></div></div><Status status={guest.status} /><div className="demo-guest-usage"><span className="tnum text-[12px]">{guest.cpu}% CPU</span><Sparkline className="h-6 w-20" values={[guest.cpu, guest.cpu + 5, guest.cpu + 2, guest.cpu + 8, guest.cpu + 1, guest.cpu]} /></div><div className="tnum text-[12px] text-muted">{guest.used} / {guest.memory} GiB</div></div> }
function GuestInventory() {
  const [search, setSearch] = useState(''), [status, setStatus] = useState('all'), [type, setType] = useState('all')
  const visible = guests.filter(guest => `${guest.name} ${guest.id} ${guest.ip} ${guest.node}`.toLowerCase().includes(search.toLowerCase()) && (status === 'all' || guest.status === status) && (type === 'all' || guest.type === type))
  return <><Heading title="Guests" description="Find a familiar shape in the sample lab. Open a name to look closer." /><Card><CardContent><div className="demo-filters"><Field label="Search guests"><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, ID, node or IP" /></Field><Field label="Status"><Select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="running">Running</option><option value="stopped">Stopped</option></Select></Field><Field label="Guest type"><Select value={type} onChange={event => setType(event.target.value)}><option value="all">All types</option><option value="lxc">LXC containers</option><option value="qemu">Virtual machines</option></Select></Field><Button className="self-end" onClick={() => { setSearch(''); setStatus('all'); setType('all') }}>Reset filters</Button></div></CardContent><div className="border-t border-border-subtle px-4 py-2 text-[12px] text-muted" role="status">{visible.length} of {guests.length} sample guests</div>{visible.length ? visible.map(guest => <GuestRow key={guest.id} guest={guest} />) : <div className="demo-empty"><Server size={28} className="text-muted" /><h2>No sample guests match</h2><p>Try a broader search or reset the filters to see all four guests.</p></div>}</Card></>
}
function GuestWorkspace({ guest }: { guest: SampleGuest }) {
  return <><a href="#/guests" className="demo-back"><ArrowLeft size={14} />All guests</a><Heading title={guest.name} description={`Sample ${guest.type === 'lxc' ? 'LXC container' : 'virtual machine'} ${guest.id} · ${guest.node}`} /><div className="mb-5 flex flex-wrap items-center gap-3"><Status status={guest.status} /><Badge tone="brand">{guest.template}</Badge><span className="font-mono text-[12px] text-muted">{guest.ip}</span></div>
    <div className="demo-stats">{[{ label: 'CPU allocation', value: `${guest.cores} vCPU`, icon: Cpu }, { label: 'Memory allocation', value: `${guest.memory} GiB`, icon: MemoryStick }, { label: 'Disk allocation', value: `${guest.disk} GiB`, icon: HardDrive }].map(({ label, value, icon: Icon }) => <Card key={label}><CardContent><div className="flex items-center gap-2 text-[12px] text-muted"><Icon size={15} />{label}</div><div className="tnum mt-2 text-[24px] font-semibold">{value}</div></CardContent></Card>)}</div>
    {guest.status === 'running' ? <ResourceHistory metrics={metricsFor(guest)} loading={false} sourceLabel="Synthetic samples · fixed snapshot" /> : <Card><CardContent><h2>No running usage in this snapshot</h2><p className="mt-2 text-[13px] text-muted">This sample VM is stopped. Its allocation is retained; no usage is invented.</p></CardContent></Card>}
    <div className="demo-overview-columns mt-5"><Card><CardHeader><CardTitle>Guest notes</CardTitle><Badge>Read-only</Badge></CardHeader><CardContent><p className="text-[13px] leading-relaxed text-muted">{guest.notes}</p></CardContent></Card><Card><CardHeader><CardTitle>Sample configuration</CardTitle></CardHeader><CardContent><dl className="demo-details"><dt>Network</dt><dd>vmbr0 · documentation subnet</dd><dt>Storage</dt><dd>local-lvm</dd><dt>Uptime</dt><dd>{guest.uptime}</dd><dt>Hostname</dt><dd>{guest.name}.invalid</dd></dl></CardContent></Card></div>
  </>
}
function Templates() { return <><Heading title="Templates" description="See what goes into a useful starting point. These configurations stay on the page." /><div className="demo-template-grid">{templates.map(template => <Card key={template.id}><CardContent><TemplateTile icon={template.icon} /><h2 className="mb-1 mt-5 text-[16px]">{template.name}</h2><p className="mb-5 text-[13px] text-muted">{template.description}</p><div className="mb-5 flex flex-wrap gap-2"><Badge>{template.cores} vCPU</Badge><Badge>{template.memory} GiB RAM</Badge><Badge>{template.disk} GiB disk</Badge></div><a className="demo-text-link" href={`#/templates/${template.id}`} aria-label={`View ${template.name} configuration`}>View configuration <ArrowRight size={14} /></a></CardContent></Card>)}</div><p className="mt-5 text-[12px] text-muted">Provisioning belongs in your own lab. Install Proxmiu to use templates with your agent.</p></> }
function TemplateDetails({ template }: { template: typeof templates[number] }) { return <><a href="#/templates" className="demo-back"><ArrowLeft size={14} />All templates</a><Heading title={`${template.name} configuration`} description={template.description} /><Card><CardHeader><CardTitle>Read-only configuration</CardTitle><TemplateTile icon={template.icon} /></CardHeader><CardContent><dl className="demo-details"><dt>Base</dt><dd>{template.detail}</dd><dt>Resources</dt><dd>{template.cores} vCPU · {template.memory} GiB memory · {template.disk} GiB disk</dd><dt>Packages</dt><dd>{template.packages}</dd><dt>Options</dt><dd>{template.options}</dd></dl><p className="mt-6 rounded-md bg-inset p-3 text-[12px] leading-relaxed text-muted">This is an illustrative configuration, not an installation promise. No packages are downloaded and no guest is created here.</p></CardContent></Card></> }
function ActivityList() { return <><Heading title="Activity" description="Saved sample runs, including the ones that need a closer look." /><Card><CardHeader><CardTitle>Sample provisioning history</CardTitle><Badge>4 Nov 2026</Badge></CardHeader>{runs.map(run => <a key={run.id} href={`#/activity/${run.id}`} className="demo-run-row"><div><span className="font-medium">{run.guest}</span><p className="mt-1 text-[12px] text-muted">{run.description}</p></div><span className="text-[11px] text-muted">{run.date}</span><Status status={run.status} /><ArrowRight size={15} className="text-muted" /></a>)}</Card><p className="mt-4 text-[12px] text-muted">These are saved examples. Nothing is running, resuming or retrying in the background.</p></> }
function RunDetails({ run }: { run: typeof runs[number] }) {
  const [step, setStep] = useState(0)
  return <><a href="#/activity" className="demo-back"><ArrowLeft size={14} />All activity</a><Heading title={`${run.guest} · saved run`} description={`Synthetic history · 4 Nov 2026 · ${run.date}`} /><div className="mb-5"><Status status={run.status} /></div><Card><CardHeader><CardTitle>Saved steps</CardTitle><span className="text-[11px] text-muted">Sample log · plain text</span></CardHeader><CardContent><p className="mb-5 text-[13px] text-muted">{run.description} {run.status === 'Interrupted' && 'The final state is unknown. Inspect the retained guest before deciding what to do next.'}</p><div className="demo-step-layout"><div className="demo-steps" role="group" aria-label="Saved steps">{run.steps.map((label, index) => <button key={label} aria-label={`Inspect saved step: ${label}`} aria-pressed={step === index} onClick={() => setStep(index)} className={cn(step === index && 'selected')}><span className="tnum text-[11px] text-muted">{index + 1}</span>{label}</button>)}</div><div className="min-w-0"><h2 className="mb-3 text-[13px]">{run.steps[step]}</h2><pre className="demo-log" aria-live="polite">{run.logs[step]}</pre></div></div></CardContent></Card></>
}
function NotFound() { return <><Heading title="Sample not found" description="That link doesn't point to a guest, template or run in this small sample lab." /><Card><CardContent><p className="mb-4 text-[13px] text-muted">Your real environment is unaffected. Start again from the overview.</p><Button asChild><a href="#/">Return to Overview <ArrowRight /></a></Button></CardContent></Card></> }

createRoot(document.getElementById('root')!).render(<App />)

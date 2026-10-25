import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout, Logo } from '@/components/Layout'
import { getAgent, probeAgent, setAgent } from '@/lib/agent'
import { api } from '@/lib/api'
import { Activity } from '@/pages/Activity'
import { Connect } from '@/pages/Connect'
import { Connections } from '@/pages/Connections'
import { Create } from '@/pages/Create'
import { Guests } from '@/pages/Guests'
import { Overview } from '@/pages/Overview'
import { SettingsPage } from '@/pages/Settings'
import { Templates } from '@/pages/Templates'
import { TerminalPage } from '@/pages/TerminalPage'

type Session =
  | { state: 'no-agent' }
  | { state: 'unreachable'; url: string }
  | { state: 'login'; url: string }
  | { state: 'ready'; authRequired: boolean; hosted: boolean }

async function resolveSession(): Promise<Session> {
  let agent = getAgent()
  if (!agent) {
    // Served by the agent itself? Then it answers on the same origin.
    try {
      await probeAgent('')
      agent = { url: '' }
      setAgent(agent)
    } catch {
      return { state: 'no-agent' }
    }
  }
  try {
    await probeAgent(agent.url)
  } catch {
    return { state: 'unreachable', url: agent.url }
  }
  const status = await api.get<{ authRequired: boolean; authenticated: boolean }>('/auth/status')
  if (status.authRequired && !status.authenticated) return { state: 'login', url: agent.url }
  return { state: 'ready', authRequired: status.authRequired, hosted: agent.url !== '' }
}

export function App() {
  const qc = useQueryClient()
  const session = useQuery({ queryKey: ['session'], queryFn: resolveSession, staleTime: Infinity, retry: false })

  useEffect(() => {
    const onUnauthorized = () => qc.invalidateQueries({ queryKey: ['session'] })
    window.addEventListener('proxmiu:unauthorized', onUnauthorized)
    return () => window.removeEventListener('proxmiu:unauthorized', onUnauthorized)
  }, [qc])

  // Drop everything cached from the previous agent or login and resolve the session again.
  const reset = () => qc.resetQueries()

  const s = session.data
  if (!s) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse">
          <Logo />
        </div>
      </div>
    )
  }
  if (s.state !== 'ready') {
    const url = s.state === 'no-agent' ? '' : s.url
    return <Connect key={s.state} initialUrl={url} sameOrigin={s.state === 'login' && url === ''} onConnected={reset} />
  }

  const logout = () => {
    const agent = getAgent()
    setAgent(agent ? { url: agent.url } : null)
    reset()
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/terminal" element={<TerminalPage />} />
        <Route
          element={
            <Layout
              authRequired={s.authRequired}
              onLogout={logout}
              onDisconnect={
                s.hosted
                  ? () => {
                      setAgent(null)
                      reset()
                    }
                  : undefined
              }
            />
          }
        >
          <Route index element={<Overview />} />
          <Route path="guests" element={<Guests />} />
          <Route path="create" element={<Create />} />
          <Route path="create/:templateId" element={<Create />} />
          <Route path="templates" element={<Templates />} />
          <Route path="activity" element={<Activity />} />
          <Route path="activity/:jobId" element={<Activity />} />
          <Route path="connections" element={<Connections />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

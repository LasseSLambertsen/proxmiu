import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { App } from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--card-elevated)',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(18px)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            borderRadius: 12,
          },
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
)

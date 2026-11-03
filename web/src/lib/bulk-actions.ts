import type { Guest } from './api'
import { guestKey } from './guest-workspace'

export type BulkAction = 'start' | 'shutdown' | 'reboot'
export type BatchStatus = 'pending' | 'running' | 'sent' | 'error' | 'skipped'
export interface BatchResult { guest: Guest; status: BatchStatus; message?: string }

export async function runGuestBatch(
  guests: Guest[],
  action: BulkAction,
  execute: (guest: Guest, action: BulkAction) => Promise<unknown>,
  onProgress?: (results: BatchResult[]) => void,
  signal?: AbortSignal,
): Promise<BatchResult[]> {
  if (!['start', 'shutdown', 'reboot'].includes(action)) throw new Error('Unsupported bulk action')
  const targets = [...new Map(guests.map(guest => [guestKey(guest), guest])).values()]
  if (targets.length > 50) throw new Error('Select up to 50 guests per batch.')
  const results: BatchResult[] = targets.map(guest => ({ guest, status: (action === 'start' ? guest.status === 'stopped' : guest.status === 'running') ? 'pending' : 'skipped', message: (action === 'start' ? guest.status === 'stopped' : guest.status === 'running') ? undefined : `Not applicable while ${guest.status}` }))
  const publish = () => onProgress?.(results.map(result => ({ ...result })))
  let next = 0
  let unavailable = false
  publish()
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < results.length) {
      const result = results[next++]
      if (result.status !== 'pending') continue
      if (signal?.aborted || unavailable) {
        result.status = 'skipped'
        result.message = signal?.aborted ? 'Not sent: workspace closed' : 'Not sent: agent unavailable'
        publish()
        continue
      }
      result.status = 'running'
      publish()
      try {
        await execute(result.guest, action)
        result.status = 'sent'
        result.message = 'Request sent'
      } catch (error) {
        result.status = 'error'
        result.message = error instanceof Error ? error.message : 'Request failed'
        const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
        if (status === 401 || status === 0) unavailable = true
      }
      publish()
    }
  }))
  return results
}

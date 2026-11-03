import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultFilters, filterGuests, inventoryCsv, parseWorkspace } from '../src/lib/guest-inventory.ts'
import { runGuestBatch } from '../src/lib/bulk-actions.ts'
import type { Guest } from '../src/lib/api.ts'

const guests: Guest[] = [
  { id: 'lxc/100', clusterId: 'a', clusterName: 'Home', type: 'lxc', node: 'pve1', vmid: 100, name: 'web-2', status: 'running', cpu: .1, mem: 200, maxmem: 1000 },
  { id: 'qemu/101', clusterId: 'a', clusterName: 'Home', type: 'qemu', node: 'pve2', vmid: 101, name: 'web-10', status: 'stopped', cpu: 0, mem: 0, maxmem: 1000 },
  { id: 'lxc/102', clusterId: 'b', clusterName: 'Lab', type: 'lxc', node: 'pve1', vmid: 102, name: 'dns', status: 'running', cpu: .8, mem: 900, maxmem: 1000 },
]
const ips = { a: { 'lxc/100': '192.168.1.20' } }
const metadata = { 'a/lxc/100': { favorite: true, notes: '', updatedAt: '' } }

test('inventory combines independent filters, IP search and connection-scoped nodes', () => {
  assert.deepEqual(filterGuests(guests, { ...defaultFilters, query: '192.168.1.20', status: 'running', kind: 'lxc', node: 'a/pve1', pinnedOnly: true }, ips, metadata).map(g => g.vmid), [100])
  assert.equal(filterGuests(guests, { ...defaultFilters, node: 'a/pve1' }, ips, metadata).length, 1)
  assert.deepEqual(filterGuests(guests, { ...defaultFilters, sort: 'cpu' }, ips, metadata).map(g => g.vmid), [102, 100, 101])
  assert.deepEqual(filterGuests(guests, { ...defaultFilters, sort: 'name' }, ips, metadata).map(g => g.vmid), [102, 100, 101])
})

test('saved workspace recovers corrupt storage and validates every view', () => {
  assert.deepEqual(parseWorkspace('{broken'), { filters: defaultFilters, views: [] })
  assert.deepEqual(parseWorkspace(JSON.stringify({ version: 900, filters: { query: 'bad' } })), { filters: defaultFilters, views: [] })
  const parsed = parseWorkspace(JSON.stringify({ version: 1, filters: { sort: 'injected', status: 'running' }, views: [null, { id: 'one', name: ' Home ', filters: { kind: 'lxc' } }, { id: 'one', name: 'Duplicate' }] }))
  assert.equal(parsed.filters.sort, 'status')
  assert.equal(parsed.filters.status, 'running')
  assert.equal(parsed.views.length, 1)
  assert.equal(parsed.views[0].name, 'Home')
  assert.equal(parsed.views[0].filters.kind, 'lxc')
})

test('CSV neutralizes spreadsheet formulas, quotes text and preserves UTF-8 inventory data', () => {
  const csv = inventoryCsv([{ ...guests[0], name: ' =HYPERLINK("https://bad")' }], ips, metadata)
  assert.match(csv, /' =HYPERLINK/)
  assert.match(csv, /""https:\/\/bad""/)
  assert.match(csv, /192\.168\.1\.20/)
  assert.match(csv, /Pinned/)
  assert.ok(csv.startsWith('\uFEFF'))
})

test('bulk actions cap concurrency and retain failures without hiding successful requests', async () => {
  let active = 0, peak = 0
  const targets = [...guests, { ...guests[0], vmid: 103, id: 'lxc/103' }]
  const result = await runGuestBatch(targets, 'reboot', async guest => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--
    if (guest.vmid === 102) throw new Error('Host offline')
  })
  assert.equal(peak, 2)
  assert.equal(result.find(row => row.guest.vmid === 101)?.status, 'skipped')
  assert.equal(result.find(row => row.guest.vmid === 102)?.status, 'error')
  assert.equal(result.find(row => row.guest.vmid === 100)?.status, 'sent')
  assert.equal(result.find(row => row.guest.vmid === 103)?.status, 'sent')
})

test('bulk actions do not send queued requests after the workspace is abandoned', async () => {
  const controller = new AbortController()
  let sent = 0
  const targets = Array.from({ length: 5 }, (_, i) => ({ ...guests[0], vmid: i + 1, id: `lxc/${i + 1}` }))
  const result = await runGuestBatch(targets, 'shutdown', async () => { sent++; controller.abort() }, undefined, controller.signal)
  assert.ok(sent <= 2)
  assert.ok(result.some(row => row.status === 'skipped'))
})

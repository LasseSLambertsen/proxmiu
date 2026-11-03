import assert from 'node:assert/strict'
import { test } from 'node:test'
import { healthWarnings } from '../src/lib/health.ts'
import type { ClusterOverview } from '../src/lib/api.ts'

test('health warnings reflect unreachable connections and live resource pressure, not intentionally stopped guests', () => {
  const clusters: ClusterOverview[] = [
    { id: 'offline', name: 'Garage', host: 'host', ok: false, nodes: [], guests: [] },
    { id: 'home', name: 'Home', host: 'host', ok: true, nodes: [{ id: 'node/pve1', type: 'node', node: 'pve1', status: 'offline' }], guests: [
      { id: 'lxc/100', type: 'lxc', vmid: 100, name: 'database', node: 'pve1', status: 'running', cpu: .95, mem: 950, maxmem: 1000 },
      { id: 'qemu/101', type: 'qemu', vmid: 101, name: 'archive', node: 'pve1', status: 'stopped', cpu: 1, mem: 1, maxmem: 1 },
    ] },
  ]
  const warnings = healthWarnings(clusters)
  assert.equal(warnings.length, 4)
  assert.ok(warnings.some(item => item.title.includes('Garage')))
  assert.ok(warnings.some(item => item.title.includes('pve1')))
  assert.ok(warnings.some(item => item.title.includes('database') && item.description.includes('CPU')))
  assert.ok(warnings.some(item => item.title.includes('database') && item.description.includes('memory')))
  assert.ok(!warnings.some(item => item.title.includes('archive')))
})

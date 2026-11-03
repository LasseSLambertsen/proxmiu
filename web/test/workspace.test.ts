import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guestKey, guestHref, guestApiPath, metricValue } from '../src/lib/guest-workspace.ts'

const guest = { clusterId: 'cluster-one', node: 'pve1', type: 'lxc' as const, vmid: 110 }

test('guest identity survives node migration while routes address the current node', () => {
  assert.equal(guestKey(guest), guestKey({ ...guest, node: 'pve2' }))
  assert.equal(guestKey(guest), 'cluster-one/lxc/110')
  assert.equal(guestHref(guest), '/guests/cluster-one/pve1/lxc/110')
  assert.equal(guestApiPath(guest), '/clusters/cluster-one/guests/pve1/lxc/110')
  assert.equal(guestHref({ ...guest, clusterId: 'cluster/one' }), '/guests/cluster%2Fone/pve1/lxc/110')
})

test('history converts units and preserves unavailable samples rather than inventing zero usage', () => {
  assert.equal(metricValue({ time: 100, cpu: 0.25 }, 'cpu'), 25)
  assert.equal(metricValue({ time: 100, mem: 512, maxmem: 1024 }, 'memory'), 50)
  assert.equal(metricValue({ time: 100, netin: 1024, netout: 2048 }, 'network'), 3072)
  assert.equal(metricValue({ time: 100, diskread: 1, diskwrite: 2 }, 'disk'), 3)
  assert.equal(metricValue({ time: 100 }, 'cpu'), null)
  assert.equal(metricValue({ time: 100, mem: 100, maxmem: 0 }, 'memory'), null)
  assert.equal(metricValue({ time: 100, netin: 1024 }, 'network'), null)
  assert.equal(metricValue({ time: 100, cpu: Number.NaN }, 'cpu'), null)
})

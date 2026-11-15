import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BootDevice, BootOrderReview, Guest, GuestBootOrder } from '../src/lib/api.js'
import { bootChoiceInventory, bootReviewMatches, sameBootChoices, sameBootOrder } from '../src/lib/boot-order.js'

const disk: BootDevice = { id: 'scsi0', kind: 'disk', label: 'local-lvm:vm-100-disk-0', identity: 'a'.repeat(64) }
const nic: BootDevice = { id: 'net0', kind: 'network', label: 'virtio · 02:ab:cd:11:22:33 · vmbr0', identity: 'b'.repeat(64) }
const inactive: BootDevice = { id: 'scsi1', kind: 'disk', label: 'local-lvm:vm-100-disk-1', identity: 'c'.repeat(64) }
const guest: Guest = { id: 'qemu/100', clusterId: 'one', clusterName: 'Fixture', node: 'pve1', vmid: 100, type: 'qemu', name: 'bootbox', status: 'stopped' }
const legacy = (): GuestBootOrder => ({ name: 'bootbox', ready: true, errors: [], sourceIdentity: 'source', order: [disk, nic], excluded: [] })
const modern = (): GuestBootOrder => ({ ...legacy(), eligibleDevices: [disk, nic, inactive] })
function review(initial = modern(), proposed = [inactive, nic]): BootOrderReview {
  return { reviewId: 'review-1', name: 'bootbox', node: 'pve1', type: 'qemu', vmid: 100, sourceIdentity: 'source', currentOrder: initial.order, proposedOrder: proposed, expiresAt: Date.now() + 300000, ...(Object.hasOwn(initial, 'eligibleDevices') ? { eligibleDevices: initial.eligibleDevices } : {}) }
}

test('absent capability retains old-agent order-only choices and its original two-device floor', () => {
  const view = legacy(), choices = bootChoiceInventory(view)
  assert.equal(choices.mode, 'legacy'); assert.deepEqual(choices.devices.map(d => d.id), ['scsi0', 'net0'])
  assert.equal(bootChoiceInventory({ ...view, order: [disk] }).mode, 'invalid')
  assert.equal(bootReviewMatches(review(view, [nic, disk]), view, [nic, disk], guest), true)
  assert.equal(bootReviewMatches(review(view, [inactive]), view, [inactive], guest), false)
})

test('modern singleton inventory can choose from complete supported candidates', () => {
  const view = { ...modern(), order: [disk] }
  const choices = bootChoiceInventory(view)
  assert.equal(choices.mode, 'eligible'); assert.equal(choices.devices.length, 3)
  assert.equal(bootReviewMatches(review(view, [inactive]), view, [inactive], guest), true)
  assert.equal(bootReviewMatches(review(view, []), view, [], guest), false)
})

test('supplied malformed or inconsistent candidate capability never falls back to an older agent', () => {
  const invalid: unknown[] = [null, undefined, 'invalid', [], [disk, disk, nic], [nic, inactive], [{ ...disk, identity: 'replaced' }, nic], [disk, nic, { ...inactive, kind: 'unsupported' }], [disk, nic, { ...inactive, id: 'scsi31' }], [disk, nic, { ...inactive, id: 'usb0' }], [disk, nic, { ...inactive, label: null }], [disk, nic, { ...inactive, identity: '' }], [disk, { ...nic, kind: 'disk' }]]
  for (const eligibleDevices of invalid) {
    const result = bootChoiceInventory({ ...modern(), eligibleDevices } as GuestBootOrder)
    assert.equal(result.mode, 'invalid'); assert.deepEqual(result.devices, [])
  }
})

test('whole candidate identities compare independently of their presentation order', () => {
  const a = modern(), b = { ...modern(), eligibleDevices: [inactive, nic, disk] }
  assert.equal(sameBootChoices(a, b), true)
  assert.equal(bootReviewMatches({ ...review(a), eligibleDevices: b.eligibleDevices }, a, [inactive, nic], guest), true)
  assert.equal(sameBootOrder([nic, disk], [disk, nic]), false)
  assert.equal(sameBootOrder([disk, disk], [disk, disk]), false)
})

test('an unchanged enabled order cannot hide replacement of an inactive candidate or warning', () => {
  const a = modern()
  for (const candidate of [{ ...inactive, identity: 'replaced' }, { ...inactive, label: 'other-volume' }, { ...inactive, warning: 'New prerequisite' }]) {
    const b = { ...modern(), eligibleDevices: [disk, nic, candidate] }
    assert.equal(sameBootChoices(a, b), false)
    assert.equal(bootReviewMatches({ ...review(a, [nic, disk]), eligibleDevices: b.eligibleDevices }, a, [nic, disk], guest), false)
  }
})

test('capability changes across refresh or review require a fresh selection', () => {
  const old = legacy(), current = modern()
  assert.equal(sameBootChoices(old, current), false); assert.equal(sameBootChoices(current, old), false)
  assert.equal(bootReviewMatches(review(old, [nic, disk]), current, [nic, disk], guest), false)
  assert.equal(bootReviewMatches(review(current, [nic, disk]), old, [nic, disk], guest), false)
  assert.equal(sameBootChoices({ ...current, eligibleDevices: null } as unknown as GuestBootOrder, current), false)
})

test('review scope, both sequences and every proposed identity stay fixed before confirmation', () => {
  const initial = modern(), proposed = [inactive, nic], valid = review(initial, proposed)
  for (const change of [{ name: 'other' }, { node: 'pve2' }, { type: 'lxc' }, { vmid: 101 }, { sourceIdentity: 'changed' }, { currentOrder: [nic, disk] }, { proposedOrder: [nic, inactive] }, { proposedOrder: [{ ...inactive, identity: 'replaced' }, nic] }, { eligibleDevices: [disk, nic] }, { reviewId: '' }, { expiresAt: Number.NaN }]) {
    assert.equal(bootReviewMatches({ ...valid, ...change } as BootOrderReview, initial, proposed, guest), false)
  }
  assert.equal(bootReviewMatches(valid, initial, proposed, guest), true)
})

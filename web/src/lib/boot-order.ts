import type { BootDevice, BootOrderReview, Guest, GuestBootOrder } from './api'

type Choices = { mode: 'eligible' | 'legacy' | 'invalid'; devices: BootDevice[]; reason?: string }
const limits: Record<string, number> = { ide: 3, sata: 5, scsi: 30, virtio: 15, net: 31 }
function device(value: unknown): value is BootDevice {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  const slot = typeof row.id === 'string' ? /^(ide|sata|scsi|virtio|net)(0|[1-9]\d*)$/.exec(row.id) : null
  return !!slot && Number(slot[2]) <= limits[slot[1]] && (slot[1] === 'net' ? row.kind === 'network' : row.kind === 'disk' || row.kind === 'cdrom')
    && typeof row.identity === 'string' && row.identity.length > 0 && row.identity.length <= 256
    && typeof row.label === 'string' && row.label.length > 0 && row.label.length <= 8192
    && (row.warning === undefined || typeof row.warning === 'string' && row.warning.length <= 4096)
}
function list(value: unknown, minimum = 1): value is BootDevice[] {
  return Array.isArray(value) && value.length >= minimum && value.length <= 89 && value.every(device) && new Set(value.map(d => d.id)).size === value.length
}
const equal = (a: BootDevice, b: BootDevice) => a.id === b.id && a.kind === b.kind && a.identity === b.identity && a.label === b.label && a.warning === b.warning
export function sameBootOrder(actual: unknown, expected: BootDevice[]): boolean {
  return list(actual) && list(expected) && actual.length === expected.length && actual.every((row, i) => equal(row, expected[i]))
}
export function bootChoiceInventory(inventory: GuestBootOrder): Choices {
  const invalid: Choices = { mode: 'invalid', devices: [], reason: 'Boot-device choices could not be verified. Inspect again before editing.' }
  if (!inventory || typeof inventory !== 'object') return invalid
  const modern = Object.hasOwn(inventory, 'eligibleDevices')
  if (!list(inventory.order, modern ? 1 : 2)) return invalid
  if (!modern) return { mode: 'legacy', devices: [...inventory.order] }
  if (!list(inventory.eligibleDevices) || inventory.order.some(row => !inventory.eligibleDevices!.some(candidate => equal(row, candidate)))) return invalid
  return { mode: 'eligible', devices: [...inventory.eligibleDevices].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })) }
}
export function sameBootChoices(a: GuestBootOrder, b: GuestBootOrder): boolean {
  const left = bootChoiceInventory(a), right = bootChoiceInventory(b)
  return left.mode !== 'invalid' && left.mode === right.mode && left.devices.length === right.devices.length && left.devices.every(row => right.devices.some(candidate => equal(row, candidate)))
}
export function bootReviewMatches(value: BootOrderReview, initial: GuestBootOrder, proposed: BootDevice[], guest: Guest): boolean {
  const choices = bootChoiceInventory(initial)
  if (!value || typeof value !== 'object' || choices.mode === 'invalid' || !list(proposed) || guest.type !== 'qemu') return false
  if (proposed.some(row => !choices.devices.some(candidate => equal(row, candidate))) || choices.mode === 'legacy' && proposed.length !== initial.order.length) return false
  const reviewed = { ...initial, order: value.currentOrder }
  // A missing capability is different from a supplied malformed one.
  if (Object.hasOwn(value, 'eligibleDevices')) reviewed.eligibleDevices = value.eligibleDevices
  else delete reviewed.eligibleDevices
  return value.sourceIdentity === initial.sourceIdentity && value.name === initial.name && value.node === guest.node && value.type === 'qemu' && value.vmid === guest.vmid
    && typeof value.reviewId === 'string' && value.reviewId.length > 0 && Number.isFinite(value.expiresAt)
    && sameBootOrder(value.currentOrder, initial.order) && sameBootOrder(value.proposedOrder, proposed) && sameBootChoices(initial, reviewed)
}

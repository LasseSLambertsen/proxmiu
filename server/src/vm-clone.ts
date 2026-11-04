import { ProxmoxClient, type ClusterResource } from './proxmox.js'

export type VmConfig = Record<string, string | number | undefined>
const diskKey = /^(?:scsi|virtio|sata|ide)\d+$/
const cloudInit = (value: string) => /(?:^|[:/])(?:vm-\d+-)?cloudinit(?:$|[.-])/.test(value.split(',')[0])
const dataDisk = (value: unknown): value is string => typeof value === 'string' && !!value && !/(?:^|,)media=cdrom(?:,|$)/.test(value) && !cloudInit(value)

export function bootDisk(config: VmConfig): string {
  const order = /(?:^|,)order=([^,]+)/.exec(String(config.boot ?? ''))?.[1].split(';') ?? []
  for (const key of order) {
    if (!diskKey.test(key)) continue
    if (!config[key]) throw new Error(`Selected boot disk ${key} is missing from the VM config`)
    if (dataDisk(config[key])) return key
  }
  if (config.bootdisk) {
    const key = String(config.bootdisk)
    if (!diskKey.test(key) || !dataDisk(config[key])) throw new Error(`Selected boot disk ${key} is missing or is not a data disk`)
    return key
  }
  const candidates = Object.keys(config).filter(key => diskKey.test(key) && dataDisk(config[key]))
  if (candidates.length !== 1) throw new Error(candidates.length ? 'Boot disk is ambiguous. Set an explicit boot order or bootdisk on the template.' : 'No boot disk found on the VM template')
  return candidates[0]
}

export function diskGiB(config: VmConfig, disk: string): number {
  if (!dataDisk(config[disk])) throw new Error(`Boot disk ${disk} is missing or is not a data disk`)
  const size = /(?:^|,)size=([^,]+)/.exec(String(config[disk]))?.[1]
  const match = size && /^(\d+(?:\.\d+)?)([KMGTPE]?)(?:i?B)?$/i.exec(size)
  const gib = match ? Number(match[1]) * 1024 ** (match[2] ? 'KMGTPE'.indexOf(match[2].toUpperCase()) + 1 : 0) / 1024 ** 3 : NaN
  if (!Number.isFinite(gib) || gib <= 0) throw new Error(`Cannot determine the size of boot disk ${disk}. Check the template disk config before cloning.`)
  return gib
}

export async function preflightClone(client: ProxmoxClient, node: string, sourceVmid: number) {
  const resources = await client.get<ClusterResource[]>('/cluster/resources', { type: 'vm' })
  const source = resources.find(resource => resource.vmid === sourceVmid)
  if (!source) throw new Error(`VM template ${sourceVmid} not found. Refresh the source template selection.`)
  if (source.type !== 'qemu') throw new Error(`Source ${sourceVmid} must be a QEMU VM template`)
  if (source.node !== node) throw new Error(`Source template ${sourceVmid} is on ${source.node ?? 'an unknown node'}, not selected node ${node}. Refresh and select its node before cloning.`)
  if (source.template !== 1) throw new Error(`Source VM ${sourceVmid} is not a template. Convert it to a cloud-init template before cloning.`)
  const config = await client.get<VmConfig>(`/nodes/${node}/qemu/${sourceVmid}/config`)
  if (Number(config.template) !== 1) throw new Error(`Source VM ${sourceVmid} is no longer a template. Refresh the source selection.`)
  if (!Object.entries(config).some(([key, value]) => diskKey.test(key) && typeof value === 'string' && cloudInit(value))) throw new Error(`Source VM template ${sourceVmid} has no cloud-init drive. Add one before cloning.`)
  const disk = bootDisk(config)
  diskGiB(config, disk)
  return disk
}

/** Preserve the clone's model, MAC and unrelated NIC settings; replace its VLAN settings. */
export function cloneNetwork(net0: string | undefined, bridge: string, vlan?: number): string {
  const parts = (net0 || 'virtio').split(',').filter(part => !/^(?:bridge|tag|trunks)=/.test(part))
  return [...parts, `bridge=${bridge}`, ...(vlan ? [`tag=${vlan}`] : [])].join(',')
}

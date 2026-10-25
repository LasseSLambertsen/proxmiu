import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import selfsigned from 'selfsigned'
import { DATA_DIR } from './store.js'

/**
 * HTTPS settings for the agent. A hosted UI (served over https) can only call the agent over https,
 * unless the agent is on localhost. Uses PROXMIU_TLS_CERT/KEY if given, otherwise a self-signed
 * certificate for every local address, generated once and kept in the data dir.
 */
export async function tlsOptions(): Promise<{ key: string; cert: string } | undefined> {
  const { PROXMIU_TLS, PROXMIU_TLS_CERT, PROXMIU_TLS_KEY } = process.env
  if (PROXMIU_TLS_CERT && PROXMIU_TLS_KEY) return { cert: readFileSync(PROXMIU_TLS_CERT, 'utf8'), key: readFileSync(PROXMIU_TLS_KEY, 'utf8') }
  if (PROXMIU_TLS !== '1') return undefined

  const certFile = join(DATA_DIR, 'tls.crt')
  const keyFile = join(DATA_DIR, 'tls.key')
  if (existsSync(certFile) && existsSync(keyFile)) return { cert: readFileSync(certFile, 'utf8'), key: readFileSync(keyFile, 'utf8') }

  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && !a.address.startsWith('fe80'))
    .map((a) => a!.address)
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'proxmiu-agent' }], {
    keyType: 'ec',
    algorithm: 'sha256',
    notAfterDate: new Date(Date.now() + 5 * 365 * 86400_000),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2 as const, value: 'localhost' }, ...ips.map((ip) => ({ type: 7 as const, ip }))] },
    ],
  })
  writeFileSync(certFile, pems.cert)
  writeFileSync(keyFile, pems.private, { mode: 0o600 })
  return { cert: pems.cert, key: pems.private }
}

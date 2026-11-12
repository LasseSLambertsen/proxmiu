import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RfbAuthBridge, vncResponse } from '../src/rfb-auth.js'

const version = Buffer.from('RFB 003.008\n')
const challenge = Buffer.from(Array.from({ length: 16 }, (_, i) => i))
// Independently generated with noVNC1.7's pure-JS DESECBCipher, not Node/OpenSSL.
const response = Buffer.from('b866924125c8eebb9debc1db61c538e2', 'hex')
function fixture() {
  const up: Buffer[] = [], down: Buffer[] = []
  let ready = 0
  const bridge = new RfbAuthBridge('password', { toUpstream: b => up.push(Buffer.from(b)), toBrowser: b => down.push(Buffer.from(b)), ready: () => ready++ })
  return { bridge, up, down, get ready() { return ready } }
}
function handshake(f: ReturnType<typeof fixture>, fragment = (b: Buffer) => [b]) {
  for (const part of fragment(version)) f.bridge.upstream(part)
  for (const part of fragment(Buffer.from([2, 1, 2]))) f.bridge.upstream(part)
  for (const part of fragment(challenge)) f.bridge.upstream(part)
  for (const part of fragment(Buffer.alloc(4))) f.bridge.upstream(part)
  for (const part of fragment(version)) f.bridge.browser(part)
  f.bridge.browser(Buffer.from([1]))
  f.bridge.browser(Buffer.from([1]))
}

test('VNC challenge response matches independent DES implementation and validates input sizes', () => {
  assert.deepEqual(vncResponse('password', challenge), response)
  for (const password of ['', 'short', '123456789', '1234567\n', '1234567é']) assert.throws(() => vncResponse(password, challenge))
  for (const length of [0, 15, 17, 4096]) assert.throws(() => vncResponse('password', Buffer.alloc(length)))
})

test('upstream authenticates before browser ready, with no credential in the frontend handshake', () => {
  const f = fixture()
  assert.equal(f.ready, 0)
  f.bridge.upstream(version)
  assert.deepEqual(f.up, [version]); assert.deepEqual(f.down, [])
  f.bridge.upstream(Buffer.from([2, 1, 2]))
  assert.deepEqual(f.up[1], Buffer.from([2]))
  f.bridge.upstream(challenge)
  assert.deepEqual(f.up[2], response)
  assert.equal(f.ready, 0)
  f.bridge.upstream(Buffer.alloc(4))
  assert.equal(f.ready, 1)
  assert.deepEqual(f.down, [version])
  f.bridge.browser(version)
  assert.deepEqual(f.down[1], Buffer.from([1, 1]))
  f.bridge.browser(Buffer.from([1]))
  assert.deepEqual(f.down[2], Buffer.alloc(4))
  f.bridge.browser(Buffer.from([1]))
  assert.deepEqual(f.up[3], Buffer.from([1]))
  assert.doesNotMatch(Buffer.concat(f.down).toString(), /password|ticket|b8669241/)
})

test('every handshake byte can fragment without losing arbitrary binary payloads', () => {
  const f = fixture()
  handshake(f, b => [...b].map(n => Buffer.from([n])))
  const pixels = Buffer.from([0, 255, 128, 0, 13, 10, 254, 1])
  const keys = Buffer.from([4, 1, 0, 0, 0, 0, 255, 200])
  f.bridge.upstream(pixels); f.bridge.browser(keys)
  assert.deepEqual(f.down.at(-1), pixels)
  assert.deepEqual(f.up.at(-1), keys)
  assert.equal(f.ready, 1)
})

test('coalesced frontend negotiation and subsequent data retain exact unused bytes', () => {
  const f = fixture()
  f.bridge.upstream(Buffer.concat([version, Buffer.from([1, 2]), challenge, Buffer.alloc(4)]))
  const afterInit = Buffer.from([2, 0, 0, 0, 255, 0])
  f.bridge.browser(Buffer.concat([version, Buffer.from([1, 1]), afterInit]))
  assert.deepEqual(Buffer.concat(f.up), Buffer.concat([version, Buffer.from([2]), response, Buffer.from([1]), afterInit]))
  assert.deepEqual(Buffer.concat(f.down), Buffer.concat([version, Buffer.from([1, 1]), Buffer.alloc(4)]))
})

test('unsupported versions, security modes and failed authentication never make browser ready', () => {
  const cases = [Buffer.from('RFB 003.003\n'), Buffer.from('HTTP/1.1 200'), Buffer.concat([version, Buffer.from([1, 1])]), Buffer.concat([version, Buffer.from([0])]), Buffer.concat([version, Buffer.from([33])]), Buffer.concat([version, Buffer.from([1, 2]), challenge, Buffer.from([0, 0, 0, 1])])]
  for (const bytes of cases) {
    const f = fixture()
    assert.throws(() => f.bridge.upstream(bytes))
    assert.equal(f.ready, 0)
    assert.deepEqual(f.down, [])
  }
})

test('invalid frontend ordering/version/security/client-init and handshake flooding fail closed', () => {
  const early = fixture()
  assert.throws(() => early.bridge.browser(Buffer.from([1])))
  for (const frame of [Buffer.from('RFB 003.007\n'), Buffer.concat([version, Buffer.from([2])]), Buffer.concat([version, Buffer.from([1, 3])]), Buffer.alloc(4097)]) {
    const f = fixture()
    f.bridge.upstream(Buffer.concat([version, Buffer.from([1, 2]), challenge, Buffer.alloc(4)]))
    assert.throws(() => f.bridge.browser(frame))
    assert.equal(f.up.length, 3)
  }
  const flooded = fixture()
  assert.throws(() => flooded.bridge.upstream(Buffer.alloc(4097)))
  assert.equal(flooded.ready, 0)
})

test('server data before ClientInit is rejected; disposal prevents later sends', () => {
  const f = fixture()
  f.bridge.upstream(Buffer.concat([version, Buffer.from([1, 2]), challenge, Buffer.alloc(4)]))
  assert.throws(() => f.bridge.upstream(Buffer.from([1])))
  f.bridge.dispose()
  f.bridge.upstream(Buffer.alloc(10)); f.bridge.browser(version)
  assert.equal(f.ready, 1)
  assert.equal(f.up.length, 3)
  assert.equal(f.down.length, 1)
})

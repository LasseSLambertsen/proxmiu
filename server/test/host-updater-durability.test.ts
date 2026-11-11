import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('failure to flush an updater reservation prevents remote admission', () => {
  const directory = mkdtempSync(join(tmpdir(), 'proxmiu-updater-durability-'))
  try {
    const source = `
      import assert from 'node:assert/strict'
      import fs from 'node:fs'
      import { syncBuiltinESMExports } from 'node:module'
      let writes = 0, fail = false
      const original = fs.fsyncSync
      fs.fsyncSync = function(fd) { writes++; if (fail) throw new Error('fixture flush failure'); return original(fd) }
      syncBuiltinESMExports()
      const { store, encrypt, decrypt } = await import('./server/src/store.ts')
      const { createHostUpdates } = await import('./server/src/host-updates.ts')
      store.saveHostUpdaterState({targets:{'cluster/pve':{clusterId:'cluster',node:'pve',publicKey:'public',privateKey:encrypt('private-fixture'),revision:'revision',keyRevision:'key',configuration:{host:'127.0.0.1',port:22,fingerprint:'SHA256:fixture',machineIdHash:'a'.repeat(64)}}}})
      const calls = []
      const service = createHostUpdates({load:store.hostUpdaterState,save:store.saveHostUpdaterState,encrypt,decrypt,online:async()=>{},invoke:async(_,request)=>{calls.push(request.action); if(request.action==='inspect') return {proxmoxVersion:'8.2.7',proxmoxMajor:8,codename:'bookworm',machineIdHash:'a'.repeat(64),ready:true,rebootSuggested:false}; return {id:'b'.repeat(32),phase:'check',state:'running',startedAt:new Date().toISOString(),log:[]}}})
      fail = true
      await assert.rejects(service.check('cluster','pve'), /save|storage/)
      assert.equal(calls.includes('check'), false)
      assert.ok(writes > 0)
    `
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { env: { ...process.env, PROXMIU_DATA_DIR: directory }, encoding: 'utf8', timeout: 15000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

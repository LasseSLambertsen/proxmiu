// A separate process exercises the production journal/codec with the agent's own key.
import { JobHistory, jobSecrets, type Job } from '../../src/job-history.js'
import { DATA_DIR, store } from '../../src/store.js'
const cluster = store.addCluster({ name: 'Synthetic history source', host: '127.0.0.1', port: Number(process.env.FIXTURE_PORT), authType: 'token', username: 'root@pam!fixture', secret: 'fixture-credential', verifyTls: false })
const history = new JobHistory(DATA_DIR)
const base: Job = {
  id: 'retained-complete', title: 'Plain server → history-lab', templateId: 'plain', kind: 'provision', clusterId: cluster.id,
  status: 'success', createdAt: '2026-11-04T00:00:00.000Z', finishedAt: '2026-11-04T00:01:00.000Z',
  steps: [{ id: 'create', label: 'Create', status: 'done' }], log: ['Password xy; token default-secret; long-option-token'],
  result: { vmid: 123, node: 'pve1', type: 'lxc', hostname: 'history-lab', ip: '192.0.2.4', user: 'root', notes: 'Saved xy / default-secret / long-option-token' },
  target: { vmid: 123, node: 'pve1', type: 'lxc', hostname: 'history-lab' },
}
const secrets = jobSecrets({ password: 'xy', options: { OTHER: 'long-option-token' } }, { options: [{ key: 'TOKEN', type: 'secret', default: 'default-secret' }] })
history.register(base, secrets)
history.register({ ...base, id: 'retained-update', kind: 'update', title: 'Update plain server', status: 'error', result: undefined, error: 'Failed xy / default-secret', steps: [{ id: 'update', label: 'Update', status: 'error' }] }, secrets)
history.register({ ...base, id: 'was-running', status: 'running', finishedAt: undefined, result: undefined, steps: [{ id: 'create', label: 'Create', status: 'done' }, { id: 'install', label: 'Install', status: 'running' }, { id: 'extra', label: 'Extras', status: 'pending' }] }, secrets)
console.log(JSON.stringify({ clusterId: cluster.id }))

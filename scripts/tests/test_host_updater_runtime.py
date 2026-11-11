import importlib.util
import pathlib
import tempfile
import unittest
import os
import json
from types import SimpleNamespace
from unittest.mock import patch


def load():
    path = pathlib.Path(__file__).resolve().parents[1] / 'host-updater.py'
    spec = importlib.util.spec_from_file_location('host_updater_runtime', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeEngine:
    class UpdaterError(Exception):
        def __init__(self, code='stale_plan', message='Check updates again.'):
            self.code, self.message = code, message

    def __init__(self):
        self.applied = []
        self.stale = False
        self.verified = True
        self.packages = [{'name': 'docs', 'architecture': 'all', 'installed': '1', 'candidate': '2'}]

    def inspect_host(self, ctx):
        return dict(proxmoxVersion='8.2.7', proxmoxMajor=8, codename='bookworm', machineIdHash='a' * 64, ready=True, rebootSuggested=False)

    def build_plan(self, ctx, plan_id, clock, boot):
        return {'plan': {'id': plan_id, 'digest': 'b' * 64, 'expiresAt': '2099-01-01T00:00:00Z',
                         'proxmoxMajor': 8, 'codename': 'bookworm', 'packages': self.packages, 'kernelChange': False}}

    def validate_plan(self, ctx, record, clock, boot):
        if self.stale:
            raise self.UpdaterError()

    def apply_plan(self, ctx, record, job_id, clock, boot):
        self.validate_plan(ctx, record, clock, boot)
        self.applied.append(job_id)

    def verify_installed(self, ctx, record):
        if not self.verified:
            raise self.UpdaterError('verification_failed', 'Versions were not verified.')


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.mod = load()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.engine = FakeEngine()
        self.launched = []
        self.units = {}
        self.boot = 'boot'
        self.now = 100
        self.fail_launch = False
        self.runtime = self.mod.Runtime(
            engine=self.engine, ctx=object(), directory=pathlib.Path(self.temp.name), node='proxmox',
            boot=lambda: self.boot, clock=lambda: self.now, owner=os.getuid(),
            launch=self.launch, unit_active=lambda unit: self.units.get(unit, False))

    def launch(self, job_id):
        if self.fail_launch:
            raise OSError('do not expose private service error')
        self.launched.append(job_id)
        self.units['proxmiu-host-update-' + job_id + '.service'] = True

    def check(self):
        job = self.runtime.handle({'action': 'check'})
        self.runtime.worker(job['id'])
        return self.runtime.handle({'action': 'status', 'jobId': job['id']})

    def test_strict_requests_and_duplicate_json(self):
        for data in [b'{"action":"inspect","action":"check"}', b'[]', b'{}{}', b' ' * 65537,
                     b'{"action":"inspect","extra":true}', b'{"action":"status","jobId":"../x"}']:
            with self.subTest(data=data[:80]), self.assertRaises(self.mod.RpcError):
                self.runtime.handle(self.mod.parse_request(data))
        self.assertTrue(self.runtime.handle({'action': 'inspect'})['ready'])
        self.assertEqual(self.launched, [])

    def test_durable_check_review_apply_success_and_no_replay(self):
        review = self.check()
        self.assertEqual(review['state'], 'review')
        self.assertNotIn('planRecord', review)
        request = {'action': 'apply', 'planId': review['plan']['id'], 'digest': review['plan']['digest']}
        applied = self.runtime.handle(request)
        self.assertEqual(applied['state'], 'running')
        with self.assertRaises(self.mod.RpcError):
            self.runtime.handle(request)
        self.runtime.worker(applied['id'])
        final = self.runtime.handle({'action': 'status', 'jobId': applied['id']})
        self.assertEqual(final['state'], 'success')
        with self.assertRaises(self.mod.RpcError):
            self.runtime.handle(request)
        self.assertEqual(self.engine.applied, [applied['id']])

    def test_admission_handoff_and_status_remain_responsive(self):
        job = self.runtime.handle({'action': 'check'})
        with self.assertRaises(self.mod.RpcError):
            self.runtime.handle({'action': 'check'})
        self.assertEqual(self.runtime.handle({'action': 'status', 'jobId': job['id']})['state'], 'running')
        # Status never waits on the operation lock held by the worker/APT.
        with self.runtime.operation():
            self.now += 20
            self.units.clear()
            self.assertEqual(self.runtime.handle({'action': 'status', 'jobId': job['id']})['state'], 'running')

    def test_unavailable_systemd_observation_retains_reservation(self):
        job = self.runtime.handle({'action': 'check'})
        self.now += 20
        self.runtime.unit_active = lambda _: None
        self.assertEqual(self.runtime.handle({'action': 'status', 'jobId': job['id']})['state'], 'running')
        with self.assertRaises(self.mod.RpcError):
            self.runtime.handle({'action': 'check'})

    def test_deactivating_service_retains_ownership_until_children_stop(self):
        # The main worker's flock can disappear before systemd finishes stopping
        # its APT children. Deactivating is still a live operation.
        with patch.object(self.mod.subprocess, 'run', return_value=SimpleNamespace(stdout='deactivating\n')):
            self.assertIs(self.mod.Runtime.systemd_active('fixture.service'), True)
        job = self.runtime.handle({'action': 'check'})
        self.now += 20
        self.runtime.unit_active = lambda _: True
        self.assertEqual(self.runtime.handle({'action': 'status', 'jobId': job['id']})['state'], 'running')

    def test_reboot_or_lost_unit_is_interrupted_never_success(self):
        for reboot in [False, True]:
            job = self.runtime.handle({'action': 'check'})
            self.now += 20
            if reboot:
                self.boot = 'other-boot'
            else:
                self.units.clear()
            final = self.runtime.handle({'action': 'status', 'jobId': job['id']})
            self.assertEqual(final['state'], 'interrupted')

    def test_launch_failure_consumes_plan_and_never_replays(self):
        review = self.check()
        self.fail_launch = True
        request = {'action': 'apply', 'planId': review['plan']['id'], 'digest': review['plan']['digest']}
        job = self.runtime.handle(request)
        self.assertEqual(job['state'], 'failed')
        self.assertNotIn('private', json.dumps(job))
        with self.assertRaises(self.mod.RpcError):
            self.runtime.handle(request)
        self.assertEqual(self.engine.applied, [])

    def test_stale_plan_and_failed_postverification_never_success(self):
        review = self.check()
        request = {'action': 'apply', 'planId': review['plan']['id'], 'digest': review['plan']['digest']}
        self.engine.stale = True
        with self.assertRaises(self.mod.RpcError):
            self.runtime.handle(request)
        self.engine.stale = False
        job = self.runtime.handle(request)
        self.engine.verified = False
        self.runtime.worker(job['id'])
        self.assertEqual(self.runtime.handle({'action': 'status', 'jobId': job['id']})['state'], 'failed')

    def test_persistence_failure_does_not_launch_work(self):
        original = self.runtime.save
        self.runtime.save = lambda state: (_ for _ in ()).throw(OSError('disk full'))
        with self.assertRaises(OSError):
            self.runtime.handle({'action': 'check'})
        self.assertEqual(self.launched, [])
        self.runtime.save = original

    def test_launch_exception_after_worker_owns_lock_does_not_terminalize(self):
        held = self.runtime.operation()
        def launch(_):
            held.__enter__()
            raise OSError('reply lost after execution started')
        self.runtime.launch = launch
        try:
            job = self.runtime.handle({'action': 'check'})
            self.assertEqual(job['state'], 'running')
            self.assertEqual(self.runtime.read()['active'], job['id'])
        finally:
            held.__exit__(None, None, None)

    def test_storage_read_failure_after_launch_is_an_ambiguous_result(self):
        read = self.runtime.read
        def read_after_launch():
            if self.launched:
                raise self.mod.RpcError('unsafe_state', 'Saved state could not be read.')
            return read()
        self.runtime.read = read_after_launch
        with self.assertRaises(self.mod.RpcError):
            self.runtime.handle({'action': 'check'})
        self.assertEqual(read()['active'], self.launched[0])

    def test_public_event_limits_and_job_retention(self):
        for _ in range(23):
            job = self.check()
        self.assertLessEqual(len(self.runtime.read()['jobs']), 20)
        for _ in range(510):
            self.runtime.event(job['id'], 'x' * 3000)
        final = self.runtime.handle({'action': 'status', 'jobId': job['id']})
        self.assertTrue(final['logTruncated'])
        self.assertLessEqual(len(final['log']), 500)
        self.assertLessEqual(sum(len(s.encode()) for s in final['log']), 128 * 1024)
        self.assertLessEqual(len(json.dumps(final).encode()), 256 * 1024)


if __name__ == '__main__':
    unittest.main()

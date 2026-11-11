#!/usr/bin/python3
"""Node-bound, forced-command host updater; no shell or caller configuration."""
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import secrets
import select
import socket
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone

BASE = pathlib.Path('/var/lib/proxmiu-host-updater')
HELPER = '/usr/local/lib/proxmiu/host-updater'
ENGINE = '/usr/local/lib/proxmiu/host-updater-apt.py'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'LANG': 'C', 'HOME': '/root'}
ID = re.compile(r'[a-f0-9]{32}\Z')
NODE = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9.-]{0,62}\Z')
TERMINAL = {'review', 'success', 'failed', 'interrupted'}


class RpcError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def reject(code='invalid_request', message='The updater request is invalid.'):
    raise RpcError(code, message)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def parse_request(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                reject()
            result[key] = value
        return result
    try:
        if len(data) > 64 * 1024:
            reject()
        request = json.loads(data, object_pairs_hook=pairs, parse_constant=lambda _: reject())
        if not isinstance(request, dict):
            reject()
        return request
    except (UnicodeError, ValueError, TypeError):
        reject()


def validate_request(request):
    if not isinstance(request, dict):
        reject()
    fields = {'inspect': {'action'}, 'check': {'action'}, 'status': {'action', 'jobId'},
              'apply': {'action', 'planId', 'digest'}}
    action = request.get('action')
    if not isinstance(action, str) or action not in fields or set(request) != fields[action]:
        reject()
    if action == 'status' and (not isinstance(request['jobId'], str) or not ID.fullmatch(request['jobId'])):
        reject()
    if action == 'apply' and (not isinstance(request['planId'], str) or not ID.fullmatch(request['planId']) or
                              not isinstance(request['digest'], str) or not re.fullmatch('[a-f0-9]{64}', request['digest'])):
        reject()
    return action


def protected(path, owner=0, directory=False):
    try:
        info = path.lstat()
        if (info.st_uid != owner or info.st_mode & 0o022 or
                not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))):
            reject('unsafe_state', 'Updater storage is not protected.')
    except OSError:
        reject('unsafe_state', 'Updater storage is unavailable.')


class Runtime:
    def __init__(self, *, engine, ctx, directory=BASE, node=None, boot=None,
                 clock=time.monotonic, owner=0, launch=None, unit_active=None):
        self.engine, self.ctx = engine, ctx
        self.directory = pathlib.Path(directory)
        self.node = node or socket.gethostname().split('.')[0]
        if not NODE.fullmatch(self.node):
            reject('wrong_node', 'The helper node identity is invalid.')
        self.boot = boot or (lambda: pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip())
        self.clock, self.owner = clock, owner
        self.launch = launch or self.launch_unit
        self.unit_active = unit_active or self.systemd_active
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        protected(self.directory, self.owner, directory=True)
        if self.directory.stat().st_mode & 0o077:
            reject('unsafe_state', 'Updater storage must be private to root.')

    @contextlib.contextmanager
    def lock(self, name, blocking=True):
        path = self.directory / name
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != self.owner or info.st_mode & 0o077:
                reject('unsafe_state', 'Updater storage is not protected.')
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
            except BlockingIOError:
                reject('busy', 'A host update operation is already active.')
            yield
        finally:
            os.close(fd)

    def operation(self):
        return self.lock('operation.lock', blocking=False)

    def read(self):
        path = self.directory / 'state.json'
        if not path.exists() and not path.is_symlink():
            return {'jobs': {}, 'active': None, 'latest': None}
        protected(path, self.owner)
        if path.stat().st_mode & 0o077 or path.stat().st_size > 64 * 1024 * 1024:
            reject('unsafe_state', 'Updater storage is not protected.')
        try:
            result = json.loads(path.read_text())
            if set(result) != {'jobs', 'active', 'latest'} or not isinstance(result['jobs'], dict):
                raise ValueError()
            return result
        except (ValueError, OSError):
            reject('unsafe_state', 'Updater saved state could not be read.')

    def save(self, state):
        completed = [entry for entry in state['jobs'].values() if entry['job']['state'] in TERMINAL]
        for entry in sorted(completed, key=lambda e: e['job']['startedAt'])[:-20]:
            state['jobs'].pop(entry['job']['id'], None)
        temporary = self.directory / ('state-' + secrets.token_hex(16) + '.tmp')
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as stream:
                json.dump(state, stream, separators=(',', ':'), ensure_ascii=True)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.directory / 'state.json')
            fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        finally:
            temporary.unlink(missing_ok=True)

    def reconcile(self, state):
        active = state['active']
        if active:
            entry = state['jobs'].get(active)
            if not entry:
                reject('unsafe_state', 'Updater saved state is incomplete.')
            same_boot = entry['bootId'] == self.boot()
            grace = same_boot and 0 <= self.clock() - entry['admittedMonotonic'] < 15
            inactive = not grace and self.unit_active(entry['unit']) is False
            can_interrupt = not same_boot
            if inactive and same_boot:
                try:
                    with self.operation():
                        can_interrupt = True
                except RpcError as error:
                    if error.code != 'busy':
                        raise
            if can_interrupt:
                entry['job'].update(state='interrupted', finishedAt=now_iso(),
                                    error={'code': 'interrupted', 'message': 'Worker continuity could not be verified. Inspect the host before checking again.'})
                state['active'] = None
                self.save(state)

    def public(self, entry):
        job = json.loads(json.dumps(entry['job']))
        # Account for JSON escaping, not just character counts.
        while len(json.dumps(job, ensure_ascii=True).encode()) > 256 * 1024 - 1024 and job['log']:
            job['log'].pop(0)
            job['logTruncated'] = True
        if len(json.dumps(job, ensure_ascii=True).encode()) > 256 * 1024 - 1024:
            reject('output_limit', 'Updater result exceeds the response limit.')
        return job

    def event(self, job_id, message):
        with self.lock('state.lock'):
            state = self.read()
            job = state['jobs'][job_id]['job']
            line = message[:2048]
            if len(message) > 2048:
                job['logTruncated'] = True
            job['log'].append(line)
            while len(job['log']) > 500 or sum(len(s.encode()) for s in job['log']) > 128 * 1024:
                job['log'].pop(0)
                job['logTruncated'] = True
            self.save(state)

    def handle(self, request):
        action = validate_request(request)
        if action in ('inspect', 'status'):
            with self.lock('state.lock'):
                state = self.read()
                self.reconcile(state)
                if action == 'status':
                    entry = state['jobs'].get(request['jobId'])
                    if not entry:
                        reject('unknown_job', 'This host update job is not retained.')
                    return self.public(entry)
            info = self.engine.inspect_host(self.ctx)
            if state['latest']:
                info['latestJobId'] = state['latest']
            return info

        # Separate operation and state locks: polling and guard never take the
        # long-held operation lock. Persist admission before starting systemd.
        with self.operation(), self.lock('state.lock'):
            state = self.read()
            self.reconcile(state)
            if state['active']:
                reject('busy', 'A host update operation is already active.')
            if not self.engine.inspect_host(self.ctx)['ready']:
                reject('not_ready', 'The host needs administrator attention before managed updates.')
            plan_record = None
            if action == 'apply':
                review = state['jobs'].get(request['planId'])
                if (not review or review['job']['state'] != 'review' or review.get('consumedBy') or
                        review['job']['plan']['digest'] != request['digest']):
                    reject('stale_plan', 'The reviewed plan is unavailable or was already consumed.')
                plan_record = review['planRecord']
                try:
                    self.engine.validate_plan(self.ctx, plan_record, self.clock, self.boot())
                except self.engine.UpdaterError as error:
                    reject(error.code, error.message)
            job_id = secrets.token_hex(16)
            job = {'id': job_id, 'state': 'running', 'phase': action, 'startedAt': now_iso(),
                   'log': ['Update check accepted.' if action == 'check' else 'Reviewed installation accepted.']}
            entry = {'job': job, 'bootId': self.boot(), 'admittedMonotonic': self.clock(),
                     'unit': 'proxmiu-host-update-' + job_id + '.service'}
            if plan_record:
                state['jobs'][request['planId']]['consumedBy'] = job_id
                entry['planRecord'] = plan_record
            state['jobs'][job_id] = entry
            state['active'] = state['latest'] = job_id
            self.save(state)
        try:
            self.launch(job_id)
        except Exception:
            # A launch timeout may occur after the worker has started. Never
            # terminalize it unless we own its operation lock ourselves.
            try:
                with self.operation():
                    self.finish(job_id, 'failed', error={'code': 'launch_failed', 'message': 'The durable worker could not be started. The plan cannot be replayed.'})
            except RpcError as error:
                if error.code != 'busy':
                    raise
        with self.lock('state.lock'):
            return self.public(self.read()['jobs'][job_id])

    def finish(self, job_id, result, **fields):
        with self.lock('state.lock'):
            state = self.read()
            entry = state['jobs'][job_id]
            if entry['job']['state'] != 'running':
                return
            entry['job'].update(state=result, finishedAt=now_iso(), **fields)
            if state['active'] == job_id:
                state['active'] = None
            self.save(state)

    def worker(self, job_id):
        if not ID.fullmatch(job_id):
            reject()
        with self.operation():
            with self.lock('state.lock'):
                state = self.read()
                entry = state['jobs'].get(job_id)
                if not entry or state['active'] != job_id or entry['bootId'] != self.boot() or entry['job']['state'] != 'running':
                    reject('invalid_worker', 'Worker admission could not be verified.')
            try:
                if hasattr(self.ctx, 'events'):
                    self.ctx.events = lambda message: self.event(job_id, message)
                if entry['job']['phase'] == 'check':
                    record = self.engine.build_plan(self.ctx, job_id, self.clock, self.boot())
                    with self.lock('state.lock'):
                        state = self.read()
                        state['jobs'][job_id]['planRecord'] = record
                        self.save(state)
                    self.finish(job_id, 'review' if record['plan']['packages'] else 'success', plan=record['plan'])
                else:
                    self.engine.apply_plan(self.ctx, entry['planRecord'], job_id, self.clock, self.boot())
                    self.engine.verify_installed(self.ctx, entry['planRecord'])
                    self.finish(job_id, 'success', rebootSuggested=self.engine.inspect_host(self.ctx)['rebootSuggested'] or entry['planRecord']['plan']['kernelChange'])
            except self.engine.UpdaterError as error:
                self.finish(job_id, 'failed', error={'code': error.code, 'message': error.message})
            except Exception:
                self.finish(job_id, 'failed', error={'code': 'worker_failed', 'message': 'The worker stopped without a verified result. Inspect the host locally.'})

    def guard(self, job_id, stream):
        with self.lock('state.lock'):
            state = self.read()
            entry = state['jobs'].get(job_id)
            if (state['active'] != job_id or not entry or entry['job']['state'] != 'running' or
                    entry['job']['phase'] != 'apply' or entry['bootId'] != self.boot()):
                reject('invalid_guard', 'Guard admission could not be verified.')
            record = entry['planRecord']
        self.ctx.events = lambda message: self.event(job_id, message)
        self.engine.guard(self.ctx, record, stream, self.clock, self.boot(), job_id=job_id)

    @staticmethod
    def launch_unit(job_id):
        subprocess.run(['/usr/bin/systemd-run', '--quiet', '--collect', '--unit=proxmiu-host-update-' + job_id,
                        '--property=Type=exec', '--property=Restart=no', '/usr/bin/python3', '-I', HELPER, '--worker', job_id],
                       env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=15)

    @staticmethod
    def systemd_active(unit):
        try:
            result = subprocess.run(['/usr/bin/systemctl', 'show', '--property=ActiveState', '--value', unit],
                                    env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    check=True, timeout=3, text=True)
            value = result.stdout.strip()
            if value in ('active', 'activating', 'reloading', 'deactivating'):
                return True
            return False if value in ('inactive', 'failed') else None
        except (OSError, subprocess.SubprocessError):
            return None


def read_stdin(limit, seconds):
    end, data = time.monotonic() + seconds, bytearray()
    while True:
        remaining = end - time.monotonic()
        if remaining <= 0 or not select.select([sys.stdin.buffer], [], [], remaining)[0]:
            reject('request_timeout', 'The updater request was not completed in time.')
        block = os.read(sys.stdin.fileno(), min(8192, limit + 1 - len(data)))
        if not block:
            return bytes(data)
        data.extend(block)
        if len(data) > limit:
            reject('input_limit', 'The updater request exceeds the input limit.')


def main(argv):
    node = socket.gethostname().split('.')[0]
    if not NODE.fullmatch(node) or os.geteuid() != 0:
        reject('wrong_node', 'The updater requires its enrolled Proxmox node.')
    if argv == ['--rpc', '--node', node]:
        mode, job_id = 'rpc', None
    elif len(argv) == 2 and argv[0] in ('--worker', '--guard') and ID.fullmatch(argv[1]):
        mode, job_id = argv[0][2:], argv[1]
    else:
        reject('wrong_node', 'The forced command does not match this node.')
    for path in (pathlib.Path(HELPER), pathlib.Path(ENGINE)):
        protected(path)
        for parent in path.parents:
            protected(parent, directory=True)
    spec = importlib.util.spec_from_file_location('proxmiu_host_updater_apt', ENGINE)
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    runtime = Runtime(engine=engine, ctx=engine.AptContext(), node=node)
    if mode == 'worker':
        runtime.worker(job_id)
    elif mode == 'guard':
        runtime.guard(job_id, read_stdin(8 * 1024 * 1024, 60).decode('utf-8', errors='strict'))
    else:
        try:
            result = runtime.handle(parse_request(read_stdin(64 * 1024, 10)))
            response = {'protocol': 1, 'node': node, 'result': result}
        except (RpcError, engine.UpdaterError) as error:
            response = {'protocol': 1, 'node': node, 'error': {'code': error.code, 'message': error.message}}
        sys.stdout.write(json.dumps(response, ensure_ascii=True, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception:
        # No arbitrary exception text, environment or maintainer output on SSH.
        sys.stderr.write('Proxmiu host updater could not complete this request.\n')
        sys.exit(1)

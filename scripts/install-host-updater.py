#!/usr/bin/python3
"""Administrator-run enrollment. Never invoked by the agent or SSH RPC."""
import argparse
import base64
import contextlib
import fcntl
import glob
import hashlib
import json
import os
import pathlib
import re
import secrets
import shlex
import socket
import stat
import struct
import subprocess
import sys
import urllib.request

REPOSITORY = 'LasseSLambertsen/proxmiu'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'HOME': '/root'}
FORCED = '/usr/bin/python3 -I /usr/local/lib/proxmiu/host-updater --rpc --node '
BUNDLE = {'host-updater': 'host-updater.py', 'host-updater-apt.py': 'host-updater-apt.py',
          'host-updater-apt-guard': 'host-updater-apt-guard.sh'}
CLUSTER_WRITE = r'''
use strict; use warnings;
use PVE::Cluster; use PVE::Tools; use JSON::PP;
local $/; my $input = decode_json(<STDIN>);
my $error;
PVE::Cluster::cfs_lock_domain('proxmiu-updater-enroll', 10, sub {
    my $path = '/etc/pve/priv/authorized_keys';
    open(my $read, '<', $path) or die "read failed";
    my $before = <$read>; close($read) or die "close failed";
    die "changed input" if $before ne $input->{before};
    my @stat = stat($path); die "stat failed" if !@stat;
    PVE::Tools::file_set_contents($path, $input->{after}, $stat[2] & 07777);
    open(my $verify, '<', $path) or die "verify failed";
    my $after = <$verify>; close($verify) or die "close failed";
    die "verify mismatch" if $after ne $input->{after};
});
die "cluster lock failed" if $@;
'''


class InstallError(Exception):
    pass


def stop(message):
    raise InstallError(message)


def public_key(value):
    if not isinstance(value, str) or len(value) > 512 or '\n' in value or '\r' in value:
        stop('Provide one dedicated ed25519 public key.')
    fields = value.split()
    if len(fields) not in (2, 3) or fields[0] != 'ssh-ed25519':
        stop('Provide one dedicated ed25519 public key.')
    try:
        raw = base64.b64decode(fields[1], validate=True)
        if raw[:19] != struct.pack('>I', 11) + b'ssh-ed25519' + struct.pack('>I', 32) or len(raw) != 51:
            raise ValueError()
    except ValueError:
        stop('The ed25519 public key is invalid.')
    return 'ssh-ed25519 ' + base64.b64encode(raw).decode(), raw


def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            if response.geturl().split('/')[2] != url.split('/')[2]:
                stop('Source download redirected outside its trusted host.')
            data = response.read(1024 * 1024 + 1)
            if not data or len(data) > 1024 * 1024:
                stop('A helper source download was empty or too large.')
            return data
    except Exception:
        stop('Helper sources could not be downloaded. No key was enrolled.')


def run(argv, *, input=None):
    try:
        result = subprocess.run(argv, input=input, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                check=True, timeout=30, text=True)
        if len(result.stdout.encode()) > 256 * 1024:
            stop('An enrollment prerequisite returned too much output.')
        return result.stdout
    except (OSError, subprocess.SubprocessError):
        stop('An enrollment prerequisite failed. Inspect the host locally.')


class Installer:
    def __init__(self, *, root=pathlib.Path('/'), owner=0, fetch=fetch, runner=run, node=None, check_host=None):
        self.root, self.owner = pathlib.Path(root), owner
        self.fetch, self.run = fetch, runner
        self.node = node or socket.gethostname().split('.')[0]
        self.check_host = check_host or self.production_host

    def path(self, value):
        return self.root / value.lstrip('/')

    def protect(self, path, *, directory=False):
        try:
            info = path.lstat()
            if (info.st_uid != self.owner or info.st_mode & 0o022 or
                    not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))):
                stop('Enrollment paths must be root-owned and protected from writes by others.')
        except OSError:
            stop('An enrollment prerequisite file is unavailable.')

    def ancestors(self, path):
        for directory in path.parents:
            self.protect(directory, directory=True)
            if directory == self.root:
                break

    def production_host(self):
        if os.geteuid() != 0 or sys.version_info < (3, 11):
            stop('Run this installer as root with Python 3.11 or newer on the intended Proxmox node.')
        version = self.run(['/usr/bin/dpkg-query', '-W', '-f=${Version}', 'pve-manager'])
        if not re.match(r'^[89]\.', version):
            stop('Enrollment supports Proxmox 8 or 9 only.')
        self.run(['/usr/bin/systemctl', 'show', '--property=Version', '--value'])

    def ssh_policy(self):
        seen = set()
        def read_config(path):
            if path in seen:
                stop('Recursive SSH includes require manual review.')
            seen.add(path)
            self.protect(path)
            self.ancestors(path)
            for row in path.read_text().splitlines():
                lexer = shlex.shlex(row, posix=True)
                lexer.whitespace += '='
                lexer.whitespace_split = True
                try:
                    words = list(lexer)
                except ValueError:
                    stop('SSH configuration syntax requires manual review.')
                if not words:
                    continue
                if words[0].lower() == 'match':
                    stop('SSH Match blocks require manual review before updater enrollment.')
                if words[0].lower() == 'include':
                    for pattern in words[1:]:
                        if not pattern.startswith('/etc/ssh/') or '..' in pathlib.PurePosixPath(pattern).parts:
                            stop('SSH Include paths require manual review.')
                        for child in glob.glob(str(self.path(pattern))):
                            read_config(pathlib.Path(child))
        read_config(self.path('/etc/ssh/sshd_config'))
        effective = self.run(['/usr/sbin/sshd', '-T', '-C', 'user=root,host=' + self.node + ',addr=127.0.0.1'])
        settings = {}
        for row in effective.splitlines():
            key, _, value = row.partition(' ')
            settings.setdefault(key, []).append(value)
        if (settings.get('permituserenvironment') != ['no'] or settings.get('authorizedkeyscommand') != ['none'] or
                settings.get('forcecommand') != ['none'] or settings.get('pubkeyauthentication') != ['yes'] or
                settings.get('permitrootlogin') not in (['yes'], ['without-password'], ['prohibit-password'], ['forced-commands-only'])):
            stop('SSH root key policy does not support restricted updater enrollment. SSH settings were not changed.')
        for pattern in ' '.join(settings.get('acceptenv', [])).split():
            if pattern not in ('LANG', 'LC_*') and not re.fullmatch('LC_[A-Z_]+', pattern):
                stop('SSH accepts environment variables outside the supported locale set.')
        files = ' '.join(settings.get('authorizedkeysfile', [])).split()
        if not files or files[0] not in ('.ssh/authorized_keys', '/root/.ssh/authorized_keys') or set(files) - {
                '.ssh/authorized_keys', '/root/.ssh/authorized_keys', '.ssh/authorized_keys2', '/root/.ssh/authorized_keys2'}:
            stop('SSH authorized key paths require manual review.')
        if 'ssh-ed25519' not in ','.join(settings.get('hostkeyalgorithms', [])).split(','):
            stop('An ed25519 SSH host key must be enabled.')
        keypath = self.path('/etc/ssh/ssh_host_ed25519_key.pub')
        self.protect(keypath)
        _, raw = public_key(keypath.read_text().strip())
        return 'SHA256:' + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip('=')

    @contextlib.contextmanager
    def lock(self, name):
        path = self.path('/var/lib/proxmiu-host-updater/' + name)
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            self.protect(path)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                stop('An updater operation is active. Enrollment did not change the helper.')
            yield
        finally:
            os.close(fd)

    def write_helper(self, path, data):
        self.ancestors(path)
        if path.exists() or path.is_symlink():
            self.protect(path)
        temporary = path.parent / ('.enroll-' + secrets.token_hex(16))
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o755)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, 0o755)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def install(self, supplied_key, ref):
        key, _ = public_key(supplied_key)
        if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,99}', ref):
            stop('The trusted source ref is invalid.')
        if not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9.-]{0,62}', self.node):
            stop('The Proxmox node name is invalid.')
        self.check_host()
        fingerprint = self.ssh_policy()
        state_dir = self.path('/var/lib/proxmiu-host-updater')
        state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.protect(state_dir, directory=True)
        self.ancestors(state_dir)
        if state_dir.stat().st_mode & 0o077:
            stop('Updater state must be private to root.')
        with self.lock('operation.lock'), self.lock('state.lock'):
            saved = state_dir / 'state.json'
            if saved.exists() or saved.is_symlink():
                self.protect(saved)
                try:
                    if json.loads(saved.read_text()).get('active'):
                        stop('An updater job is unresolved. Verify its terminal state before changing helpers.')
                except (ValueError, OSError):
                    stop('Updater state needs manual inspection before enrollment.')
            target = self.path('/root/.ssh/authorized_keys')
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.ancestors(target)
            clustered = target.is_symlink()
            if clustered:
                if target.resolve() != self.path('/etc/pve/priv/authorized_keys'):
                    stop('The root authorized_keys symlink target is unsupported.')
                destination = target.resolve()
                self.ancestors(destination)
            else:
                destination = target
            if destination.exists():
                self.protect(destination)
                before = destination.read_text()
            elif clustered:
                stop('The cluster key file is unavailable.')
            else:
                before = ''
            line = 'restrict,command="' + FORCED + self.node + '" ' + key + ' proxmiu-host-updater-' + self.node
            blob = key.split()[1]
            matching = [row for row in before.splitlines() if not row.lstrip().startswith('#') and blob in row.split()]
            if matching and matching != [line]:
                stop('This public key already has conflicting authorization. Use a dedicated updater key.')
            secondary = self.path('/root/.ssh/authorized_keys2')
            if secondary.exists():
                self.protect(secondary)
                if any(blob in row.split() for row in secondary.read_text().splitlines() if not row.lstrip().startswith('#')):
                    stop('This key is also authorized in a secondary key file.')
            try:
                resolved = ref if re.fullmatch('[a-f0-9]{40}', ref) else json.loads(self.fetch('https://api.github.com/repos/' + REPOSITORY + '/commits/' + ref))['sha']
                if not re.fullmatch('[a-f0-9]{40}', resolved):
                    stop('The source ref did not resolve to an immutable commit.')
                bundle = {name: self.fetch('https://raw.githubusercontent.com/' + REPOSITORY + '/' + resolved + '/scripts/' + source)
                          for name, source in BUNDLE.items()}
                if any(not data or len(data) > 1024 * 1024 for data in bundle.values()):
                    stop('A helper source is empty or too large.')
                for name, data in bundle.items():
                    if name.endswith('.py') or name == 'host-updater':
                        compile(data, name, 'exec')
            except Exception:
                stop('The immutable helper bundle could not be validated. No key was enrolled.')
            helper_dir = self.path('/usr/local/lib/proxmiu')
            helper_dir.mkdir(parents=True, exist_ok=True, mode=0o755)
            self.protect(helper_dir, directory=True)
            for name, data in bundle.items():
                self.write_helper(helper_dir / name, data)
            if not matching:
                after = before + ('' if not before or before.endswith('\n') else '\n') + line + '\n'
                if clustered:
                    self.run(['/usr/bin/perl', '-e', CLUSTER_WRITE], input=json.dumps({'before': before, 'after': after}))
                else:
                    if (destination.read_text() if destination.exists() else '') != before:
                        stop('The root key file changed during enrollment. No key was added.')
                    # A local file can be atomically replaced; preserve its mode.
                    mode = stat.S_IMODE(destination.stat().st_mode) if destination.exists() else 0o600
                    temporary = destination.parent / ('.proxmiu-key-' + secrets.token_hex(16))
                    try:
                        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
                        with os.fdopen(fd, 'w') as stream:
                            stream.write(after)
                            stream.flush()
                            os.fsync(stream.fileno())
                        os.chmod(temporary, mode)
                        os.replace(temporary, destination)
                    finally:
                        temporary.unlink(missing_ok=True)
                if destination.read_text() != after:
                    stop('Root key enrollment could not be verified. Inspect the host locally.')
        return {'protocol': 1, 'node': self.node, 'fingerprint': fingerprint, 'sourceCommit': resolved}


def main():
    parser = argparse.ArgumentParser(description='Enroll restricted Proxmiu host updates as the Proxmox administrator.')
    parser.add_argument('--public-key', required=True)
    parser.add_argument('--ref', default='main')
    args = parser.parse_args()
    print(json.dumps(Installer().install(args.public_key, args.ref)))


if __name__ == '__main__':
    try:
        main()
    except InstallError as error:
        sys.stderr.write(str(error) + '\n')
        sys.exit(1)
    except Exception:
        sys.stderr.write('Enrollment stopped without a verified result. Inspect the host locally.\n')
        sys.exit(1)

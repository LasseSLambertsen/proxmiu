"""Fixed-policy APT engine. Imported by the isolated root runtime, never a CLI.

Context injection is an internal testing interface. Production uses AptContext()
without arguments; RPC data cannot select paths, commands or environment.
"""
import re
import os
import stat
import json
import hashlib
import pathlib
import subprocess
import tempfile
import time
from datetime import datetime, timezone, timedelta


class UpdaterError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _bad():
    raise UpdaterError('unsafe_actions', 'APT produced unsafe or unrecognized package actions.')


_NAME = re.compile(r'[a-z0-9][a-z0-9+.-]+\Z')
_ARCH = re.compile(r'[a-z0-9][a-z0-9-]*\Z')
_VERSION = re.compile(r'[0-9][A-Za-z0-9.+:~\-]*\Z')
_MULTI = {'none', 'same', 'foreign', 'allowed'}


def parse_version3(stream):
    """Parse APT's v3 hook feed into action dictionaries; reject unsafe rows.

    The configuration header is opaque: APT percent-encodes its values. It is
    not a substitute for inspecting effective configuration before launching.
    """
    if not isinstance(stream, str) or len(stream.encode('utf-8')) > 8 * 1024 * 1024 or '\x00' in stream:
        _bad()
    lines = stream.splitlines()
    if not lines or lines[0] != 'VERSION 3':
        _bad()
    try:
        separator = lines.index('', 1)
    except ValueError:
        _bad()
    for line in lines[1:separator]:
        if '=' not in line or not line.split('=', 1)[0]:
            _bad()
    actions = []
    for line in lines[separator + 1:]:
        fields = line.split(' ')
        if len(fields) != 9 or any(not field for field in fields):
            _bad()
        name, old, old_arch, old_multi, relation, new, arch, multi, operation = fields
        if (not _NAME.fullmatch(name) or not _VERSION.fullmatch(new) or
                not _ARCH.fullmatch(arch) or multi not in _MULTI or
                relation not in ('<', '=') or
                not ((old == '-' and old_arch == '-' and old_multi == 'none' and relation == '<') or
                     (_VERSION.fullmatch(old) and _ARCH.fullmatch(old_arch) and old_multi in _MULTI))):
            _bad()
        if operation == '**CONFIGURE**':
            action = 'configure'
        elif operation.startswith('/') and not operation.startswith('//'):
            action = 'install'
        else:
            _bad()
        actions.append({'name': name, 'installed': None if old == '-' else old,
                        'installedArchitecture': None if old == '-' else old_arch,
                        'candidate': new, 'architecture': arch, 'action': action,
                        'archive': operation if action == 'install' else None})
    return actions


def match_actions(packages, actions):
    """Match action identities to reviewed packages; return install actions.

    Configure actions can follow an install but cannot introduce an identity,
    repeat or precede its install. The caller must inspect each returned archive.
    """
    expected = {}
    for package in packages:
        key = (package['name'], package['architecture'])
        if key in expected:
            _bad()
        expected[key] = package
    installed, configured = {}, set()
    for action in actions:
        key = (action['name'], action['architecture'])
        package = expected.get(key)
        if (package is None or package['candidate'] != action['candidate'] or
                package['installed'] != action['installed']):
            _bad()
        if action['action'] == 'install':
            if key in installed:
                _bad()
            installed[key] = action
        elif action['action'] == 'configure':
            if key not in installed or key in configured:
                _bad()
            configured.add(key)
        else:
            _bad()
    if set(installed) != set(expected):
        _bad()
    return list(installed.values())


def verify_archive(action, cache_dir, runner, *, owner=0):
    """Inspect one cache file via a pinned fd using runner(argv, pass_fds=...).

    cache_dir must itself be a trusted, protected directory. Production callers
    must also establish that its parent path is protected and fixed.
    """
    import os
    import stat
    archive = action['archive']
    if (not isinstance(archive, str) or os.path.dirname(archive) != cache_dir or
            not archive.endswith('.deb') or os.path.basename(archive) in ('.', '..')):
        _bad()
    directory = fd = None
    try:
        directory = os.open(cache_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        info = os.fstat(directory)
        if info.st_uid != owner or info.st_mode & 0o022:
            _bad()
        fd = os.open(os.path.basename(archive), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, dir_fd=directory)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
            _bad()
        for field, key in (('Package', 'name'), ('Version', 'candidate'), ('Architecture', 'architecture')):
            result = runner(['/usr/bin/dpkg-deb', '--field', f'/proc/self/fd/{fd}', field], pass_fds=(fd,))
            if not isinstance(result, str) or result != action[key] + '\n':
                _bad()
    except (OSError, KeyError, ValueError):
        _bad()
    finally:
        if fd is not None:
            os.close(fd)
        if directory is not None:
            os.close(directory)


ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'LANG': 'C',
       'HOME': '/root', 'DEBIAN_FRONTEND': 'noninteractive'}
GUARD = '/usr/local/lib/proxmiu/host-updater-apt-guard'
QUERY = ['/usr/bin/dpkg-query', '-W', '-f=${binary:Package}\t${Version}\t${Architecture}\t${db:Status-Abbrev}\n']
SAFE_OPTIONS = ['-o', 'APT::Get::AllowUnauthenticated=false', '-o', 'Acquire::AllowInsecureRepositories=false',
                '-o', 'Acquire::AllowDowngradeToInsecureRepositories=false',
                '-o', 'APT::Get::allow-downgrades=false', '-o', 'APT::Get::allow-change-held-packages=false',
                '-o', 'DPkg::Lock::Timeout=0']


def fail(code):
    messages = {
        'unsupported_host': 'This helper supports Proxmox 8 on Bookworm or Proxmox 9 on Trixie.',
        'unsafe_sources': 'Repository definitions require administrator review before managed updates.',
        'unsafe_config': 'APT configuration is not supported for reviewed installation.',
        'unhealthy_dpkg': 'The package database needs administrator attention.',
        'unsafe_plan': 'APT proposed unsupported or ambiguous package changes.',
        'plan_too_large': 'The complete package plan exceeds the review limit.',
        'stale_plan': 'The reviewed plan expired or host package state changed. Check updates again.',
        'command_failed': 'A package operation failed. Inspect the host locally for details.',
        'unsafe_files': 'Host package files are not protected or could not be read safely.',
        'verification_failed': 'Installed package versions or package health could not be verified.',
    }
    raise UpdaterError(code, messages[code])


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def run(argv, *, pass_fds=(), quiet=False):
    """Never store maintainer output. Mutating commands have no RPC timeout."""
    try:
        if quiet:
            result = subprocess.run(argv, env=ENV, stdin=subprocess.DEVNULL,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    pass_fds=pass_fds, check=False)
            if result.returncode:
                fail('command_failed')
            return ''
        with tempfile.TemporaryFile() as output:
            child = subprocess.Popen(argv, env=ENV, stdin=subprocess.DEVNULL, stdout=output,
                                     stderr=subprocess.DEVNULL, pass_fds=pass_fds)
            try:
                child.wait(timeout=60)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
                fail('command_failed')
            if child.returncode or output.tell() > 16 * 1024 * 1024:
                fail('command_failed')
            output.seek(0)
            return output.read().decode('utf-8', errors='strict')
    except (OSError, UnicodeError):
        fail('command_failed')


class AptContext:
    def __init__(self, *, root=pathlib.Path('/'), runner=run, owner=0, events=lambda _: None):
        self.root = pathlib.Path(root)
        self.run = runner
        self.owner = owner
        self.events = events

    def path(self, name):
        return self.root / name.lstrip('/')

    def text(self, name):
        try:
            return self.path(name).read_text(encoding='utf-8')
        except (OSError, UnicodeError):
            fail('unsafe_files')


def _deb822(text):
    result, stanza, last = [], {}, None
    for line in text.splitlines() + ['']:
        if not line.strip():
            if stanza:
                result.append(stanza)
            stanza, last = {}, None
        elif line.startswith('#'):
            continue
        elif line[:1].isspace() and last:
            stanza[last] += '\n' + line[1:]
        elif ':' in line:
            key, value = line.split(':', 1)
            key = key.lower()
            if not re.fullmatch('[a-z][a-z0-9-]*', key) or key in stanza:
                fail('unsafe_sources')
            stanza[key], last = value.strip(), key
        else:
            fail('unsafe_sources')
    return result


def parse_sources(text, kind, codename):
    """Return referenced key paths, never repository URLs in errors or results."""
    suites = {codename, *(codename + suffix for suffix in ('-security', '-updates', '-backports')), 'nodistro'}
    refs = []

    def check(types, uris, dist, options):
        if (not types or set(types) - {'deb', 'deb-src'} or not uris or not dist or set(dist) - suites or
                any(not re.fullmatch(r'(?:https?|file|cdrom):\S+', uri) for uri in uris)):
            fail('unsafe_sources')
        for key, value in options.items():
            key = key.lower()
            if key in {'trusted', 'allow-insecure', 'allow-weak', 'allow-downgrade-to-insecure'} and value.lower() != 'no':
                fail('unsafe_sources')
            if key in {'check-valid-until', 'check-date'} and value.lower() != 'yes':
                fail('unsafe_sources')
        signed = options.get('signed-by', '')
        if 'BEGIN PGP PUBLIC KEY BLOCK' not in signed:
            for item in re.split(r'[\s,]+', signed):
                if not item:
                    continue
                if item.startswith('/') and '..' not in pathlib.PurePosixPath(item).parts:
                    refs.append(item)
                elif not re.fullmatch(r'[A-Fa-f0-9]{40}!?', item):
                    fail('unsafe_sources')

    if kind == 'list':
        for line in text.splitlines():
            line = line.split('#', 1)[0].strip()
            if not line:
                continue
            match = re.fullmatch(r'(deb(?:-src)?)\s+(?:\[([^\]]+)\]\s+)?(\S+)\s+(\S+)\s+(.+)', line)
            if not match:
                fail('unsafe_sources')
            typ, raw, uri, suite, _ = match.groups()
            options = {}
            for entry in (raw or '').split():
                if '=' not in entry:
                    fail('unsafe_sources')
                key, value = entry.split('=', 1)
                if key in options:
                    fail('unsafe_sources')
                options[key.lower()] = value
            check([typ], [uri], [suite], options)
    elif kind == 'sources':
        for stanza in _deb822(text):
            if stanza.get('enabled', 'yes').lower() == 'no':
                continue
            if stanza.get('enabled', 'yes').lower() != 'yes':
                fail('unsafe_sources')
            check(stanza.get('types', '').split(), stanza.get('uris', '').split(),
                  stanza.get('suites', '').split(), stanza)
    else:
        fail('unsafe_sources')
    return refs


def _quote(value):
    if any(ord(c) < 32 for c in value):
        fail('unsafe_config')
    return '"' + value.replace('"', '\\"') + '"'


def parse_config(text):
    config = {}
    for line in text.splitlines():
        match = re.fullmatch(r'([^\s";]+) "((?:[^"\\]|\\.)*)";', line)
        if not match:
            fail('unsafe_config')
        key, value = match.groups()
        value = value.replace('\\"', '"')
        config.setdefault(key, []).append(value)
    return config


def overlay_config_dump(baseline, overlay):
    """Model APT's documented #clear plus late -c semantics in fixture consumers."""
    config = parse_config(baseline)
    lines = overlay.splitlines()
    if not lines or lines[0] != '#clear DPkg::Pre-Install-Pkgs;':
        fail('unsafe_config')
    config = {k: v for k, v in config.items() if k.lower().rstrip(':') != 'dpkg::pre-install-pkgs'}
    additions = parse_config('\n'.join(lines[1:]))
    for key, values in additions.items():
        if key.endswith('::'):
            config.setdefault(key, []).extend(values)
        else:
            config[key] = values
    return '\n'.join(key + ' ' + _quote(value) + ';' for key, values in config.items() for value in values) + '\n'


def config_policy(text, *, with_guard=False):
    config = parse_config(text)
    paths = {'dir': '/', 'dir::state': 'var/lib/apt', 'dir::state::lists': 'lists/',
             'dir::state::status': '/var/lib/dpkg/status', 'dir::cache': 'var/cache/apt',
             'dir::cache::archives': 'archives/', 'dir::etc': 'etc/apt', 'dir::etc::sourcelist': 'sources.list',
             'dir::etc::sourceparts': 'sources.list.d', 'dir::etc::main': 'apt.conf', 'dir::etc::parts': 'apt.conf.d',
             'dir::etc::preferences': 'preferences', 'dir::etc::preferencesparts': 'preferences.d',
             'dir::etc::trusted': 'trusted.gpg', 'dir::etc::trustedparts': 'trusted.gpg.d',
             'dir::bin::dpkg': '/usr/bin/dpkg', 'dir::bin::methods': '/usr/lib/apt/methods',
             'dir::bin::solvers': '', 'dir::bin::solvers::': '/usr/lib/apt/solvers',
             'dir::bin::planners': '', 'dir::bin::planners::': '/usr/lib/apt/planners'}
    paths.update({'dir::state::cdroms': 'cdroms.list', 'dir::etc::netrc': 'auth.conf',
                  'dir::etc::netrcparts': 'auth.conf.d', 'dir::boot': 'boot', 'dir::usr': 'usr',
                  **{'dir::bin::' + command: prefix + command for command, prefix in
                     (('gzip', '/bin/'), ('bzip2', '/bin/'), ('xz', '/usr/bin/'), ('lz4', '/usr/bin/'), ('zstd', '/usr/bin/'))},
                  'dir::bin::lzma': '/usr/bin/xz'})
    paths.update({'dir::state::extended_states': 'extended_states', 'dir::cache::pkgcache': 'pkgcache.bin',
                  'dir::cache::srcpkgcache': 'srcpkgcache.bin',
                  'dir::etc::apt-listchanges-main': 'listchanges.conf',
                  'dir::etc::apt-listchanges-parts': 'listchanges.conf.d'})
    for key, values in config.items():
        low = key.lower()
        if (low == 'rootdir' and any(values)) or (low == 'dpkg::path' and any(v != ENV['PATH'] for v in values)):
            fail('unsafe_config')
        if low.startswith('binary::apt-get::') and any(values):
            fail('unsafe_config')
        if low.rstrip(':') == 'dpkg::pre-invoke' and any(values):
            fail('unsafe_config')
        if low in paths and any(v and v.rstrip('/') != paths[low].rstrip('/') for v in values):
            fail('unsafe_config')
        if low.startswith('dir::') and any(values) and low not in paths:
            if low not in {'dir::state::extended_states', 'dir::cache::pkgcache', 'dir::cache::srcpkgcache',
                           'dir::log', 'dir::log::terminal', 'dir::log::history', 'dir::log::planner', 'dir::media::mountpath', 'dir::ignore-files-silently::'}:
                fail('unsafe_config')
        if low.startswith('dpkg::options') and any(v not in ('', '--force-confdef', '--force-confold') for v in values):
            fail('unsafe_config')
        if (('allowunauthenticated' in low or 'allowinsecure' in low or 'allowweak' in low or 'allowdowngrade' in low or
             low in {'apt::get::allow-downgrades', 'apt::get::allow-change-held-packages'}) and
                any(v.lower() not in ('', '0', 'false', 'no') for v in values)):
            fail('unsafe_config')
        if low.startswith(('debug::', 'dpkg::chroot-directory')) and any(v.lower() not in ('', '0', 'false', 'no') for v in values):
            fail('unsafe_config')
    hooks = []
    for key, values in config.items():
        if key.lower().rstrip(':') == 'dpkg::pre-install-pkgs':
            if not key.endswith('::') and any(values):
                fail('unsafe_config')
            hooks.extend(v for v in values if v)
    if any('\n' in h or (not with_guard and h.split(' ', 1)[0] == GUARD) for h in hooks):
        fail('unsafe_config')
    return config, hooks


def installed(ctx):
    result = {}
    for row in ctx.run(QUERY).splitlines():
        fields = row.split('\t')
        if len(fields) != 4:
            fail('unhealthy_dpkg')
        name, version, arch, state = fields
        name = name.removesuffix(':' + arch)
        if not _NAME.fullmatch(name) or not _ARCH.fullmatch(arch) or not _VERSION.fullmatch(version):
            fail('unhealthy_dpkg')
        if state in ('ii ', 'hi '):
            if (name, arch) in result:
                fail('unhealthy_dpkg')
            result[(name, arch)] = version
        elif state not in ('rc ', 'un '):
            fail('unhealthy_dpkg')
    return result


def host_identity(ctx):
    release = {}
    for row in ctx.text('/etc/os-release').splitlines():
        if '=' in row:
            key, value = row.split('=', 1)
            release[key] = value.strip('"\'')
    pkgs = installed(ctx)
    versions = {name: [v for (n, _), v in pkgs.items() if n == name] for name in ('pve-manager', 'proxmox-ve')}
    if any(len(v) != 1 for v in versions.values()):
        fail('unsupported_host')
    manager, meta = versions['pve-manager'][0], versions['proxmox-ve'][0]
    major = int(manager.split('.', 1)[0]) if re.match(r'^\d+\.', manager) else 0
    codename = release.get('VERSION_CODENAME')
    if release.get('ID') != 'debian' or {8: 'bookworm', 9: 'trixie'}.get(major) != codename or not meta.startswith(str(major) + '.'):
        fail('unsupported_host')
    return {'proxmoxVersion': manager, 'proxmoxMajor': major, 'codename': codename,
            'machineIdHash': hashlib.sha256(ctx.text('/etc/machine-id').strip().encode()).hexdigest()}


def protected_file_hash(ctx, path):
    try:
        # Debian commonly uses /etc/os-release -> ../usr/lib/os-release.
        # Only permit symlinks whose complete resolved ancestry is protected.
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(ctx.root):
            fail('unsafe_files')
        for directory in (path.parent, resolved.parent):
            for parent in (directory, *directory.parents):
                info = parent.lstat()
                if not stat.S_ISDIR(info.st_mode) or info.st_uid != ctx.owner or info.st_mode & 0o022:
                    fail('unsafe_files')
                if parent == ctx.root:
                    break
        path = resolved
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != ctx.owner or info.st_mode & 0o022:
                fail('unsafe_files')
            total, sha = 0, hashlib.sha256()
            while block := os.read(fd, 1024 * 1024):
                total += len(block)
                if total > 512 * 1024 * 1024:
                    fail('unsafe_files')
                sha.update(block)
            return sha.hexdigest()
        finally:
            os.close(fd)
    except OSError:
        fail('unsafe_files')


def file_inventory(ctx, codename):
    names = {'/etc/os-release', '/etc/machine-id', '/var/lib/dpkg/status', '/var/lib/dpkg/arch',
             '/etc/apt/sources.list', '/etc/apt/preferences', '/etc/apt/trusted.gpg', '/etc/apt/listchanges.conf'}
    roots = ['/etc/apt/sources.list.d', '/etc/apt/preferences.d', '/etc/apt/trusted.gpg.d',
             '/etc/apt/apt.conf.d', '/etc/apt/listchanges.conf.d', '/var/lib/apt/lists',
             '/var/lib/dpkg/updates', '/etc/apt/keyrings', '/usr/share/keyrings']
    names.add('/etc/apt/apt.conf')
    for directory in roots:
        base = ctx.path(directory)
        if base.exists():
            for current, dirs, files in os.walk(base, followlinks=False):
                for item in dirs:
                    child = pathlib.Path(current) / item
                    if child.is_symlink():
                        fail('unsafe_files')
                dirs[:] = [d for d in dirs if d not in ('partial', 'auxfiles')]
                for name in files:
                    if name != 'lock':
                        names.add('/' + str((pathlib.Path(current) / name).relative_to(ctx.root)))
    for name in sorted(names.copy()):
        if name == '/etc/apt/sources.list' or name.startswith('/etc/apt/sources.list.d/'):
            path = ctx.path(name)
            if path.exists() and (name.endswith('.list') or name.endswith('.sources')):
                names.update(parse_sources(ctx.text(name), 'sources' if name.endswith('.sources') else 'list', codename))
    inventory = {}
    for name in sorted(names):
        path = ctx.path(name)
        inventory[name] = protected_file_hash(ctx, path) if path.exists() or path.is_symlink() else None
    return inventory


def snapshot(ctx, identity):
    if ctx.run(['/usr/bin/dpkg', '--audit']).strip():
        fail('unhealthy_dpkg')
    raw = ctx.run(['/usr/bin/apt-config', 'dump'])
    config, hooks = config_policy(raw)
    data = {'identity': identity, 'files': file_inventory(ctx, identity['codename']),
            'installed': sorted((n, a, v) for (n, a), v in installed(ctx).items()),
            'selections': ctx.run(['/usr/bin/dpkg', '--get-selections']),
            'holds': ctx.run(['/usr/bin/apt-mark', 'showhold']), 'config': config}
    return data, hooks


def inspect_host(ctx):
    info = {'proxmoxVersion': '', 'proxmoxMajor': 0, 'codename': '', 'machineIdHash': '',
            'rebootSuggested': ctx.path('/var/run/reboot-required').exists(), 'ready': False}
    try:
        info.update(host_identity(ctx))
        snapshot(ctx, {k: info[k] for k in ('proxmoxVersion', 'proxmoxMajor', 'codename', 'machineIdHash')})
        info['ready'] = True
    except UpdaterError as error:
        info['reason'] = {'code': error.code, 'message': error.message}
    return info


def compare_versions(left, right):
    """Debian version ordering, including epochs, tildes and numeric runs."""
    def parts(value):
        epoch, value = value.split(':', 1) if ':' in value else ('0', value)
        upstream, revision = value.rsplit('-', 1) if '-' in value else (value, '0')
        return int(epoch), upstream, revision

    def order(char):
        if char == '~':
            return -1
        if not char or char.isdigit():
            return 0
        return ord(char) if char.isalpha() else ord(char) + 256

    def component(a, b):
        while a or b:
            while (a and not a[0].isdigit()) or (b and not b[0].isdigit()):
                x, y = order(a[:1]), order(b[:1])
                if x != y:
                    return (x > y) - (x < y)
                a, b = a[1:], b[1:]
            aa = re.match(r'\d*', a)[0]
            bb = re.match(r'\d*', b)[0]
            x, y = int(aa or '0'), int(bb or '0')
            if x != y:
                return (x > y) - (x < y)
            a, b = a[len(aa):], b[len(bb):]
        return 0

    le, lu, lr = parts(left)
    re_, ru, rr = parts(right)
    return (le > re_) - (le < re_) or component(lu, ru) or component(lr, rr)


def _installed_identity(current, config, name, architecture):
    previous = current.get((name, architecture))
    if previous is not None:
        return previous, architecture
    native = [value for key, values in config.items() if key.lower() == 'apt::architecture' for value in values]
    matches = [(arch, version) for (package, arch), version in current.items() if package == name]
    # Architecture: all packages can replace their sole native installation.
    # Foreign or multiple installed instances need explicit administrator review.
    if architecture == 'all' and len(native) == 1 and len(matches) == 1 and matches[0][0] == native[0]:
        return matches[0][1], matches[0][0]
    return None, None


def simulate(ctx, identity, inventory):
    output = ctx.run(['/usr/bin/apt-get', *SAFE_OPTIONS, '-s', '--no-remove', 'dist-upgrade'])
    pkgs, seen = [], set()
    current = {(n, a): v for n, a, v in inventory['installed']}
    holds = {line.strip().split(':')[0] for line in inventory['holds'].splitlines()}
    for row in output.splitlines():
        if row.startswith(('Remv ', 'Purg ')):
            fail('unsafe_plan')
        if not row.startswith('Inst '):
            continue
        # APT can append several dependency hints to one install action.
        match = re.fullmatch(r'Inst ([a-z0-9][a-z0-9+.-]+(?::[a-z0-9-]+)?)(?: \[([^\]]+)\])? '
                             r'\(([^ ]+) .+ \[([a-z0-9-]+)\]\)(?: \[[^\[\]\r\n]*\])*', row)
        if not match:
            fail('unsafe_plan')
        qualified, old, new, hinted_arch = match.groups()
        name = qualified.split(':')[0]
        if (len(name) > 200 or len(new) > 200 or (old is not None and len(old) > 200) or
                not _VERSION.fullmatch(new) or name in holds):
            fail('unsafe_plan')
        records = _deb822(ctx.run(['/usr/bin/apt-cache', 'show', qualified + '=' + new]))
        candidates = {r.get('architecture') for r in records if r.get('package') == name and r.get('version') == new}
        if len(candidates) != 1:
            fail('unsafe_plan')
        arch = candidates.pop()
        if not arch or len(arch) > 40 or not _ARCH.fullmatch(arch) or hinted_arch not in (arch, 'amd64' if arch == 'all' else arch):
            fail('unsafe_plan')
        previous, _ = _installed_identity(current, inventory.get('config', {}), name, arch)
        if old != previous or (previous and compare_versions(new, previous) <= 0) or (name, arch) in seen:
            fail('unsafe_plan')
        if name in ('pve-manager', 'proxmox-ve') and not new.startswith(str(identity['proxmoxMajor']) + '.'):
            fail('unsafe_plan')
        seen.add((name, arch))
        pkgs.append({'name': name, 'architecture': arch, 'installed': previous, 'candidate': new})
        if len(pkgs) > 2000:
            fail('plan_too_large')
    return sorted(pkgs, key=lambda p: (p['name'], p['architecture']))


def build_plan(ctx, plan_id, clock=time.monotonic, boot_id=None):
    if not re.fullmatch('[a-f0-9]{32}', plan_id):
        fail('unsafe_plan')
    identity = host_identity(ctx)
    snapshot(ctx, identity)
    ctx.events('Refreshing signed package metadata.')
    ctx.run(['/usr/bin/apt-get', *SAFE_OPTIONS, '-o', 'APT::Update::Error-Mode=any', 'update'], quiet=True)
    before, _ = snapshot(ctx, identity)
    packages = simulate(ctx, identity, before)
    after, _ = snapshot(ctx, host_identity(ctx))
    if digest(before) != digest(after):
        fail('stale_plan')
    plan = {'id': plan_id, 'expiresAt': (datetime.now(timezone.utc) + timedelta(seconds=600)).isoformat(),
            'proxmoxMajor': identity['proxmoxMajor'], 'codename': identity['codename'], 'packages': packages,
            'kernelChange': any(re.match(r'(?:proxmox|pve)-(?:kernel|headers)', p['name']) for p in packages)}
    record = {'plan': plan, 'inventory': after, 'createdMonotonic': clock(), 'bootId': boot_id}
    plan['digest'] = digest(record)
    if len(canonical(plan)) > 96 * 1024:
        fail('plan_too_large')
    return record


def validate_plan(ctx, record, clock=time.monotonic, boot_id=None):
    try:
        plan = record['plan']
        copy = json.loads(canonical(record))
        saved_digest = copy['plan'].pop('digest')
        if (saved_digest != digest(copy) or record['bootId'] != boot_id or
                not 0 <= clock() - record['createdMonotonic'] < 600):
            fail('stale_plan')
        current, _ = snapshot(ctx, host_identity(ctx))
        if digest(current) != digest(record['inventory']):
            fail('stale_plan')
        if len(plan['packages']) > 2000 or len(canonical(plan)) > 96 * 1024:
            fail('plan_too_large')
    except (KeyError, TypeError, ValueError):
        fail('stale_plan')


def make_overlay(record, job_id):
    if not re.fullmatch('[a-f0-9]{32}', job_id):
        fail('unsafe_config')
    baseline = record['inventory']['config']
    hooks = [h for k, values in baseline.items() if k.lower().rstrip(':') == 'dpkg::pre-install-pkgs' for h in values if h]
    lines = ['#clear DPkg::Pre-Install-Pkgs;', 'DPkg::Pre-Install-Pkgs:: ' + _quote(GUARD + ' ' + job_id) + ';']
    lines.extend('DPkg::Pre-Install-Pkgs:: ' + _quote(h) + ';' for h in hooks)
    lines += [f'DPkg::Tools::Options::{GUARD}::Version "3";', f'DPkg::Tools::Options::{GUARD}::InfoFD "0";']
    return '\n'.join(lines) + '\n'


def apply_plan(ctx, record, job_id, clock=time.monotonic, boot_id=None):
    validate_plan(ctx, record, clock, boot_id)
    directory = ctx.path('/var/lib/proxmiu-host-updater/overlays')
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    overlay = directory / (job_id + '.conf')
    contents = make_overlay(record, job_id)
    try:
        fd = os.open(overlay, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as output:
            output.write(contents)
            output.flush()
            os.fsync(output.fileno())
    except OSError:
        fail('unsafe_files')
    baseline = '\n'.join(k + ' ' + _quote(v) + ';' for k, values in record['inventory']['config'].items() for v in values)
    effective = ctx.run(['/usr/bin/apt-config', '-c', str(overlay), 'dump'])
    if comparable_config(parse_config(effective)) != comparable_config(parse_config(overlay_config_dump(baseline, contents))):
        fail('unsafe_config')
    validate_plan(ctx, record, clock, boot_id)
    ctx.events('Installing the exact reviewed package versions. Host services may restart.')
    ctx.run(['/usr/bin/apt-get', '-c', str(overlay), *SAFE_OPTIONS, '-o', 'DPkg::Options::=--force-confdef',
             '-o', 'DPkg::Options::=--force-confold', '--no-remove', '-y', 'install',
             *(p['name'] + ':' + p['architecture'] + '=' + p['candidate'] for p in record['plan']['packages'])], quiet=True)


def comparable_config(config):
    return {k.lower(): [v for v in values if v] for k, values in config.items()
            if k.lower() != 'commandline::asstring' and any(values)}


def guard(ctx, record, stream, clock=time.monotonic, boot_id=None, *, job_id=None):
    validate_plan(ctx, record, clock, boot_id)
    parsed = parse_version3(stream)
    actions = match_actions(record['plan']['packages'], parsed)
    current = {(n, a): v for n, a, v in record['inventory']['installed']}
    for action in parsed:
        previous, old_arch = _installed_identity(current, record['inventory']['config'], action['name'], action['architecture'])
        if action['installed'] != previous or action['installedArchitecture'] != old_arch:
            _bad()
    from urllib.parse import unquote_to_bytes
    feed_config = {}
    try:
        for line in stream.splitlines()[1:stream.splitlines().index('')]:
            key, value = (unquote_to_bytes(v).decode('utf-8', errors='strict') for v in line.split('=', 1))
            feed_config.setdefault(key, []).append(value)
    except (UnicodeError, ValueError):
        fail('unsafe_config')
    baseline = '\n'.join(k + ' ' + _quote(v) + ';' for k, values in record['inventory']['config'].items() for v in values)
    expected = parse_config(overlay_config_dump(baseline, make_overlay(record, job_id)))
    config_policy('\n'.join(k + ' ' + _quote(v) + ';' for k, values in feed_config.items() for v in values), with_guard=True)
    # APT adds invocation metadata and the fixed CLI safety options. All other
    # values, especially hook order and protocol descriptors, must be unchanged.
    dynamic = {'commandline::asstring', 'binary', 'apt::get::assume-yes', 'apt::get::remove',
               'apt::get::allowunauthenticated', 'acquire::allowinsecurerepositories',
               'acquire::allowdowngradetoinsecurerepositories', 'apt::get::allow-downgrades',
               'apt::get::allow-change-held-packages', 'dpkg::lock::timeout', 'dpkg::options::'}
    def normalized(config):
        return {k.lower(): [v for v in values if v] for k, values in config.items()
                if k.lower() not in dynamic and any(values)}
    if normalized(feed_config) != normalized(expected):
        fail('unsafe_config')
    if any(v != 'apt-get' for k, values in feed_config.items() if k.lower() == 'binary' for v in values):
        fail('unsafe_config')
    cache = ctx.path('/var/cache/apt/archives')
    # Check each ancestor: a protected leaf reached through a writable parent is unsafe.
    for directory in (cache, *cache.parents):
        if directory == ctx.root.parent:
            break
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != ctx.owner or info.st_mode & 0o022:
            fail('unsafe_files')
        if directory == ctx.root:
            break
    for action in actions:
        verify_archive(action, str(cache), ctx.run, owner=ctx.owner)
    ctx.events('Locked APT action and archive checks passed.')


def verify_installed(ctx, record):
    versions = installed(ctx)
    if ctx.run(['/usr/bin/dpkg', '--audit']).strip() or any(
            versions.get((p['name'], p['architecture'])) != p['candidate'] for p in record['plan']['packages']):
        fail('verification_failed')

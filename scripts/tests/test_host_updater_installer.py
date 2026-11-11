import base64
import importlib.util
import json
import os
import pathlib
import struct
import tempfile
import unittest
import subprocess


def load():
    path = pathlib.Path(__file__).resolve().parents[1] / 'install-host-updater.py'
    spec = importlib.util.spec_from_file_location('host_updater_installer', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.mod = load()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.key = 'ssh-ed25519 ' + base64.b64encode(struct.pack('>I', 11) + b'ssh-ed25519' + struct.pack('>I', 32) + b'x' * 32).decode()
        self.sshd = 'acceptenv LANG LC_*\npermituserenvironment no\nauthorizedkeyscommand none\nforcecommand none\npubkeyauthentication yes\npermitrootlogin prohibit-password\nauthorizedkeysfile .ssh/authorized_keys .ssh/authorized_keys2\nhostkeyalgorithms ssh-ed25519,rsa-sha2-512\n'
        for path, value in {'etc/ssh/sshd_config': '# standard\n', 'etc/ssh/ssh_host_ed25519_key.pub': self.key + '\n',
                            'root/.ssh/authorized_keys': '# keep existing administrator keys\n', 'etc/pve/local/nodename': 'pve'}.items():
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(value)
        self.downloads, self.calls = [], []
        self.installer = self.mod.Installer(root=self.root, owner=os.getuid(), fetch=self.fetch, runner=self.run_command,
                                            node='pve', check_host=lambda: None)

    def fetch(self, url):
        self.downloads.append(url)
        if 'api.github.com' in url:
            return json.dumps({'sha': 'a' * 40}).encode()
        return b'# fixture source\n'

    def run_command(self, argv, **kwargs):
        self.calls.append(argv)
        if argv[0] == '/usr/sbin/sshd':
            return self.sshd
        if argv[0] == '/usr/bin/perl':
            data = json.loads(kwargs['input'])
            target = self.root / 'etc/pve/priv/authorized_keys'
            self.assertEqual(target.read_text(), data['before'])
            target.write_text(data['after'])
            return ''
        raise AssertionError(argv)

    def test_local_enrollment_is_restricted_node_bound_and_idempotent(self):
        result = self.installer.install(self.key, 'main')
        target = self.root / 'root/.ssh/authorized_keys'
        text = target.read_text()
        self.assertIn('# keep existing administrator keys', text)
        self.assertIn('restrict,command="/usr/bin/python3 -I /usr/local/lib/proxmiu/host-updater --rpc --node pve"', text)
        self.assertNotIn('environment=', text)
        self.assertTrue(result['fingerprint'].startswith('SHA256:'))
        self.installer.install(self.key, 'main')
        self.assertEqual(target.read_text(), text)
        for url in self.downloads:
            if 'raw.githubusercontent.com' in url:
                self.assertIn('/' + 'a' * 40 + '/scripts/', url)
        self.assertEqual((self.root / 'usr/local/lib/proxmiu/host-updater').stat().st_mode & 0o777, 0o755)

    def test_cluster_symlink_preserves_target_and_uses_cluster_lock(self):
        target = self.root / 'root/.ssh/authorized_keys'
        cluster = self.root / 'etc/pve/priv/authorized_keys'
        cluster.parent.mkdir(parents=True)
        cluster.write_text(target.read_text())
        target.unlink()
        target.symlink_to(cluster)
        self.installer.install(self.key, 'a' * 40)
        self.assertTrue(target.is_symlink())
        self.assertIn(self.key, cluster.read_text())
        self.assertTrue(any(a[0] == '/usr/bin/perl' for a in self.calls))

    def test_conflicting_key_and_unsafe_ssh_policies_fail_without_enrollment(self):
        target = self.root / 'root/.ssh/authorized_keys'
        target.write_text(self.key + '\n')
        with self.assertRaises(self.mod.InstallError):
            self.installer.install(self.key, 'main')
        target.write_text('# original\n')
        for extra in ['acceptenv BASH_ENV', 'permituserenvironment yes', 'forcecommand /bin/sh', 'authorizedkeyscommand /other',
                      'permitrootlogin no', 'authorizedkeysfile /other/keyfile']:
            old = self.sshd
            key = extra.split()[0]
            self.sshd = '\n'.join(line for line in old.splitlines() if not line.startswith(key + ' ')) + '\n' + extra + '\n'
            with self.subTest(extra=extra), self.assertRaises(self.mod.InstallError):
                self.installer.install(self.key, 'main')
            self.assertEqual(target.read_text(), '# original\n')
            self.sshd = old
        (self.root / 'etc/ssh/sshd_config').write_text('Match User root\n AcceptEnv BASH_ENV\n')
        with self.assertRaises(self.mod.InstallError):
            self.installer.install(self.key, 'main')
        (self.root / 'etc/ssh/sshd_config').write_text('Match=Address 192.0.2.0/24\n AcceptEnv BASH_ENV\n')
        with self.assertRaises(self.mod.InstallError):
            self.installer.install(self.key, 'main')

    def test_download_failure_and_active_job_do_not_replace_helpers_or_enroll(self):
        target = self.root / 'root/.ssh/authorized_keys'
        original = target.read_text()
        self.installer.fetch = lambda url: (_ for _ in ()).throw(OSError('private download details'))
        with self.assertRaises(self.mod.InstallError):
            self.installer.install(self.key, 'main')
        self.assertEqual(target.read_text(), original)
        self.installer.fetch = self.fetch
        state = self.root / 'var/lib/proxmiu-host-updater/state.json'
        state.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        state.write_text(json.dumps({'active': 'b' * 32}))
        state.chmod(0o600)
        with self.assertRaises(self.mod.InstallError):
            self.installer.install(self.key, 'main')
        self.assertEqual(target.read_text(), original)

    def test_key_input_and_untrusted_paths_are_rejected(self):
        for key in [self.key + '\ncommand="sh"', 'ssh-rsa AAAA', 'ssh-ed25519 not-base64', 'ssh-ed25519 AAAA']:
            with self.subTest(key=key), self.assertRaises(self.mod.InstallError):
                self.installer.install(key, 'main')
        (self.root / 'root/.ssh').chmod(0o777)
        with self.assertRaises(self.mod.InstallError):
            self.installer.install(self.key, 'main')

    def test_perl_cluster_consumer_preserves_keys_on_lock_or_write_failure(self):
        modules = self.root / 'perl/PVE'
        modules.mkdir(parents=True)
        (modules / 'Cluster.pm').write_text('package PVE::Cluster; sub cfs_lock_domain { my ($name,$timeout,$cb)=@_; die "wrong domain" unless $name eq "proxmiu-updater-enroll"; if ($ENV{FAIL_LOCK}) { $@="no quorum"; return; } $cb->(); } 1;')
        (modules / 'Tools.pm').write_text('package PVE::Tools; sub file_set_contents { my ($p,$data,$mode)=@_; die "write failed" if $ENV{FAIL_WRITE}; open(my $f, ">", "$p.tmp") or die; print $f $data; close($f) or die; chmod($mode,"$p.tmp"); rename("$p.tmp",$p) or die; } 1;')
        target = self.root / 'cluster_keys'
        target.write_text('# administrator\n')
        code = self.mod.CLUSTER_WRITE.replace('/etc/pve/priv/authorized_keys', str(target))
        data = json.dumps({'before': target.read_text(), 'after': '# administrator\n' + self.key + '\n'})
        for flag in ['FAIL_LOCK', 'FAIL_WRITE']:
            result = subprocess.run(['/usr/bin/perl', '-I', str(modules.parent), '-e', code], input=data, text=True, capture_output=True,
                                    env={**self.mod.ENV, flag: '1'})
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(target.read_text(), '# administrator\n')
        result = subprocess.run(['/usr/bin/perl', '-I', str(modules.parent), '-e', code], input=data, text=True, capture_output=True, env=self.mod.ENV)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(target.read_text(), json.loads(data)['after'])

    @unittest.skipUnless(pathlib.Path('/usr/sbin/sshd').exists(), 'OpenSSH parser unavailable')
    def test_real_sshd_equals_syntax_cannot_hide_conditional_environment(self):
        hostkey = self.root / 'temporary_host_key'
        subprocess.run(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(hostkey)], check=True, capture_output=True)
        config = self.root / 'etc/ssh/sshd_config'
        config.write_text('HostKey ' + str(hostkey) + '\nUsePAM no\nAcceptEnv LANG LC_*\nMatch=Address 192.0.2.0/24\n AcceptEnv BASH_ENV\n')
        outputs = []
        for address in ['127.0.0.1', '192.0.2.1']:
            result = subprocess.run(['/usr/sbin/sshd', '-T', '-f', str(config), '-C', 'user=root,host=pve,addr=' + address],
                                    check=True, capture_output=True, text=True, env=self.mod.ENV)
            outputs.append(result.stdout)
        self.assertNotIn('acceptenv BASH_ENV', outputs[0])
        self.assertIn('acceptenv BASH_ENV', outputs[1])
        with self.assertRaises(self.mod.InstallError):
            self.installer.install(self.key, 'main')
        included = self.root / 'etc/ssh/conditional.conf'
        included.write_text('Match=Address 192.0.2.0/24\n AcceptEnv BASH_ENV\n')
        config.write_text('Include=/etc/ssh/conditional.conf\n')
        with self.assertRaises(self.mod.InstallError):
            self.installer.install(self.key, 'main')


if __name__ == '__main__':
    unittest.main()

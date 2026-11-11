import importlib.util
import pathlib
import unittest
import tempfile
import os
import json
import subprocess

PATH = pathlib.Path(__file__).resolve().parents[1] / 'host-updater-apt.py'
spec = importlib.util.spec_from_file_location('host_updater_apt', PATH)
apt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apt)


class ActionFeedTests(unittest.TestCase):
    def test_install_and_configure_with_arch_all(self):
        feed = ('VERSION 3\nAPT::Architecture=amd64\n\n'
                'docs 1.0 all foreign < 2.0 all foreign /var/cache/apt/archives/docs_2.0_all.deb\n'
                'docs 1.0 all foreign < 2.0 all foreign **CONFIGURE**\n')
        actions = apt.parse_version3(feed)
        self.assertEqual([a['action'] for a in actions], ['install', 'configure'])
        self.assertEqual(actions[0]['architecture'], 'all')
        self.assertEqual(actions[0]['candidate'], '2.0')

    def test_bad_feeds_fail_closed(self):
        bad = ['VERSION 2\n\n', 'VERSION 3\nno separator',
               'VERSION 3\n\npkg - - none < 1 amd64 none **REMOVE**\n',
               'VERSION 3\n\npkg 2 amd64 none > 1 amd64 none /a.deb\n',
               'VERSION 3\n\npkg - - none < 1 amd64 none /a.deb extra\n',
               'VERSION 3\n\npkg - - none < 1 amd64 none **ERROR**\n']
        for feed in bad:
            with self.subTest(feed=feed), self.assertRaises(apt.UpdaterError):
                apt.parse_version3(feed)

    def test_action_set_must_match_exactly(self):
        plan = [{'name': 'docs', 'architecture': 'all', 'installed': '1.0', 'candidate': '2.0'}]
        install = 'docs 1.0 all foreign < 2.0 all foreign /var/cache/apt/archives/docs.deb\n'
        configure = 'docs 1.0 all foreign < 2.0 all foreign **CONFIGURE**\n'
        apt.match_actions(plan, apt.parse_version3('VERSION 3\n\n' + install + configure))
        for rows in [install + install, configure, install + configure + configure,
                     install + 'other - - none < 1 amd64 none **CONFIGURE**\n']:
            with self.subTest(rows=rows), self.assertRaises(apt.UpdaterError):
                apt.match_actions(plan, apt.parse_version3('VERSION 3\n\n' + rows))

class ArchiveTests(unittest.TestCase):
    def test_archive_identity_and_symlink_rejection(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root) / 'docs.deb'
            path.write_bytes(b'fixture')
            calls = []
            def runner(argv, pass_fds):
                calls.append((argv, pass_fds))
                self.assertEqual(os.pread(pass_fds[0], 7, 0), b'fixture')
                return {'Package': 'docs\n', 'Version': '2.0\n', 'Architecture': 'all\n'}[argv[-1]]
            action = {'archive': str(path), 'name': 'docs', 'candidate': '2.0', 'architecture': 'all'}
            apt.verify_archive(action, root, runner, owner=os.getuid())
            self.assertEqual(calls[0][0][:2], ['/usr/bin/dpkg-deb', '--field'])
            with self.assertRaises(apt.UpdaterError):
                apt.verify_archive(dict(action, candidate='3.0'), root, runner, owner=os.getuid())
            link = pathlib.Path(root) / 'link.deb'
            link.symlink_to(path)
            with self.assertRaises(apt.UpdaterError):
                apt.verify_archive(dict(action, archive=str(link)), root, runner, owner=os.getuid())
            with self.assertRaises(apt.UpdaterError):
                apt.verify_archive(dict(action, archive=str(pathlib.Path(root).parent / 'other.deb')), root, runner, owner=os.getuid())


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        for name, value in {
            'etc/os-release': 'ID=debian\nVERSION_CODENAME=bookworm\n',
            'etc/machine-id': 'a' * 32 + '\n',
            'etc/apt/sources.list': 'deb [signed-by=/usr/share/keyrings/debian.gpg] https://deb.debian.org/debian bookworm main\n',
            'usr/share/keyrings/debian.gpg': 'keyring',
            'var/lib/dpkg/status': 'fixture status',
            'var/lib/apt/lists/example_Packages': 'fixture packages',
        }.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value)
        self.commands = []
        self.config = 'APT::Architecture "amd64";\nDPkg::Pre-Install-Pkgs:: "/usr/sbin/dpkg-preconfigure --apt || true";\nDPkg::Tools::Options::/usr/sbin/dpkg-preconfigure::Version "2";\n'
        self.installed = 'pve-manager\t8.2.7\tamd64\tii \nproxmox-ve\t8.2.0\tall\tii \ndocs\t1.0\tall\tii \n'
        self.simulation = 'Reading package lists...\nInst docs [1.0] (2.0 Debian:12/bookworm [all])\nConf docs (2.0 Debian:12/bookworm [all])\n'
        self.holds = ''
        self.audit = ''
        self.failed_refresh = False
        self.ctx = apt.AptContext(root=self.root, runner=self.run_command, owner=os.getuid())

    def run_command(self, argv, **kwargs):
        self.commands.append((argv, kwargs))
        if argv[0] == '/usr/bin/dpkg-query':
            return self.installed
        if argv[:2] == ['/usr/bin/dpkg', '--audit']:
            return self.audit
        if argv[:2] == ['/usr/bin/dpkg', '--get-selections']:
            return 'docs\tinstall\npve-manager\tinstall\nproxmox-ve\tinstall\n'
        if argv[:2] == ['/usr/bin/apt-mark', 'showhold']:
            return self.holds
        if argv[0] == '/usr/bin/apt-config':
            config = self.config
            if '-c' in argv:
                overlay = pathlib.Path(argv[argv.index('-c') + 1]).read_text()
                return apt.overlay_config_dump(config, overlay)
            return config
        if argv[0] == '/usr/bin/apt-cache':
            return 'Package: docs\nVersion: 2.0\nArchitecture: all\n\n'
        if argv[0] == '/usr/bin/apt-get':
            if 'update' in argv:
                if self.failed_refresh:
                    raise apt.UpdaterError('command_failed', 'Package operation failed.')
                return ''
            if '-s' in argv:
                return self.simulation
            return ''
        if argv[:2] == ['/usr/bin/dpkg', '--compare-versions']:
            if argv[2] == '2.0' and argv[3] == 'lt':
                return 'false'
            return 'true'
        raise AssertionError(argv)

    def plan(self):
        return apt.build_plan(self.ctx, 'a' * 32, lambda: 100.0, 'boot')

    def test_inspect_is_readonly_and_checks_supported_host(self):
        info = apt.inspect_host(self.ctx)
        self.assertTrue(info['ready'])
        self.assertEqual(info['proxmoxMajor'], 8)
        self.assertEqual(info['codename'], 'bookworm')
        self.assertFalse(any(call[0][0] == '/usr/bin/apt-get' for call in self.commands))
        for version, codename in [('10.0', 'bookworm'), ('8.2.7', 'trixie')]:
            self.installed = self.installed.replace('8.2.7', version)
            (self.root / 'etc/os-release').write_text('ID=debian\nVERSION_CODENAME=' + codename + '\n')
            self.assertFalse(apt.inspect_host(self.ctx)['ready'])

    def test_sources_list_and_deb822_policy(self):
        good = ['deb https://deb.debian.org/debian bookworm main',
                'deb https://deb.nodesource.com/node_22.x nodistro main',
                'Types: deb\nURIs: https://deb.debian.org/debian\nSuites: bookworm bookworm-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian.gpg\n',
                'Enabled: no\nTypes: deb\nURIs: https://example.invalid\nSuites: stable\nComponents: main\n']
        for source in good:
            apt.parse_sources(source, 'sources' if 'Types:' in source else 'list', 'bookworm')
        for source in ['deb https://example.invalid stable main', 'deb [trusted=yes] https://example.invalid bookworm main',
                       'deb [allow-insecure=yes] https://example.invalid bookworm main', 'deb https://example.invalid trixie main',
                       'garbage', 'Types: deb\nURIs: https://x\nSuites: bookworm\nTrusted: yes\nComponents: main\n']:
            with self.subTest(source=source), self.assertRaises(apt.UpdaterError):
                apt.parse_sources(source, 'sources' if 'Types:' in source else 'list', 'bookworm')

    def test_check_plan_preserves_all_architecture_and_exact_versions(self):
        record = self.plan()
        self.assertEqual(record['plan']['packages'], [{'name': 'docs', 'architecture': 'all', 'installed': '1.0', 'candidate': '2.0'}])
        self.assertEqual(len(record['plan']['digest']), 64)
        self.assertIn('APT::Update::Error-Mode=any', next(a for a, _ in self.commands if 'update' in a))
        apt.validate_plan(self.ctx, record, lambda: 101, 'boot')

    def test_refresh_unhealthy_holds_removals_and_major_drift_fail_closed(self):
        for field, value in [('failed_refresh', True), ('audit', 'broken package'), ('holds', 'docs\n'),
                             ('simulation', 'Remv docs [1.0]\n'), ('simulation', 'Inst pve-manager [8.2.7] (9.0 Debian [amd64])\n'),
                             ('simulation', 'Inst docs [1.0] (bad syntax)\n')]:
            old = getattr(self, field)
            setattr(self, field, value)
            with self.subTest(field=field, value=value), self.assertRaises(apt.UpdaterError):
                self.plan()
            setattr(self, field, old)

    def test_expiry_boot_and_all_inventory_drift_block_apply(self):
        record = self.plan()
        for clock, boot in [(lambda: 701, 'boot'), (lambda: 99, 'boot'), (lambda: 101, 'other')]:
            with self.assertRaises(apt.UpdaterError):
                apt.validate_plan(self.ctx, record, clock, boot)
        for name in ['etc/apt/sources.list', 'var/lib/dpkg/status', 'var/lib/apt/lists/example_Packages', 'usr/share/keyrings/debian.gpg']:
            path = self.root / name
            old = path.read_text()
            path.write_text(old + '\nchanged')
            with self.subTest(name=name), self.assertRaises(apt.UpdaterError):
                apt.validate_plan(self.ctx, record, lambda: 101, 'boot')
            path.write_text(old)

    def test_unsafe_apt_configuration_is_refused(self):
        for line in ['DPkg::Pre-Invoke:: "anything";', 'Binary::apt-get::DPkg::Pre-Install-Pkgs:: "anything";',
                     'Dir::State::status "/other/status";', 'Dir::Bin::dpkg "/other/dpkg";', 'APT::Get::AllowUnauthenticated "true";',
                     'RootDir "/tmp/alternate-root";', 'DPkg::Path "/tmp/user-bin:/usr/bin";',
                     'Dir::State::extended_states "/tmp/states";', 'Dir::Cache::pkgcache "/tmp/cache";']:
            old = self.config
            self.config += line + '\n'
            with self.subTest(line=line), self.assertRaises(apt.UpdaterError):
                self.plan()
            self.config = old

    def test_apply_overlay_guard_runs_first_and_preserves_hook_options(self):
        record = self.plan()
        apt.apply_plan(self.ctx, record, 'b' * 32, lambda: 101, 'boot')
        argv = next(a for a, _ in self.commands if a[0] == '/usr/bin/apt-get' and 'install' in a)
        self.assertIn('docs:all=2.0', argv)
        self.assertIn('--no-remove', argv)
        overlay = pathlib.Path(argv[argv.index('-c') + 1]).read_text()
        self.assertTrue(overlay.startswith('#clear DPkg::Pre-Install-Pkgs;'))
        self.assertLess(overlay.index('host-updater-apt-guard'), overlay.index('/usr/sbin/dpkg-preconfigure'))
        self.assertIn('InfoFD "0"', overlay)
        self.assertEqual(apt.parse_config(apt.overlay_config_dump(self.config, overlay))['DPkg::Tools::Options::/usr/sbin/dpkg-preconfigure::Version'], ['2'])

    def test_install_success_requires_exact_installed_versions_and_healthy_dpkg(self):
        record = self.plan()
        with self.assertRaises(apt.UpdaterError):
            apt.verify_installed(self.ctx, record)
        self.installed = self.installed.replace('docs\t1.0', 'docs\t2.0')
        apt.verify_installed(self.ctx, record)
        self.audit = 'broken'
        with self.assertRaises(apt.UpdaterError):
            apt.verify_installed(self.ctx, record)

    def test_guard_checks_feed_configuration_archives_and_late_drift(self):
        from urllib.parse import quote
        record = self.plan()
        job = 'b' * 32
        cache = self.root / 'var/cache/apt/archives'
        cache.mkdir(parents=True)
        archive = cache / 'docs.deb'
        archive.write_bytes(b'archive fixture')
        original_runner = self.ctx.run
        def runner(argv, **kwargs):
            if argv[0] == '/usr/bin/dpkg-deb':
                return {'Package': 'docs\n', 'Version': '2.0\n', 'Architecture': 'all\n'}[argv[-1]]
            return original_runner(argv, **kwargs)
        self.ctx.run = runner
        effective = apt.overlay_config_dump(self.config, apt.make_overlay(record, job))
        def feed(config):
            headers = [quote(k, safe='/:') + '=' + quote(v, safe='/: =;|"') for k, values in apt.parse_config(config).items() for v in values if v]
            return 'VERSION 3\n' + '\n'.join(headers) + '\n\n' + 'docs 1.0 all foreign < 2.0 all foreign ' + str(archive) + '\n'
        apt.guard(self.ctx, record, feed(effective), lambda: 101, 'boot', job_id=job)
        for bad in [effective.replace('InfoFD "0"', 'InfoFD "2"'), effective.replace(apt.GUARD + ' ' + job, apt.GUARD + ' ' + 'c' * 32),
                    effective + 'DPkg::Pre-Invoke:: "unreviewed";\n', effective + 'APT::Get::AllowUnauthenticated "true";\n']:
            with self.subTest(config=bad), self.assertRaises(apt.UpdaterError):
                apt.guard(self.ctx, record, feed(bad), lambda: 101, 'boot', job_id=job)
        archive.chmod(0o666)
        with self.assertRaises(apt.UpdaterError):
            apt.guard(self.ctx, record, feed(effective), lambda: 101, 'boot', job_id=job)
        archive.chmod(0o644)
        self.audit = 'unexpected pending state'
        with self.assertRaises(apt.UpdaterError):
            apt.guard(self.ctx, record, feed(effective), lambda: 101, 'boot', job_id=job)

    def test_protected_standard_os_release_symlink_and_held_installed_packages(self):
        destination = self.root / 'usr/lib/os-release'
        destination.parent.mkdir(parents=True)
        original = self.root / 'etc/os-release'
        destination.write_text(original.read_text())
        original.unlink()
        original.symlink_to('../usr/lib/os-release')
        self.installed = self.installed.replace('docs\t1.0\tall\tii ', 'docs\t1.0\tall\thi ')
        self.assertTrue(apt.inspect_host(self.ctx)['ready'])

    def test_version_order_matches_debian_rules(self):
        for left, right in [('1.0~rc1', '1.0'), ('1.0-1', '1.0-2'), ('1:0.1', '2:0.0'), ('1.09', '1.10'), ('1.0+a', '1.0.b')]:
            self.assertLess(apt.compare_versions(left, right), 0)
            self.assertGreater(apt.compare_versions(right, left), 0)
        self.assertEqual(apt.compare_versions('1.0', '1.0-0'), 0)

    def test_new_dependencies_are_explicit_and_complete_plan_limits_refuse(self):
        previous = self.ctx.run
        def runner(argv, **kwargs):
            if argv[0] == '/usr/bin/apt-cache':
                name, candidate = argv[-1].split('=')
                return f'Package: {name}\nVersion: {candidate}\nArchitecture: all\n\n'
            return previous(argv, **kwargs)
        self.ctx.run = runner
        self.simulation = 'Inst new-dependency (2.0 Debian:12/bookworm [all])\n'
        self.assertIsNone(self.plan()['plan']['packages'][0]['installed'])
        self.simulation = ''.join(f'Inst extra-{i:04d} (2.0 Debian:12/bookworm [all])\n' for i in range(2001))
        with self.assertRaises(apt.UpdaterError) as error:
            self.plan()
        self.assertEqual(error.exception.code, 'plan_too_large')
        self.simulation = ''.join(f'Inst extra-{i:04d} (2.' + '0' * 180 + ' Debian:12/bookworm [all])\n' for i in range(500))
        with self.assertRaises(apt.UpdaterError) as error:
            self.plan()
        self.assertEqual(error.exception.code, 'plan_too_large')

    @unittest.skipUnless(pathlib.Path('/usr/bin/apt-config').exists(), 'APT configuration consumer is Linux-only')
    def test_real_apt_config_defaults_and_late_overlay_consumer(self):
        initial = self.root / 'fixture-apt.conf'
        initial.write_text('Dir::Etc::main "-";\nDir::Etc::parts "-";\n' + self.config)
        environment = {**apt.ENV, 'APT_CONFIG': str(initial)}
        baseline = subprocess.check_output(['/usr/bin/apt-config', 'dump'], env=environment, text=True)
        # Test-only parts/main routing is not a supported production override.
        self.config = baseline.replace('Dir::Etc::main "-";', 'Dir::Etc::main "apt.conf";').replace('Dir::Etc::parts "-";', 'Dir::Etc::parts "apt.conf.d";')
        record = self.plan()
        overlay = self.root / 'late.conf'
        overlay.write_text(apt.make_overlay(record, 'b' * 32))
        actual = subprocess.check_output(['/usr/bin/apt-config', '-c', str(overlay), 'dump'], env=environment, text=True)
        actual = actual.replace('Dir::Etc::main "-";', 'Dir::Etc::main "apt.conf";').replace('Dir::Etc::parts "-";', 'Dir::Etc::parts "apt.conf.d";')
        expected = apt.overlay_config_dump(self.config, overlay.read_text())
        self.assertEqual(apt.comparable_config(apt.parse_config(actual)), apt.comparable_config(apt.parse_config(expected)))


if __name__ == '__main__':
    unittest.main()

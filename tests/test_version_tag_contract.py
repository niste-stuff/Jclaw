# tests/test_version_tag_contract.py
from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / 'scripts' / 'check-version-matches-tag.sh'


class VersionTagContractTests(unittest.TestCase):
    def _run(self, tag: str, cargo_toml_version: str) -> subprocess.CompletedProcess[str]:
        with tempfile.NamedTemporaryFile('w', suffix='.toml', delete=False) as f:
            f.write(f'[workspace.package]\nversion = "{cargo_toml_version}"\nedition = "2021"\n')
            fixture_path = f.name
        try:
            env = os.environ.copy()
            env['JCLAW_CARGO_TOML_OVERRIDE'] = fixture_path
            return subprocess.run(
                ['bash', str(SCRIPT), tag],
                cwd=REPO_ROOT,
                env=env,
                capture_output=True,
                text=True,
            )
        finally:
            os.unlink(fixture_path)

    def test_matching_version_and_tag_exits_zero(self) -> None:
        result = self._run('v0.2.0-beta.5', '0.2.0-beta.5')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn('OK', result.stdout)

    def test_mismatched_version_exits_nonzero_with_diagnostic(self) -> None:
        result = self._run('v0.2.0-beta.5', '0.1.3')
        self.assertNotEqual(0, result.returncode)
        self.assertIn('version mismatch', result.stderr)
        self.assertIn('0.1.3', result.stderr)
        self.assertIn('0.2.0-beta.5', result.stderr)

    def test_missing_tag_argument_exits_nonzero(self) -> None:
        result = subprocess.run(
            ['bash', str(SCRIPT)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(0, result.returncode)


if __name__ == '__main__':
    unittest.main()

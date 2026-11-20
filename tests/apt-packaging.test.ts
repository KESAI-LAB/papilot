import test from 'node:test';
import assert from 'node:assert/strict';
import { aptPublication } from '../scripts/publish-apt.mts';

test('APT publishing is idempotent and preserves the newest stable package', () => {
  const checksum = 'a'.repeat(64);
  const uploaded = (version: string, digest = checksum, status = 4) => ({
    version, checksum_sha256: digest, name: 'papilot-desktop', format: 'deb', status, slug_perm: 'pkg123',
    indexed: status === 4, is_downloadable: status === 4, is_hidden: false, is_quarantined: false,
  });
  assert.deepEqual(aptPublication([], '0.12.1', checksum), { state: 'upload' });
  assert.deepEqual(aptPublication([uploaded('0.12.0')], '0.12.1', checksum), { state: 'upload' });
  assert.deepEqual(aptPublication([uploaded('0.12.1')], '0.12.1', checksum), { state: 'current' });
  assert.deepEqual(aptPublication([uploaded('0.12.10')], '0.12.2', checksum), { state: 'older' });
  assert.deepEqual(aptPublication([uploaded('0.12.10', checksum, 5)], '0.12.2', checksum), { state: 'upload' });
  assert.deepEqual(aptPublication([{ ...uploaded('0.12.10'), is_hidden: true }], '0.12.2', checksum), { state: 'upload' });
  assert.throws(() => aptPublication([{ ...uploaded('0.12.1'), is_quarantined: true }], '0.12.1', checksum), /hidden or quarantined/);
  assert.deepEqual(aptPublication([uploaded('0.12.1', checksum, 3)], '0.12.1', checksum), { state: 'syncing' });
  assert.deepEqual(aptPublication([uploaded('0.12.1', checksum, 5)], '0.12.1', checksum), { state: 'resync', id: 'pkg123' });
  assert.throws(() => aptPublication([uploaded('0.12.1', 'b'.repeat(64))], '0.12.1', checksum), /different checksum/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { aurAsset, renderAurRecipe } from '../scripts/prepare-aur.mts';

test('AUR packaging uses a complete stable release and binds its checksum to the exact version', () => {
  const tag = 'v0.12.1', manifest = JSON.stringify({ version: '0.12.1' });
  const digest = 'a'.repeat(64);
  const release = { tagName: tag, isDraft: false, isPrerelease: false, publishedAt: '2026-11-20T00:00:00Z', assets: [
    { name: 'desktop.json', state: 'uploaded', size: 192, digest: 'sha256:' + createHash('sha256').update(manifest).digest('hex') },
    { name: 'Papilot-0.12.1-linux-amd64.deb', state: 'uploaded', size: 185_000_000, digest: 'sha256:' + digest },
  ] };
  const packageAsset = aurAsset(tag, release, manifest);
  assert.deepEqual(packageAsset, { version: '0.12.1', sha256: digest });
  assert.throws(() => aurAsset('v0.12.1-dev', release, manifest), /stable release tag/);
  assert.throws(() => aurAsset(tag, { ...release, isPrerelease: true }, manifest), /not been published/);
  assert.throws(() => aurAsset(tag, { ...release, assets: release.assets.slice(1) }, manifest), /desktop.json/);
  assert.throws(() => aurAsset(tag, { ...release, assets: release.assets.slice(0, 1) }, manifest), /linux-amd64.deb/);
  assert.throws(() => aurAsset(tag, release, JSON.stringify({ version: '0.12.2' })), /manifest does not match/);
  const recipe = fs.readFileSync(new URL('../packaging/aur/PKGBUILD', import.meta.url), 'utf8');
  const changed = renderAurRecipe(recipe, packageAsset.version, packageAsset.sha256);
  assert.match(changed, /^pkgver=0\.12\.1$/m);
  assert.match(changed, new RegExp(`^sha256sums=\\('${digest}'`, 'm'));
  assert.equal(renderAurRecipe(changed, packageAsset.version, packageAsset.sha256), changed);
});

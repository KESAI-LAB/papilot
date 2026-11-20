import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { stableLinuxAsset } from './stable-linux-release.mts';

interface CloudPackage {
  version: string;
  checksum_sha256: string;
  name: string;
  format: string;
  status: number;
  slug_perm: string;
  indexed: boolean;
  is_downloadable: boolean;
  is_hidden: boolean;
  is_quarantined: boolean;
}

const completed = 4;
const failedSync = 5;
const visible = (item: CloudPackage) => item.status === completed && item.indexed &&
  item.is_downloadable && !item.is_hidden && !item.is_quarantined;

export function aptPublication(packages: CloudPackage[], version: string, sha256: string) {
  const stable = packages.filter((item) => item.name === 'papilot-desktop' && item.format === 'deb' &&
    /^\d+\.\d+\.\d+$/.test(item.version));
  const newer = stable.some((item) => {
    if (!visible(item)) return false;
    const incoming = version.split('.').map(Number), existing = item.version.split('.').map(Number);
    const firstDifference = existing.findIndex((value, index) => value !== incoming[index]);
    return firstDifference >= 0 && existing[firstDifference] > incoming[firstDifference];
  });
  if (newer) return { state: 'older' };
  const existing = stable.filter((item) => item.version === version);
  if (existing.some((item) => item.checksum_sha256 !== sha256))
    throw new Error('This APT version already exists with a different checksum.');
  if (existing.some(visible)) return { state: 'current' };
  if (existing.some((item) => item.is_hidden || item.is_quarantined))
    throw new Error('This APT version is hidden or quarantined. Review it in Cloudsmith before publishing.');
  if (existing.some((item) => item.status !== failedSync)) return { state: 'syncing' };
  const failed = existing[0];
  return failed ? { state: 'resync', id: failed.slug_perm } : { state: 'upload' };
}

async function publishedPackages(workspace: string, repository: string, key: string) {
  const result: CloudPackage[] = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ query: 'name:papilot-desktop format:deb', page: String(page), page_size: '100' });
    const response = await fetch(`https://api.cloudsmith.io/v1/packages/${workspace}/${repository}/?${query}`, {
      headers: { 'X-Api-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Cloudsmith package lookup failed (HTTP ${response.status}).`);
    const packages = await response.json() as CloudPackage[];
    if (!Array.isArray(packages)) throw new Error('Invalid Cloudsmith package list.');
    result.push(...packages);
    if (packages.length < 100) return result;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tag, metadataFile, manifestFile, artifact] = process.argv.slice(2);
  const workspace = process.env.CLOUDSMITH_WORKSPACE || '';
  const repository = process.env.CLOUDSMITH_REPOSITORY || '';
  const key = process.env.CLOUDSMITH_API_KEY;
  if (!artifact || !key || ![workspace, repository].every((value) => /^[a-z0-9][a-z0-9_-]*$/.test(value)))
    throw new Error('Configure the Cloudsmith repository and its publish credential.');
  const { version, sha256 } = stableLinuxAsset(tag, JSON.parse(fs.readFileSync(metadataFile, 'utf8')), fs.readFileSync(manifestFile));
  const actual = createHash('sha256');
  for await (const chunk of fs.createReadStream(artifact)) actual.update(chunk);
  if (actual.digest('hex') !== sha256) throw new Error('The downloaded installer checksum does not match.');
  const field = (name: string) => execFileSync('dpkg-deb', ['-f', artifact, name], { encoding: 'utf8' }).trim();
  if (field('Package') !== 'papilot-desktop' || field('Architecture') !== 'amd64' ||
      field('Version') !== version || !field('Provides').split(/,\s*/).includes('papilot'))
    throw new Error('The Debian installer does not provide the expected APT package and version.');
  const result = aptPublication(await publishedPackages(workspace, repository, key), version, sha256);
  if (result.state === 'older') {
    console.log(`Skipped ${version}. A newer APT package is already available.`);
  } else {
    if (result.state === 'upload') {
      execFileSync('cloudsmith', ['push', 'deb', `${workspace}/${repository}/any-distro/any-version`, artifact], { stdio: 'inherit' });
    } else if (result.state === 'resync') {
      if (!result.id || !/^[a-z0-9]+$/i.test(result.id)) throw new Error('Invalid failed package identifier.');
      execFileSync('cloudsmith', ['resync', `${workspace}/${repository}/${result.id}`], { stdio: 'inherit' });
    }
    console.log(result.state === 'current' ? `APT already has Papilot ${version}.` : `Waiting for Papilot ${version} to appear in signed APT metadata.`);
  }
}

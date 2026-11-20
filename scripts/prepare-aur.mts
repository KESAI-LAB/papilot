import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

interface ReleaseAsset { name: string; state: string; size: number; digest: string }
interface Release {
  tagName: string;
  isDraft: boolean;
  isPrerelease: boolean;
  publishedAt: string | null;
  assets: ReleaseAsset[];
}
export function aurAsset(tag: string, release: Release, manifest: string | Buffer) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag))
    throw new Error('Use an exact stable release tag.');
  const version = tag.slice(1);
  if (release.tagName !== tag || release.isDraft !== false || release.isPrerelease !== false || !release.publishedAt)
    throw new Error('The stable GitHub release has not been published.');
  const asset = (name: string) => {
    const value = release.assets?.find((candidate) => candidate.name === name && candidate.state === 'uploaded');
    if (!value || value.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(value.digest))
      throw new Error(`Missing or incomplete release asset ${name}.`);
    return value.digest.slice('sha256:'.length);
  };
  const manifestDigest = asset('desktop.json');
  if (createHash('sha256').update(manifest).digest('hex') !== manifestDigest || JSON.parse(manifest.toString()).version !== version)
    throw new Error('The desktop manifest does not match the release.');
  return { version, sha256: asset(`Papilot-${version}-linux-amd64.deb`) };
}

export function renderAurRecipe(recipe: string, version: string, sha256: string) {
  return recipe
    .replace(/^pkgver=.*$/m, `pkgver=${version}`)
    .replace(/^pkgrel=.*$/m, 'pkgrel=1')
    .replace(/^sha256sums=\('[a-f0-9]{64}'/m, `sha256sums=('${sha256}'`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tag, metadataFile, manifestFile, output] = process.argv.slice(2);
  if (!output) throw new Error('Provide a tag, release JSON, desktop manifest and output directory.');
  const root = new URL('../packaging/aur/', import.meta.url);
  const { version, sha256 } = aurAsset(tag, JSON.parse(fs.readFileSync(metadataFile, 'utf8')), fs.readFileSync(manifestFile));
  const recipe = fs.readFileSync(new URL('PKGBUILD', root), 'utf8');
  fs.mkdirSync(output, { recursive: true });
  for (const name of ['papilot', 'LICENSE']) fs.copyFileSync(new URL(name, root), path.join(output, name));
  fs.writeFileSync(path.join(output, 'PKGBUILD'), renderAurRecipe(recipe, version, sha256));
}

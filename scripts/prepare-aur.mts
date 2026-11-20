import fs from 'node:fs';
import path from 'node:path';
import { stableLinuxAsset } from './stable-linux-release.mts';
import { pathToFileURL } from 'node:url';

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
  const { version, sha256 } = stableLinuxAsset(tag, JSON.parse(fs.readFileSync(metadataFile, 'utf8')), fs.readFileSync(manifestFile));
  const recipe = fs.readFileSync(new URL('PKGBUILD', root), 'utf8');
  fs.mkdirSync(output, { recursive: true });
  for (const name of ['papilot', 'LICENSE']) fs.copyFileSync(new URL(name, root), path.join(output, name));
  fs.writeFileSync(path.join(output, 'PKGBUILD'), renderAurRecipe(recipe, version, sha256));
}

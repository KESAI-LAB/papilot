# Arch Linux package

`papilot-bin` packages the official Papilot desktop build for x86_64 Arch Linux. After the first AUR publication, install as a normal user with:

```sh
git clone https://aur.archlinux.org/papilot-bin.git
cd papilot-bin
makepkg -si
```

An AUR helper can also install and upgrade the package, for example `paru -S papilot-bin`. Launch Papilot from the application menu or with `papilot`. Install a TeX distribution and `latexmk` on the host to compile manuscripts.

Use your AUR helper or rebuild from the updated recipe to upgrade. Papilot leaves application updates to the package manager and keeps agent downloads in your user data directory. Existing papers and settings remain available after an upgrade or uninstall.

## Maintainer setup

1. Sign in to the [AUR](https://aur.archlinux.org/) as the package maintainer and add the public half of a dedicated SSH key.
2. Set the Papilot repository's `AUR_SSH_PRIVATE_KEY` Actions secret to the matching private key and set the `AUR_KNOWN_HOSTS` repository variable to the verified AUR SSH host key. Verify the host key against Arch's published fingerprint before saving it.
3. Use the first stable release built with support for package-controlled desktop updates. The checked-in 0.12.0 recipe serves as a packaging fixture for pull requests.

After all native builds pass, the Release workflow uploads the tested artifacts, then starts Arch packaging. The Arch job verifies the version and artifact checksum, regenerates `.SRCINFO`, builds and installs the package, and launches the installed app. The publisher commits the same four recipe files to the AUR only after validation. A rerun skips a version that is already published or older than the current AUR package.

To retry the AUR step independently, run **Arch packaging** on the default branch with the exact published stable tag. Failed validation or a failed push leaves the existing AUR recipe available. The Actions summary reports the version or configuration status.

For a recipe change to the same upstream version, increment `pkgrel` and regenerate `.SRCINFO` with `makepkg --printsrcinfo` in Arch. Review the package before pushing the same-version packaging revision from the maintainer account.

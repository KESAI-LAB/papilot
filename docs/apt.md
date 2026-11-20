# Debian and Ubuntu package repository

After the repository is published, use its public URL and published signing-key fingerprint from the release announcement. Replace the workspace and repository placeholders below with the announced values. Ubuntu 22.04 amd64 is the first native test target. Debian and other Ubuntu versions need their own native install checks before being listed here.

```sh
base='https://dl.cloudsmith.io/public/WORKSPACE/REPOSITORY'
curl -fsS "$base/gpg.key" -o /tmp/papilot-signing.key
gpg --show-keys --with-fingerprint /tmp/papilot-signing.key
```

Check the full fingerprint against the published fingerprint before trusting the key. Then install with a repository-scoped keyring:

```sh
sudo install -d -m 755 /etc/apt/keyrings
sudo gpg --dearmor --output /etc/apt/keyrings/papilot.gpg /tmp/papilot-signing.key
sudo chmod 644 /etc/apt/keyrings/papilot.gpg
fingerprint='PUBLISHED_FULL_FINGERPRINT'
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/papilot.gpg,$fingerprint] $base/deb/ubuntu jammy main" |
  sudo tee /etc/apt/sources.list.d/papilot.list
sudo apt update
sudo apt install papilot
```

The concrete package is `papilot-desktop`; it provides `papilot`. Upgrade it with `sudo apt install --only-upgrade papilot-desktop`. The packaged app leaves application updates to APT and can still install agents into your user data. Projects and settings remain in the usual data directory.

## Maintainer setup

Use a Cloudsmith Open Source Broadcast for the MIT-licensed project. Cloudsmith provides signed Debian metadata, by-hash indexes and storage without a separate bucket or signing service. Its open-source policy lists at least 50 GB of artifact storage and 200 GB of delivery across open-source repositories and requires attribution. Verify the current terms before enabling publication. [Cloudsmith open-source policy](https://docs.cloudsmith.com/resources/open-source-hosting-policy)

Cloudsmith provides free package repository hosting under its [open-source policy](https://docs.cloudsmith.com/resources/open-source-hosting-policy).

1. Create a Cloudsmith repository and keep the package publishing account limited to that repository. Add its credential as `CLOUDSMITH_API_KEY` in GitHub Actions.
2. Set `CLOUDSMITH_WORKSPACE`, `CLOUDSMITH_REPOSITORY` and `CLOUDSMITH_KEY_FINGERPRINT`. Use the full uppercase signing-key fingerprint obtained from the Cloudsmith repository settings.
3. Keep released versions available for installations already reading an older signed index. Retire them only after the applicable metadata has aged out. When rotating the signing key, publish the new fingerprint and keyring instructions before switching the signing key.

The Release workflow calls **Publish APT package** after the tested installers and manifest are available. A repeated upload of the same version and checksum is skipped. Use the workflow’s manual dispatch with an existing stable tag to retry publication separately.

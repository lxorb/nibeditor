# Linux packaging

Four package managers. Three of them repackage what
`.github/workflows/release.yml` already publishes rather than rebuilding
nibeditor, so a release is a release everywhere and nothing can drift between
them. Flathub is the exception and has to be: it only takes a source-available
app that is compiled from source inside its own sandbox.

| Directory | Manager | Built from | Architectures |
| --- | --- | --- | --- |
| `aur/nib-bin/` | AUR (`yay -S nib-bin`) | the `.deb` | x86_64, aarch64 |
| `flathub/` | Flathub (`flatpak`) | source, in the sandbox | x86_64, aarch64 |
| `snap/` | Snap Store | the `.deb` | amd64, arm64 |
| `nix/` | a flake anyone can install from | the AppImage | x86_64, aarch64 |

`.github/workflows/validate-linux-packaging.yml` builds all four the way the
managers themselves do - `makepkg` in an Arch container, `flatpak-builder` plus
`flatpak-builder-lint` against the Flathub runtime, `snapcraft` in LXD, and
`nix build`. Run it after every release that changes packaging.

`.github/workflows/publish-linux.yml` pushes a published release out to the AUR
and the Snap Store. Both jobs build and then stop short of uploading until their
secrets exist, so the workflow is harmless while the accounts below do not.

`.github/workflows/publish.yml` does the same for winget, Scoop, Homebrew and
Chocolatey, and also skips every manager whose token is missing, so nothing is
pushed anywhere until `PACKAGING_TOKEN`, `WINGET_TOKEN` and
`CHOCOLATEY_API_KEY` are set as repository secrets.

## What Tauri's .deb gives us, and what it gets wrong

```
Depends: libwebkit2gtk-4.1-0, libgtk-3-0
usr/bin/nib
usr/share/applications/Nib.desktop
usr/share/icons/hicolor/{32x32,128x128,256x256@2}/apps/nib.png
```

The binary and the icons are fine. The rest is not, and every package here
repairs the same three things:

- **`Categories=` is empty**, so Nib lands in no menu category at all. Tauri
  derives it from `bundle.category` in `tauri.conf.json`, which is unset.
- **No `MimeType=` and no `%F` on `Exec=`**, so nothing offers Nib as a handler
  for a `.md` file even though the binary happily opens paths given to it. Tauri
  does not turn `bundle.fileAssociations` into a MIME type on Linux; only macOS
  and Windows get that.
- **The 256x256 icon is filed under `256x256@2`**, a scale-2 directory, where a
  256x256 image means "128 logical pixels at 2x" and every theme lookup scales
  it wrong. Tauri puts `128x128@2x.png` there by name rather than by size.

`Description:` in the control file is also literally `(none)` and `Maintainer:`
has no email address. Fixing this upstream means setting `bundle.category`,
`bundle.shortDescription`/`longDescription` and `bundle.publisher` in
`tauri.conf.json`; the MIME type would still have to be added by hand.

Each package therefore installs its own `.desktop` entry and moves the icon.
The three copies differ only where they have to: the Flatpak one is named after
the app ID and points `Icon=` at it, the snap one points `Icon=` at `${SNAP}`.

## AUR - `nib-bin`

`aur/nib-bin/` is the package base as the AUR wants it: `PKGBUILD`, the
generated `.SRCINFO`, and the `nib.desktop` that replaces Tauri's. It unpacks
the `.deb` with `bsdtar`, so installing Nib pulls in no Rust or Node toolchain.

`nib-bin` is unclaimed, and neither the official repositories nor the AUR has a
`nib`, so `provides=nib` and `conflicts=nib` are free. (`nib-git` in the AUR is
an unrelated, orphaned Python static site generator.)

### Steps to publish it - needs your account

The AUR has no organisation accounts and no way to delegate, so the account and
the key have to be yours.

1. Register at <https://aur.archlinux.org/register>. The form wants a username,
   an email address and an SSH **public** key; you can add the key later from
   *My Account*.
2. Make a key for this and nothing else. It must have no passphrase - a workflow
   cannot type one:

   ```
   ssh-keygen -t ed25519 -N "" -C "aur@nib" -f ~/.ssh/aur_nib
   ```

3. Paste the contents of `~/.ssh/aur_nib.pub` into *SSH Public Key* on
   <https://aur.archlinux.org/account/> and save.
4. Hand the private key and your account details to the repository:

   ```
   gh secret set AUR_USERNAME --repo lxorb/nibeditor --body "<your AUR username>"
   gh secret set AUR_EMAIL    --repo lxorb/nibeditor --body "<the email on the account>"
   gh secret set AUR_SSH_PRIVATE_KEY --repo lxorb/nibeditor < ~/.ssh/aur_nib
   ```

5. Publish the current release:

   ```
   gh workflow run publish-linux.yml --repo lxorb/nibeditor -f tag=v0.8.0
   ```

   The AUR creates the package base on first push, so there is nothing to
   register by hand. From then on every published release pushes itself.

If you would rather do the first push yourself:

```
git clone ssh://aur@aur.archlinux.org/nib-bin.git
cp packaging/aur/nib-bin/{PKGBUILD,.SRCINFO,nib.desktop} nib-bin/
cd nib-bin && git add -A && git commit -m "nib 0.8.0" && git push
```

## Flathub

`flathub/` holds a submission the way Flathub wants one: the manifest, the
AppStream metainfo, the desktop entry, and the two generated files that let the
whole thing build with no network.

**It builds from source, because it has to.** Flathub's requirements gained a
*Building from source* section on 2026-02-25:

> All source available submissions must be built entirely from source code.

nibeditor is AGPL, so it is a source-available submission, and a manifest that
unpacked the release `.deb` would be closed on sight. The Tauri apps on Flathub
that do exactly that were accepted before the date and are grandfathered, not
precedent. The exception clause covers well-known vendors with no offline build
tooling, which is not our case either way: the tooling exists.

### The two generated files

Nothing may be fetched while a Flathub build runs, so every crate and every npm
tarball is a source in the manifest. Two generators from
<https://github.com/flatpak/flatpak-builder-tools> write them:

```
python -m pip install aiohttp tomlkit yarl
python cargo/flatpak-cargo-generator.py apps/desktop/src-tauri/Cargo.lock \
  -o packaging/flathub/cargo-sources.json

pipx install "git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node"
flatpak-node-generator pnpm pnpm-lock.yaml -o packaging/flathub/node-sources.json
```

Both are large and mechanical, both belong to the same commit as the app, and
both have to be regenerated whenever either lockfile moves. Run them on Linux:
the node one writes the host's path separators into its output, and a build in
the sandbox cannot use Windows ones.

Only the desktop app is compiled. `tauri.conf.json` bundles no `externalBin`, so
there is no sidecar to vendor a third lockfile for; the MCP server is part of the
Worker under `services/sync/` and has nothing to do with the Flatpak.

### What the build does

The module unpacks the pnpm version the root `packageManager` field asks for,
installs `@nib/desktop` and the packages it is built from out of the offline
store, empties the updater's endpoints, builds the web assets with vite,
compiles the binary against the vendored crates, and installs the binary, the
icons, the desktop entry and the metainfo by hand.

`cargo build` rather than `tauri build`: the only thing the bundler would add is
a `.deb`, and nothing in it is used - Tauri's own desktop entry and icon layout
are the three things every package here repairs anyway.

**No self-updating.** A Flatpak is updated by Flathub, so the build leaves the
updater plugin with an empty endpoint list. The plugin stays configured, because
its public key is not optional and the app will not start without it, and an
empty list is what the app already treats as nothing new - the same as having no
network. `createUpdaterArtifacts` goes off with it.

Build and install it locally exactly the way the workflow does:

```
cd packaging/flathub
flatpak install -y flathub org.flatpak.Builder org.gnome.Platform//50 org.gnome.Sdk//50
flatpak run org.flatpak.Builder --force-clean --sandbox --user --install \
  --install-deps-from=flathub --repo=repo builddir ch.emilvinu.nib.yml
flatpak run ch.emilvinu.nib
```

`--sandbox` is the part that matters: it takes the network and the host
filesystem away from the build commands, which is the condition Flathub builds
under.

The manifest sets no `WEBKIT_DISABLE_DMABUF_RENDERER`, and does not need one:
the window comes up on the GNOME 50 runtime with `--device=dri` and nothing
else. If a blank window is ever reported on a proprietary driver, that variable
set to 1 in `finish-args` is the usual fix, and the reason other Tauri Flatpaks
carry it.

### What the linters say

`appstreamcli validate`, `desktop-file-validate`, `flatpak-builder-lint
manifest` and `flatpak-builder-lint appstream` all pass, and the built Flatpak
resolves every library it needs against `org.gnome.Platform//50`, which carries
`libwebkit2gtk-4.1.so.0` alongside the GTK4 flavour.

`flatpak-builder-lint repo` on a locally built repository reports exactly two
errors, `appstream-external-screenshot-url` and
`appstream-remote-icon-not-mirrored`. Neither is a defect: the composed
catalogue is complete - the screenshot is fetched, scaled into five thumbnails,
and the icons are both cached and remote - but the paths stay relative to the
`media_baseurl` attribute until Flathub's own build service rewrites them
absolute, and the linter skips both checks inside that pipeline. The validation
workflow asserts they are the only two errors rather than ignoring the check.

The screenshot itself is `docs/media/screenshot.png`, taken by
`apps/desktop/test/e2e/store-shot.py` and pointed at by commit through
`raw.githubusercontent.com`. Flathub refetches it on every build, so it has to
be a file in this repository and not the GitHub `user-attachments` link it used
to be - that one answers a GET with a redirect to a signed S3 URL that expires
in five minutes and refuses HEAD outright.

The name in the metainfo and the desktop entry is `nibeditor`; the app ID stays
`ch.emilvinu.nib`, which is the Tauri bundle identifier. Flathub requires the
matching domain to be yours and to answer over HTTPS. <https://emilvinu.ch>
does, so the ID stands as it is.

### Steps to submit it - needs your account

Flathub's requirements say plainly that AI tools must not open or automate
submission pull requests, or write their commit messages, descriptions or
review replies, and that AI-generated packaging has to be disclosed. So this is
yours to open, and the disclosure belongs in the pull request body.

1. Fork <https://github.com/flathub/flathub> with *Copy the master branch only*
   unchecked, and clone the `new-pr` branch:

   ```
   git clone --branch=new-pr git@github.com:<you>/flathub.git
   git checkout -b ch.emilvinu.nib
   ```

2. Copy the five files in `packaging/flathub/` to the root of that branch, push,
   and open the pull request against `new-pr` titled `Add ch.emilvinu.nib`.
3. Comment `bot, build` on it to make Flathub's builders build both
   architectures.
4. Two things worth saying in the pull request itself:
   - the packaging was written with an AI assistant, which their requirements
     ask you to disclose;
   - the manifest asks for `--filesystem=xdg-documents` rather than
     `--filesystem=home`, because the linter treats `home` as an error. Files
     picked in a dialog arrive through the document portal regardless, but a
     recently-opened file kept outside ~/Documents will not reopen on its own.
     Editors are the usual case for a `home` exception, so ask for one there
     rather than shipping the narrower permission and living with it.
5. Once it is merged and published, verification is a token you serve yourself:
   put the line Flathub gives you at
   <https://emilvinu.ch/.well-known/org.flathub.VerifiedApps.txt>. That is what
   puts the verified mark on the listing, and it also gates the automerge
   setting below.

When the app is on Flathub, a release opens its own pull request: the
`x-checker-data` block on the git source lets Flathub's
flatpak-external-data-checker move the tag. It cannot regenerate the two source
files, though, so a release whose lockfiles moved needs them regenerated in the
same pull request or the build fails. Do not turn on `automerge-flathubbot-prs`
for that reason.

## Snap Store

`snap/snapcraft.yaml` unpacks the `.deb` (`source-type: deb`) and stages nothing
of its own: the `gnome` extension's platform snap carries GTK, WebKitGTK 4.1 and
libsoup3, and binds the `webkit2gtk-4.1` helper directory in from there. A staged
second copy of the library would pair a WebKit UI process with web process
helpers from a different WebKit, which is how a Tauri window ends up blank.
Strict confinement: documents arrive through `home` and `removable-media`, and
nothing else is needed.

It pins the bytes it unpacks. `source-checksum` carries a `sha256/` per
architecture, and `publish-linux.yml` rewrites both from what the release page
reports for `Nib-<version>-linux-x64.deb` and `-arm64.deb` at the same moment it
rewrites the version and the URL - a release whose page reports no digest fails the
step rather than building an unchecked snap. Every other path here pins one too
(scoop and chocolatey a sha256, homebrew a sha256, the AUR a sha256, nix a hash,
Flathub a commit), and this was the one that did not: what the snap unpacks is a
file fetched over the network on a runner, and the Snap Store publishes it under the
product's name. **When a release is made by hand rather than by the workflow, update
the two digests in `snap/snapcraft.yaml` with it** - `gh release view v<version>
--json assets --jq '.assets[] | select(.name | test("linux.*deb$")) | "\(.name)
\(.digest)"'` prints both.

The two digests are written in the same advanced grammar the `source` above them uses
(`- on amd64:`), which craft-parts applies to a part's `source*` properties together.
`snapcraft` is Linux-only, so the first proof of that is the snap job on the next
release: if it rejects the per-architecture form, the fallback is one `source-checksum`
line that the workflow fills in for whichever architecture the runner is.

Worth doing because Ubuntu's App Center is the first place a great many Linux
desktop users look for software, and a snap is the only way to be in it.

### Steps to publish it - needs your account

`snapcraft` is Linux-only, so run these in WSL
(`sudo snap install snapcraft --classic`) or on any Linux box.

1. Make an Ubuntu One account at <https://snapcraft.io/account> if you have
   none, then `snapcraft login`.
2. Claim the name - it is unregistered today:

   ```
   snapcraft register nib
   ```

3. Export credentials scoped to that one snap and hand them over:

   ```
   snapcraft export-login --snaps nib \
     --acls package_access,package_push,package_update,package_release \
     snapcraft-creds.txt
   gh secret set SNAPCRAFT_STORE_CREDENTIALS --repo lxorb/nibeditor < snapcraft-creds.txt
   rm snapcraft-creds.txt
   ```

4. `gh workflow run publish-linux.yml --repo lxorb/nibeditor -f tag=v0.8.0` uploads
   both architectures to the stable channel.

The first upload of a graphical snap goes through a manual review if it asks for
anything unusual; this one does not, so it should pass automatically.

## Nix

`nix/flake.nix` wraps the AppImage with `appimageTools.wrapType2`, which is the
short path for a Tauri app: the AppImage already carries WebKitGTK and its web
process, so nothing has to be patched in. The desktop entry and icons are
installed alongside, so it shows up in a launcher rather than only on `$PATH`.

This is deliberately not a nixpkgs package. nixpkgs wants a maintainer who
watches the build, and search.nixos.org is the only place a nixpkgs entry would
be more discoverable than this flake - a small audience for a large standing
commitment. The flake costs nothing and works today:

```
nix run github:lxorb/nibeditor?dir=packaging/nix
nix profile install github:lxorb/nibeditor?dir=packaging/nix
```

There is no `flake.lock` on purpose: pinning nixpkgs here would mean an extra
commit every time the pin went stale, and the package is one `fetchurl` and a
wrapper.

## Refreshing all of it for a new release

`publish-linux.yml` rewrites the version and the checksums in flight, so a
release publishes itself and nothing here has to be edited first. The files do
stay pinned to the last release they were checked against, though, which is what
makes the validation workflow meaningful. To move them forward by hand:

```
version=0.8.0
base=https://github.com/lxorb/nibeditor/releases/download/v$version
for a in x64 arm64; do curl -fsSL "$base/Nib-$version-linux-$a.deb" | sha256sum; done
for a in x64 arm64; do curl -fsSL "$base/Nib-$version-linux-$a.AppImage" | sha256sum; done
```

- `aur/nib-bin/PKGBUILD`: `pkgver`, both `sha256sums_*`. Regenerate `.SRCINFO`
  with `makepkg --printsrcinfo > .SRCINFO`, or let the validation workflow print
  it - it fails if the committed one is stale.
- `flathub/ch.emilvinu.nib.yml`: the `tag` and the `commit` on the git source,
  plus a `<release>` entry in `ch.emilvinu.nib.metainfo.xml`. If either lockfile
  moved in that release, regenerate `cargo-sources.json` and `node-sources.json`
  as well - a stale one fails the build rather than building the wrong thing.
- `snap/snapcraft.yaml`: `version` and the two URLs.
- `nix/flake.nix`: `version` and both hashes, as SRI - `nix hash convert --hash-algo
  sha256 --to sri <hex>`.

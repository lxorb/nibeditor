# Linux packaging

Four package managers, and a flake. Each repackages what
`.github/workflows/release.yml` already publishes rather than rebuilding
Orden, so a release is a release everywhere and nothing can drift between
them. Not Flathub; see the section of that name.

| Directory | Manager | Built from | Architectures |
| --- | --- | --- | --- |
| `apt/` | apt (`apt install orden`, from `lxorb.github.io/apt`) | the `.deb` | amd64, arm64 |
| `aur/nib-bin/` | AUR (`yay -S orden-bin`) | the `.deb` | x86_64, aarch64 |
| `snap/` | Snap Store | the `.deb` | amd64, arm64 |
| `nix/` | a flake anyone can install from | the `.deb` | x86_64, aarch64 |

`.github/workflows/validate-linux-packaging.yml` builds the AUR package and the snap
the way the managers themselves do - `makepkg` in an Arch container and `snapcraft` in
LXD. Run it after every release that changes packaging. The flake has its own,
`.github/workflows/nix.yml`, which runs on every pull request into `main` that
changes it.

`.github/workflows/publish-linux.yml` pushes a stable release out to the AUR and the
Snap Store, the snap through `snap.yml`, which `release.yml` also calls for every edge
build. `release.yml` calls it once the release's files are up - a call rather than a
dispatch, which only finds a workflow on the default branch - and it runs by hand as
`gh workflow run publish-linux.yml -f tag=v<version>`; nothing listens for
`release: published`. Both build and then stop short of uploading until their secrets
exist, so they are harmless while the accounts below do not.

`.github/workflows/publish.yml` does the same for winget, Scoop, Homebrew and
Chocolatey, and also skips every manager whose token is missing, so nothing is
pushed anywhere until `PACKAGING_TOKEN`, `WINGET_TOKEN` and
`CHOCOLATEY_API_KEY` are set as repository secrets.

## What Tauri's .deb gives us, and what it gets wrong

```
Package: orden (Conflicts and Replaces: nib and nibeditor, its names up to 0.11 and 0.13)
Depends: libwebkit2gtk-4.1-0 (>= 2.40.0), gstreamer1.0-plugins-base, gstreamer1.0-plugins-good, libwebkit2gtk-4.1-0, libgtk-3-0
Recommends: gstreamer1.0-libav, gstreamer1.0-plugins-bad
usr/bin/nib
usr/share/applications/Orden.desktop (Nib.desktop up to 0.11, nibeditor.desktop up to 0.13)
usr/share/icons/hicolor/{32x32,128x128,256x256@2}/apps/nib.png
```

The binary and the icons are fine, and so is most of the control file: `Description:`
comes from `bundle.shortDescription` and `longDescription` in `tauri.conf.json`, and the
entry's `Categories=Office;` from `bundle.category` (`Productivity`). What Tauri writes
is still short of two things, which every package here repairs:

- **No `x-scheme-handler/http` or `https` in `MimeType=` and no `%U` on `Exec=`**, so
  nothing offers Orden as a web browser: the entry Tauri writes claims
  `application/pdf` and `x-scheme-handler/nib` alone. Orden claims `x-scheme-handler/http` and `https`, which is what lets it be
  the default browser (see `default_browser.rs`), and of files only
  `application/pdf`, for a file manager's "Open with" (see `handed_pdfs.rs`): it
  opens no note from outside its spaces, so a `.md` in a file manager is never
  offered to it.
- **The 256x256 icon is filed under `256x256@2`**, a scale-2 directory, where a
  256x256 image means "128 logical pixels at 2x" and every theme lookup scales
  it wrong. Tauri puts `128x128@2x.png` there by name rather than by size.

`Maintainer:` is `bundle.publisher`, a name with no email address, which Debian's
policy asks for and nothing here enforces.

Each package therefore installs its own `.desktop` entry and moves the icon. The
copies differ only where they have to: the snap one points `Icon=` at `${SNAP}`.

## What Orden needs of the system

**WebKitGTK 2.40 or newer.** A web tab's state is read and written in a script
world of its own through `webkit_web_view_call_async_javascript_function`, which
is new in 2.40, so the crate builds `webkit2gtk` with its `v2_40` feature
(`apps/desktop/src-tauri/Cargo.toml`, `src/web_state/isolated.rs`). wry on its
own asks for 2.38. Every distribution packaged here is past it: Ubuntu 22.04 has
2.50 and 24.04 2.52 in their updates, Debian 12 2.50 and 13 2.54, Arch 2.54, and the snap's
gnome-46-2404 platform 2.52.

**GStreamer's -base and -good plugins.** WebKitGTK plays and records sound and
video through GStreamer, and what Orden plays is its own: a voice note in a chat,
a recording embedded in a note, a picture's or a video's preview in a chat's
gallery. A recording on Linux is Opus in WebM (`recorder/container.ts`): Opus is
in -base, WebM (and MP4) in -good, and so is the source and sink for the sound
server. Debian's and Ubuntu's `libwebkit2gtk-4.1-0` already depend on both; Arch's
`webkit2gtk-4.1` depends only on GStreamer's libraries and leaves every plugin
optional, so the AUR package names them.

**gst-libav and -bad, recommended.** A recording made on a Mac or an iPhone is AAC
in MP4 (`.m4a`), and a video from a phone is H.264 or HEVC; GStreamer decodes those
in gst-libav (`avdec_aac`, `avdec_h264`), with -bad holding most of the remaining
formats. Without them the file is there and does not play, and nothing else in the
app is affected, so they are what Debian calls Recommends (Debian 13 recommends
them for WebKitGTK already; Ubuntu only suggests them) and the AUR `optdepends`.

| | WebKitGTK | required | recommended |
| --- | --- | --- | --- |
| `.deb` (`tauri.conf.json` `bundle.linux.deb`) | `libwebkit2gtk-4.1-0 (>= 2.40.0)` | `gstreamer1.0-plugins-base`, `-good` | `gstreamer1.0-libav`, `-plugins-bad` |
| AUR (`PKGBUILD`) | `webkit2gtk-4.1>=2.40` | `gst-plugins-base`, `gst-plugins-good` | `gst-libav`, `gst-plugins-bad` (`optdepends`) |
| snap | the platform's, 2.52 | the platform's | none: not in the platform |
| Nix | nixpkgs' | `gstPluginsFor` in the flake: all five | - |

The `.rpm` names neither: Tauri writes its requirements as sonames
(`libwebkit2gtk-4.1.so.0()(64bit)`), which carry no version, and Fedora and
openSUSE spell every package above differently.

The snap has no way to recommend a package, and stages nothing beside the platform
on purpose (see below). gnome-46-2404 carries -base, -good, PipeWire's and the GL
plugins, so recordings and WebM play; AAC and H.264 do not. Staging gst-libav would
not be enough to change that: its libavfilter is not in the platform, and the
platform's launcher puts no directory of the snap's own on the library path.

## apt - `lxorb/apt`

An apt repository of our own, on GitHub Pages: `lxorb/apt`, served at
`https://lxorb.github.io/apt`. The address lives in one place, the repository variable
`APT_BASE_URL` (that default when it is unset), which `apt.yml` writes into the
repository's own page; a move to `apt.orden.so` is that variable, a `CNAME` in `lxorb/apt`
and the lines below.

Two suites, one component, `main`, and both architectures:

- `stable`: the newest release. `publish.yml` calls `apt.yml` for every stable tag,
  with the other package managers.
- `unstable`: the newest `edge` build. `release.yml` calls it once edge's files are up.

Both call it (`uses:`) rather than dispatching it: a dispatch only finds a workflow that is
on the default branch already, and `apt.yml` reaches `unstable` first.

**Each suite holds one version, the newest.** A run empties that suite's pool, puts the
release's two `.deb`s in, writes its `Packages` and `Release` again and signs it; the
other suite is taken from the repository as it is. Every older `.deb` stays on its release
page. The repository is pushed as a single commit with no history, because every `.deb`
that ever went in would otherwise stay in a repository Pages serves - thirty megabytes for
every edge build.

**Written with `apt-ftparchive` and `gpg`**, in `scripts/apt-repo.sh`, and nothing else:
no `reprepro` database or `aptly` state to keep beside the files, so the checkout of
`lxorb/apt` is the whole of the state, a run reads it as it finds it, and the layout is the
plain one apt reads:

```
dists/<suite>/InRelease, Release, Release.gpg
dists/<suite>/main/binary-{amd64,arm64}/Packages, Packages.gz
pool/<suite>/orden_<version>_<arch>.deb
orden-archive-keyring.asc, orden-archive-keyring.gpg, index.html, README.md
```

**The key** is `APT_SIGNING_KEY`, a repository secret: ed25519 with no passphrase,
`Orden packages <emil@emilvinu.ch>`, fingerprint
`44404B19539FB2C53F31086941F0103448A194DE`. Its public half is
`apt/orden-archive-keyring.asc` here and at the root of the repository, and a run whose
secret is not that key refuses to sign. Without the key or `PACKAGING_TOKEN` the run is
skipped. `InRelease` and `Release.gpg` both, so every apt finds the signature it asks for.

Adding it, for `stable` (`Suites: unstable` for the edge builds):

```sh
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://lxorb.github.io/apt/orden-archive-keyring.asc | sudo tee /etc/apt/keyrings/orden.asc >/dev/null
sudo tee /etc/apt/sources.list.d/orden.sources >/dev/null <<'EOF'
Types: deb
URIs: https://lxorb.github.io/apt
Suites: stable
Components: main
Signed-By: /etc/apt/keyrings/orden.asc
EOF
sudo apt update
sudo apt install orden
```

The one-line form, for an apt older than 2.3 that reads no `.sources` file:
`deb [signed-by=/etc/apt/keyrings/orden.asc] https://lxorb.github.io/apt stable main` in
`/etc/apt/sources.list.d/orden.list`. The keyring may be the armored `.asc`; apt reads
either. The app leaves an install from here to apt and only says when a new version is out
(`package_manager.rs`).

By hand, once `apt.yml` is on main: `gh workflow run apt.yml -f suite=stable -f tag=v0.15.0`,
or `-f suite=unstable -f tag=edge`.

## AUR - `orden-bin`

`aur/nib-bin/` is the package base as the AUR wants it: `PKGBUILD`, the
generated `.SRCINFO`, and the `nib.desktop` that replaces Tauri's. The package
is `orden-bin`; the folder, the binary, the icon and the desktop entry keep the
name `nib`. It unpacks the `.deb` with `bsdtar`, so installing Orden pulls in no
Rust or Node toolchain.

Neither `orden-bin` nor `orden` is in the AUR (checked 2026-10-12), and neither
the official repositories nor the AUR has a `nib`, so `provides=nib` and
`conflicts=nib` are free. (`nib-git` in the AUR is an unrelated, orphaned Python
static site generator.) The package was never published as `nib-bin`.

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
   gh secret set AUR_USERNAME --repo lxorb/orden --body "<your AUR username>"
   gh secret set AUR_EMAIL    --repo lxorb/orden --body "<the email on the account>"
   gh secret set AUR_SSH_PRIVATE_KEY --repo lxorb/orden < ~/.ssh/aur_nib
   ```

5. Publish the current release:

   ```
   gh workflow run publish-linux.yml --repo lxorb/orden -f tag=v0.13.1
   ```

   The AUR creates the package base on first push, so there is nothing to
   register by hand. From then on every published release pushes itself.

If you would rather do the first push yourself:

```
git clone ssh://aur@aur.archlinux.org/orden-bin.git
cp packaging/aur/nib-bin/{PKGBUILD,.SRCINFO,nib.desktop} orden-bin/
cd orden-bin && git add -A && git commit -m "orden 0.13.1" && git push
```

## Flathub

Orden is not published on Flathub, by the owner's decision. `flathub/` keeps the
manifest, the AppStream metainfo, the desktop entry and the two generated source lists
of a submission that builds from source with no network, as Flathub requires of a
source-available app, for reference; nothing builds or updates them.

The reason is Flathub's own: its requirements keep AI tools out of a submission - they
may not open or automate the pull request, or write its description, commit messages
or review replies - and require AI-written packaging to be disclosed, and this manifest
and everything round it were written with them. The files stay as they were when that
was decided; the history has how they were made and checked.

## Snap Store

`snap/snapcraft.yaml` unpacks the `.deb` (`source-type: deb`) and stages nothing
of its own: the `gnome` extension's platform snap carries GTK, WebKitGTK 4.1 and
libsoup3, and binds the `webkit2gtk-4.1` helper directory in from there. A staged
second copy of the library would pair a WebKit UI process with web process
helpers from a different WebKit, which is how a Tauri window ends up blank.
Strict confinement: the spaces are reached through `home`, an export saved to a
stick through `removable-media`, and nothing else is needed.

Two channels. A release goes to `stable`, from `publish-linux.yml`; every edge build goes
to `edge`, from `release.yml` once edge's files are up, at `grade: devel`, which the store
keeps out of `stable` and `candidate`. Both call `.github/workflows/snap.yml` (`uses:`)
rather than dispatching it, because a dispatch only finds a workflow on the default
branch. It finds the two `.deb`s on the release by what they are - a release's page
calls them `Orden-<version>`, edge `Nib-<version>`, and an edge build's version is in
nothing else - checks the version is one a snap may have (at most 32 of letters, digits
and `.+~-`, as `0.15.1-688` is), and writes version, grade, URLs and digests in.
`sudo snap install orden --edge` follows the edge builds, `sudo snap refresh orden
--stable` comes back. The app in a snap is the store's to update, and only says when a
new version is out (`package_manager.rs`).

It pins the bytes it unpacks. `snap.yml` reads the digests the release page reports
for the two `.deb`s and writes them in at the same moment it rewrites the version and
the URL - a release whose page reports no digest fails the
step rather than building an unchecked snap. Every other path here pins one too
(scoop and chocolatey a sha256, homebrew a sha256, the AUR a sha256, nix a hash),
and this was the one that did not: what the snap unpacks is a
file fetched over the network on a runner, and the Snap Store publishes it under the
product's name. **When a release is made by hand rather than by the workflow, update
the two digests in `snap/snapcraft.yaml` with it** - `gh release view v<version>
--json assets --jq '.assets[] | select(.name | test("linux.*deb$")) | "\(.name)
\(.digest)"'` prints both.

`source-checksum` is one line, for the architecture being built. snapcraft takes the
`- on amd64:` grammar for `source` but not for the checksum: snapcraft 8.11.1 refuses
the list with "Input should be a valid string", so a snap with a digest per
architecture never built. Both digests are kept as a record in the comment above the
line, `scripts/bump-packaging.mjs` rewrites both and puts amd64's in the line, and
`snap.yml` copies its runner's into the line before it builds.

Worth doing because Ubuntu's App Center is the first place a great many Linux
desktop users look for software, and a snap is the only way to be in it.

### Steps to publish it - needs your account

`snapcraft` is Linux-only, so run these in WSL
(`sudo snap install snapcraft --classic`) or on any Linux box.

1. Make an Ubuntu One account at <https://snapcraft.io/account> if you have
   none, then `snapcraft login`.
2. Claim the name - nothing is published under it today:

   ```
   snapcraft register orden
   ```

3. Export credentials scoped to that one snap and hand them over:

   ```
   snapcraft export-login --snaps orden \
     --acls package_access,package_push,package_update,package_release \
     snapcraft-creds.txt
   gh secret set SNAPCRAFT_STORE_CREDENTIALS --repo lxorb/orden < snapcraft-creds.txt
   rm snapcraft-creds.txt
   ```

4. `gh workflow run publish-linux.yml --repo lxorb/orden -f tag=v0.15.0` uploads
   both architectures to the stable channel; the next push to `unstable` fills `edge`.

The first upload of a graphical snap goes through a manual review if it asks for
anything unusual; this one does not, so it should pass automatically.

## Nix

`nix/flake.nix` is one file holding both channels, and it is the same file on every
branch: `packages.default` and `packages.orden` are the release out of its `.deb`,
`packages.orden-unstable` compiles the sources beside the flake. It used to be two
different files at the one path, the release flake on main and the source flake on
`unstable`, which meant every release pull request either conflicted here or
quietly carried the source flake onto main and broke
`nix profile install github:lxorb/orden?dir=packaging/nix` for everyone already on
it. Nothing in the flake asks which branch it is on.

The release build takes the program out of the release `.deb` and runs it on
nixpkgs' own WebKitGTK, GTK and GStreamer, with `autoPatchelfHook` and
`wrapGAppsHook3`, the way nixpkgs packages other Tauri apps and the way the AUR
package runs it on Arch's. Up to 0.13 it wrapped the AppImage instead, which broke
on NixOS: the AppImage's own libwayland-client and GLib do not match the system's
Mesa and libglvnd (WebKit's web process aborts with `Could not create default EGL
display: EGL_BAD_PARAMETER`), its start script forces `GDK_BACKEND=x11`, and its
GStreamer 1.20 refuses nixpkgs' plugins. Built on nixpkgs it is a native Wayland
client, uses the driver NixOS keeps in `/run/opengl-driver`, and plays media. The
wrapper turns WebKit's DMA-BUF renderer off on NVIDIA's own driver alone (the
blank-window bug), unless `WEBKIT_DISABLE_DMABUF_RENDERER` is set either way;
Mesa keeps it. GStreamer loads its own plugins and nothing else: a
`GST_PLUGIN_PATH` the session carries (a NixOS profile's `lib/`, Qt and KDE
plugins and all) is dropped, and its registry is the package's own. No
`LD_PRELOAD`, no `GDK_BACKEND`. The command is `orden`, with `nib` beside it; the desktop entry and
icons are installed alongside, so it shows up in a launcher.

This is deliberately not a nixpkgs package. nixpkgs wants a maintainer who
watches the build, and search.nixos.org is the only place a nixpkgs entry would
be more discoverable than this flake - a small audience for a large standing
commitment. The flake costs nothing and works today:

```
nix run github:lxorb/orden?dir=packaging/nix
nix profile install github:lxorb/orden?dir=packaging/nix
```

On NixOS, as an input of the system's flake, either the package itself or
`overlays.default`, which builds it out of the system's own nixpkgs:

```nix
inputs.orden.url = "github:lxorb/orden?dir=packaging/nix";
inputs.orden.inputs.nixpkgs.follows = "nixpkgs";
# then, in a module:
environment.systemPackages = [ inputs.orden.packages.${pkgs.system}.default ];
```

Under Home Manager, `homeManagerModules.default` installs it into one user's
profile rather than the system's, as `programs.orden`:

```nix
imports = [ inputs.orden.homeManagerModules.default ];
programs.orden = {
  enable = true;
  # package = inputs.orden.packages.${pkgs.system}.orden-unstable;
  themes.paper = ./paper.css;          # themes/paper.css, offered in Settings as "Paper"
  customCss = "body { font-size: 18px; }";
  snippets = { todo = "- [ ] "; };
};
```

`package` defaults to this flake's release. The other three are the files Orden
leaves to the reader in its settings folder, `~/.config/ch.emilvinu.nib`, and the
module writes each only when it is set: a theme stylesheet per name (lower-case
letters, digits and hyphens, what the app takes for a theme's id), `custom.css`,
which applies over whichever theme is active, and `snippets.json`, the
abbreviations the editor completes. A stylesheet is the CSS itself or a file
holding it. Everything else in that folder - which theme is picked, the font,
window sizes, history - is the app's own state, rewritten while it runs, and the
module leaves it alone; so does it leave themes installed from inside the app,
which go into the same `themes/` folder beside the declared ones.

A file the module writes is a link into the Nix store, which nothing can write to.
Orden still reads it, but saving it from inside the app - Edit custom CSS, Edit
snippets, reinstalling a declared theme - replaces the link with a file of its own,
and the next `home-manager switch` stops at it rather than overwrite it (or moves
it aside, given a `backupFileExtension`). Each file belongs to one of the two:
declare it here, or edit it in the app.

For the edge rather than the release, install the `orden-unstable` package, named
explicitly, from the `unstable` branch. It compiles that branch's source and follows
the unstable updater channel by default, and it has its own command, desktop entry
and icons, so it installs beside the release rather than over it:

```
nix profile install github:lxorb/orden/unstable?dir=packaging/nix#orden-unstable
nix profile upgrade --all    # either one moves to its newest build
```

The attribute has to be named: `default` is the release on every branch now, so
leaving it off installs the release from a flake fetched off `unstable`. Name the
repository and not just the directory - `?dir=packaging/nix` is how Nix is handed
the whole tree with the flake inside it, and the source build needs the workspace
next to it. `path:packaging/nix`, which copies that directory alone, leaves the
release outputs working and `orden-unstable` as a derivation that says what is
missing when somebody builds it.

Its Cargo dependencies are vendored straight out of `Cargo.lock`, so they carry no
hash to go stale. Its pnpm dependencies need a fixed-output hash, which is pinned in
the flake and is the same on both architectures (the fetcher runs `pnpm install
--force`, taking every platform's optional packages). That hash is the one thing in
the flake that moves with a lockfile rather than with a release: when `pnpm-lock.yaml`
moves past it the source *build* fails and names the hash it wanted, while
`nix flake check` and `nix eval` never touch it, so a stale one cannot break the
release outputs or the check on main. `gh workflow run nix.yml -f resolve_source_hashes=true`
resolves and validates it on a runner before it is committed here.

Two channels and no third. There is no branch holding a flake pinned to the
binaries of the `edge` pre-release: that was `nix-edge`, main plus a commit of
edge pins, force-pushed on every build, and it is gone. Main carries releases
and nothing else now, so a flake following main is a flake following the
release. Someone who wants the edge on Nix compiles the branch, which is the one
place this differs from the other package managers: everywhere else the edge
arrives as the same prebuilt .deb the `edge` pre-release carries.

The release package needs no binary cache, and nothing is compiled for it: the
build unpacks a 13 MB .deb, points its program at nixpkgs' libraries and writes
a shell wrapper, about four seconds on a CI runner, plus the download of the
.deb from the release, which a cache would only replace with a download of the
same size. Everything else comes from cache.nixos.org already. `orden-unstable`
is the exception, since it builds the app from source.

`flake.lock` pins nixpkgs, because Nix refuses to run a flake from GitHub whose
lock file it would have to write. Every release moves it (see below), so it is
never older than the release.

`.github/workflows/nix.yml` runs `nix flake check`, builds the flake on x86_64
and aarch64, and starts Orden out of it twice on each in a headless sway
(wlroots, like Hyprland), with Mesa where NixOS keeps it: once with Xwayland off
and no `DISPLAY`, so the window is a native Wayland one, and once on X11 through
Xwayland (`scripts/nix-start.sh`). On a pull request into `main` it builds the
flake in the checkout; by hand, and when `packaging-bump.yml` calls it, the flake it
is handed, from GitHub exactly as `nix run` above does. It starts the release build; `-f resolve_source_hashes=true` builds
`orden-unstable` instead.

## Refreshing all of it for a new release

`publish.yml` and `publish-linux.yml` rewrite the version and the checksums in
flight, so a release publishes itself and nothing here has to be edited first.
The files do stay pinned to the release they describe, which is what makes the
validation workflow meaningful and what `nix run` installs. A stable release moves
them by itself: `release.yml` dispatches `packaging-bump.yml`, which runs
`scripts/bump-packaging.mjs` over the flake, the PKGBUILD and its `.SRCINFO`,
`snapcraft.yaml`, the Scoop manifest, the Chocolatey package and the cask, with the
digests the release page reports, and runs `nix flake update` on the flake. It
checks the `.SRCINFO` against `makepkg`, builds
and starts the flake (nix.yml), opens a pull request and merges it, then starts
the flake once more from GitHub. A build of main never gets there. By hand:

```
gh workflow run packaging-bump.yml --repo lxorb/orden -f tag=v0.15.0 -f dry_run=true
node scripts/bump-packaging.mjs 0.15.0   # the same rewrite, locally
```

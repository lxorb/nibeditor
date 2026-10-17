# Windows packaging

Three package managers carry Orden on Windows, and each takes the release's own files
rather than building anything: winget (`lxorb.Orden`), Scoop (`orden`, in
`lxorb/scoop-bucket`) and Chocolatey (`orden`). Homebrew's cask is in `homebrew/` and
goes out the same way.

| Directory | Manager | Installer it takes |
| --- | --- | --- |
| `scoop/orden.json` | Scoop (`scoop install lxorb/orden`) | the NSIS setup, unpacked rather than run |
| `chocolatey/orden.nuspec` | Chocolatey (`choco install orden`) | the MSI, for the whole machine |
| `chocolatey/nib.nuspec` | Chocolatey (`choco upgrade nib`) | none: the road from the old name |
| `winget/` | winget | the NSIS setup |

## How a release gets there

`.github/workflows/publish.yml`, one job per manager, none waiting on another. It is
started by `release.yml`'s publish job once a stable release and every file on it are up,
as a dispatch (`gh workflow run publish.yml -f tag=v<version>`): a release made on the
workflow's own token raises no event another workflow hears. The same command sends a
release through again by hand, and every job is safe to run twice - the bucket and the tap
commit only what changed, and Chocolatey skips a version it already has (a 409, written in
the run's summary as skipped). A manager whose token is missing is skipped:
`PACKAGING_TOKEN` for the bucket and the tap, `CHOCOLATEY_API_KEY`, `WINGET_TOKEN`.

`scripts/bump-packaging.mjs` keeps the files here on the release they describe; see
packaging/linux.md, "Refreshing all of it for a new release".

## The rename: nib to orden

Up to 0.15.0 the Scoop app and the Chocolatey package were both `nib`, the product's
first name. Both are `orden` now, and the old name stays as a road to the new one rather
than a dead end.

**Scoop** has no rename. What it has is a bucket's `deprecated/` folder: a manifest there
still updates the app it installed, and `scoop status` says Deprecated beside it. So the
publish job moves `bucket/nib.json` to `bucket/deprecated/nib.json` the first time it
writes `bucket/orden.json`, with a note saying where Orden is now, and never touches it
again. Somebody on `nib` runs `scoop uninstall nib` and then `scoop install orden`.
`orden`'s installer takes over what `nib` kept in its persist folder - themes and note
history, junctioned from `%APPDATA%\ch.emilvinu.nib` - the first time, while its own
persist folder is still empty. Its uninstaller removes that junction as a link alone, so
the persist folder stays until `scoop uninstall orden --purge`.

**Chocolatey** deprecates a package the way its documentation says
("Deprecate a Package", for a package superseded by another): a new version of the old
id, with `[Deprecated]` in front of its title, a description saying why, a dependency on
the package that replaces it, no files and no icon - and every older version unlisted on
the community repository but that last one, which is the road. `nib.nuspec` is that
package. It depends on `orden` at the release's version or later, so `choco upgrade nib`
installs `orden`, whose MSI upgrades Orden in place, and `choco upgrade all` keeps moving
`orden` on afterwards. `choco uninstall nib` then removes the empty package alone.

A deprecation has to be a version of `nib` newer than every one before it, and `nib`
0.15.0 was a real package. So the publish job pushes it as the release's version with
the day the release was published after it, `0.15.0.20261014` for 0.15.0: newer than
every `nib` before it, and the same on every run for one release, so a second run is a
409 and skipped.

Unlisting the old `nib` versions on community.chocolatey.org is done by hand, on the
package's page; nothing here can.

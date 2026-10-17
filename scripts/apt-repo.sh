#!/usr/bin/env bash
# Puts a release's .debs into the apt repository, as one suite, signed.
#
#   APT_KEY_FINGERPRINT=<the signing key, imported into gpg already> \
#   APT_BASE_URL=https://lxorb.github.io/apt \
#     scripts/apt-repo.sh <stable|unstable> <folder of .debs> <checkout of the repository>
#
# The repository is plain files on GitHub Pages (lxorb/apt), laid out the way apt reads
# one, and written here with nothing but apt-ftparchive and gpg: no database beside the
# files, so the checkout is the whole of the state and a run reads it as it finds it.
#
#   dists/<suite>/InRelease, Release, Release.gpg
#   dists/<suite>/main/binary-{amd64,arm64}/Packages(.gz)
#   pool/<suite>/orden_<version>_<arch>.deb
#   orden-archive-keyring.asc, .gpg, index.html, README.md
#
# A suite holds one version, the newest: its pool is emptied and filled with the .debs
# handed over, and its indices are written again. The other suite is left exactly as it
# was. Everything older stays on its release page on GitHub, where a .deb can always be
# fetched by hand. See packaging/linux.md, "apt".
set -euo pipefail

suite=${1:?stable or unstable}
debs=${2:?a folder of .debs}
repo=${3:?a checkout of the repository}
key=${APT_KEY_FINGERPRINT:?the fingerprint of the signing key}
base=${APT_BASE_URL:-https://lxorb.github.io/apt}
base=${base%/}

case "$suite" in
  stable | unstable) ;;
  *)
    echo "the suite is stable or unstable, not $suite" >&2
    exit 1
    ;;
esac

here=$(cd "$(dirname "$0")/.." && pwd)
debs=$(cd "$debs" && pwd)
cd "$repo"

shopt -s nullglob
found=("$debs"/*.deb)
if [ ${#found[@]} -eq 0 ]; then
  echo "no .deb in $debs" >&2
  exit 1
fi

# The pool, emptied and filled again: one version of the suite.
pool="pool/$suite"
rm -rf "$pool"
mkdir -p "$pool"
for deb in "${found[@]}"; do
  name=$(dpkg-deb --field "$deb" Package)
  version=$(dpkg-deb --field "$deb" Version)
  arch=$(dpkg-deb --field "$deb" Architecture)
  cp "$deb" "$pool/${name}_${version}_${arch}.deb"
  echo "$suite: $name $version $arch"
done

# The indices, read off the pool, per architecture.
dists="dists/$suite"
rm -rf "$dists"
for arch in amd64 arm64; do
  dir="$dists/main/binary-$arch"
  mkdir -p "$dir"
  apt-ftparchive --arch "$arch" packages "$pool" >"$dir/Packages"
  gzip -9 --no-name --keep --force "$dir/Packages"
done

apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Orden \
  -o APT::FTPArchive::Release::Label=Orden \
  -o APT::FTPArchive::Release::Suite="$suite" \
  -o APT::FTPArchive::Release::Codename="$suite" \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
  -o APT::FTPArchive::Release::Components=main \
  -o APT::FTPArchive::Release::Description="Orden, $suite" \
  release "$dists" >"$dists/Release.next"
mv "$dists/Release.next" "$dists/Release"

# Signed both ways apt reads: InRelease, the one it asks for first, and Release.gpg
# beside Release for an apt that asks for that.
gpg --batch --yes --local-user "$key" --clearsign --output "$dists/InRelease" "$dists/Release"
gpg --batch --yes --local-user "$key" --armor --detach-sign --output "$dists/Release.gpg" "$dists/Release"

# What a person needs to add it, at the root: the key both ways, and the page that says
# how, with the address it is served from written in.
cp "$here/packaging/apt/orden-archive-keyring.asc" orden-archive-keyring.asc
gpg --batch --yes --dearmor --output orden-archive-keyring.gpg orden-archive-keyring.asc
for page in index.html README.md; do
  sed "s|@BASE@|$base|g" "$here/packaging/apt/$page" >"$page"
done
# Served as the files they are, with nothing of Jekyll's in front of them.
touch .nojekyll

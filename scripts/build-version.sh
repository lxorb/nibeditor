#!/usr/bin/env bash
# What a build is called, decided once for every platform and every workflow.
#
# Two kinds of build come out of the repository. A stable tag `v*` is a release
# proper, with its own page and number. Pushes to `unstable` make the rolling
# prerelease; its tag is an argument because desktop and phone apps roll on
# separate ones - a desktop build deletes and remakes its release, which would
# take an APK uploaded beside it with it.
#
# One patch past the newest stable tag, with a pre-release number that only ever
# goes up. Semver puts 0.1.2-57 above 0.1.1 and below 0.1.2, so the app takes
# each unstable build and then the stable release that follows. Digits only in the pre-release,
# because the MSI bundler turns it into a fourth version number and accepts
# nothing else there.
#
# Writes `version`, `tag`, `rolling` and `channel` to the step's outputs.
set -euo pipefail

rolling_tag="${1:?the tag a rolling build lands on}"

if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
  echo "version=${GITHUB_REF_NAME#v}" >>"$GITHUB_OUTPUT"
  echo "tag=$GITHUB_REF_NAME" >>"$GITHUB_OUTPUT"
  echo "rolling=false" >>"$GITHUB_OUTPUT"
  if [[ "${GITHUB_REF_NAME#v}" == *-* ]]; then
    echo 'channel=unstable' >>"$GITHUB_OUTPUT"
  else
    echo 'channel=stable' >>"$GITHUB_OUTPUT"
  fi
  exit 0
fi

latest=$(git tag --list 'v*' --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true)
latest=${latest:-v0.0.0}
IFS=. read -r major minor patch <<<"${latest#v}"
echo "version=$major.$minor.$((patch + 1))-$GITHUB_RUN_NUMBER" >>"$GITHUB_OUTPUT"
echo "tag=$rolling_tag" >>"$GITHUB_OUTPUT"
echo "rolling=true" >>"$GITHUB_OUTPUT"
echo 'channel=unstable' >>"$GITHUB_OUTPUT"

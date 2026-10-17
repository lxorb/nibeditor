# Orden on the AUR

Two packages, which conflict with each other:

- `orden-bin` installs the `.deb` of the newest release. `publish-linux.yml`
  pushes it when a release is published; its recipe is `nib-bin/`.
- `orden-git` clones `main` and builds it on the installing machine. Its recipe,
  `orden-git/`, does not change with each push to `main`: AUR helpers find new
  commits themselves, e.g. `yay -Syu --devel`. Its version comes from
  `git describe`, so `0.15.0.r12.gabc1234` is twelve commits after `v0.15.0`.

`.github/workflows/aur.yml` lints `orden-git/` with `namcap` when it changes and,
on `main`, pushes it with a fresh `.SRCINFO`. It builds nothing.

The GitHub environment `aur` permits only `main`. Until it has the key, the
publish job skips the push and says so in the run summary. Its secret `AUR_SSH_PRIVATE_KEY`
is a dedicated Ed25519 key; add its public half (`~/.ssh/orden_aur_ci.pub`) to
the activated AUR account registered with `bendik@arbogast.dev`.
The AUR push verifies the pinned server key, removes the private key on exit, and
never forces.

To rotate credentials, generate a new dedicated key, replace the public key in
the AUR account and the secret in the `aur` environment, then remove the old key
from both places. Retry publishing with a workflow dispatch on `main`.

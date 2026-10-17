# Orden for apt

The apt repository of [Orden](https://orden.so), a markdown editor: Debian, Ubuntu and
everything built on them, on x86_64 and arm64. Written by
[lxorb/orden](https://github.com/lxorb/orden)'s workflows; nothing here is edited by
hand, and every push replaces what was here before.

Two suites:

- `stable`: the newest release.
- `unstable`: the newest build of the `unstable` branch, the one the app's unstable
  channel follows.

Each holds one version, the newest. Every release's `.deb` stays on its
[release page](https://github.com/lxorb/orden/releases).

## Add it

```sh
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL @BASE@/orden-archive-keyring.asc | sudo tee /etc/apt/keyrings/orden.asc >/dev/null
sudo tee /etc/apt/sources.list.d/orden.sources >/dev/null <<'EOF'
Types: deb
URIs: @BASE@
Suites: stable
Components: main
Signed-By: /etc/apt/keyrings/orden.asc
EOF
sudo apt update
sudo apt install orden
```

For the unstable builds, `Suites: unstable` instead. On an apt older than 2.3, which
reads no `.sources` file, the same in one line:

```sh
echo "deb [signed-by=/etc/apt/keyrings/orden.asc] @BASE@ stable main" | sudo tee /etc/apt/sources.list.d/orden.list
```

The key: `Orden packages <emil@emilvinu.ch>`, ed25519, fingerprint
`4440 4B19 539F B2C5 3F31 0869 41F0 1034 48A1 94DE`. Also as a binary keyring,
`orden-archive-keyring.gpg`.

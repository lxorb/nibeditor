/** What a Hetzner machine boots with the first time (docs/online-terminal.md 4.15): its
 *  cloud-init user data.
 *
 *  The machine's two secrets - `nibd`'s link secret and the tunnel's token - go into
 *  `write_files` and nowhere else: cloud-init logs that a file was written and how many
 *  bytes, never what is in it, and the commands it runs carry no secret at all. Its own
 *  copy of this text is removed once the machine is set up. What it then runs is the
 *  machine's bundle, the bytes this Worker was deployed with (bundle.ts), fetched from
 *  this Worker and checked against their SHA-256 before anything in them runs; the
 *  bundle's install.sh is the same one the Cloudflare image is built with. */

/** What one machine's first boot needs. */
export interface Boot {
  /** `nibd`'s link secret, which `Machine` keeps and links with. */
  secret: string
  /** The machine's tunnel's token, for `cloudflared`. */
  tunnel: string
  /** The owner's time zone, or UTC. */
  zone: string
  /** Where the bundle and its updates come from: the app's own origin. */
  origin: string
  /** The bundle's SHA-256, in hex. */
  bundle: string
  /** The owner's own SSH public key, for an emergency; null for none (the default). */
  sshKey: string | null
}

const TOKEN = /^[A-Za-z0-9+/=_.-]{16,4096}$/
const ZONE = /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)*$/
const SHA = /^[0-9a-f]{64}$/
const SSH_KEY =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/=]+( [^\r\n]{0,200})?$/

/** An SSH public key as it may be written into a machine, or null for one that is not. */
export function sshKeyOf(value: string): string | null {
  const key = value.trim()
  return SSH_KEY.test(key) ? key : null
}

/** A block of lines indented for a YAML literal under `content: |`. */
function block(lines: readonly string[]): string {
  return lines.map((line) => `      ${line}`).join('\n')
}

export function cloudInit(boot: Boot): string {
  if (!TOKEN.test(boot.secret) || !TOKEN.test(boot.tunnel)) {
    throw new Error('a machine secret that does not read')
  }
  if (!SHA.test(boot.bundle)) throw new Error('a bundle that is no SHA-256')
  const origin = new URL(boot.origin).origin
  const zone = ZONE.test(boot.zone) ? boot.zone : 'UTC'
  const key = boot.sshKey === null ? null : sshKeyOf(boot.sshKey)

  const files = [
    `  - path: /etc/nibd/env
    owner: root:root
    permissions: '0600'
    content: |
${block([`NIBD_SECRET=${boot.secret}`, `TZ=${zone}`])}`,
    `  - path: /etc/cloudflared/env
    owner: root:root
    permissions: '0600'
    content: |
${block([`TUNNEL_TOKEN=${boot.tunnel}`])}`,
    `  - path: /etc/nib/machine
    owner: root:root
    permissions: '0644'
    content: |
${block([`NIB_ORIGIN=${origin}`])}`,
  ]
  if (key) {
    files.push(`  - path: /etc/nibd/ssh_key
    owner: root:root
    permissions: '0600'
    content: |
${block([key])}`)
  }

  const bundle = `${origin}/v2/online/machine/${boot.bundle}.bin`
  const setUp = [
    'set -euo pipefail',
    `curl -fsSL --retry 10 --retry-delay 3 -o /root/machine.bin ${bundle}`,
    `echo '${boot.bundle}  /root/machine.bin' | sha256sum -c -`,
    'mkdir -p /root/machine /opt/nibd',
    'tar -xzf /root/machine.bin -C /root/machine',
    `echo ${boot.bundle} >/opt/nibd/bundle`,
    'bash /root/machine/install.sh --server',
    'rm -rf /root/machine /root/machine.bin',
    'rm -f /var/lib/cloud/instance/user-data.txt /var/lib/cloud/instance/user-data.txt.i',
  ].join('; ')

  return `#cloud-config
# A nib online terminal machine (docs/online-terminal.md 4.15).
hostname: nib
disable_root: true
ssh_pwauth: false
package_update: true
package_upgrade: true
write_files:
${files.join('\n')}
runcmd:
  - [bash, -c, ${JSON.stringify(setUp)}]
`
}

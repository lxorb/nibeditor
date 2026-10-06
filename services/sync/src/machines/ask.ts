/** Reaching a machine's object from a route: one `Machine` per machine id, asked one
 *  thing at a time by a header, as a hub is (hub/reach.ts).
 *
 *  Never a throw: whatever a route tells a machine about has already happened in the
 *  rows, and the object's minute alarm reads the rows again. */

import { chunks } from '../bound'
import type { Env } from '../types'

export type MachineAsk =
  | 'join'
  | 'start'
  | 'stop'
  | 'state'
  | 'typing'
  | 'revoke'
  | 'end'
  | 'erase'
  | 'restart'
  | 'reboot'
  | 'host'

export async function askMachine(
  env: Env,
  id: string,
  ask: MachineAsk,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  const namespace = env.MACHINES
  if (!namespace) return null

  // In the EU jurisdiction (decision 6), where the runtime offers one. `wrangler dev`'s
  // workerd throws on any jurisdiction, so a drive against a local `nibd` (DevHost, never
  // set on a deployed Worker) asks the namespace itself.
  const place =
    typeof namespace.jurisdiction === 'function' && !env.MACHINE_DEV_NIBD
      ? namespace.jurisdiction('eu')
      : namespace

  for (let asked = 0; asked < 2; asked++) {
    try {
      const machine = place.get(place.idFromName(id))
      return await machine.fetch(
        new Request(`https://machine.invalid/${ask}`, {
          headers: { ...headers, 'x-nib-machine': ask, 'x-nib-id': id },
        }),
      )
    } catch {
      // A reset object: the loop asks the one that replaced it.
    }
  }
  return null
}

/** The objects of machines that have gone for good, emptied: the container stopped,
 *  the sockets closed and the object's storage taken away. Answers the ids that are
 *  empty now; see leftovers.ts. */
export async function eraseMachines(env: Env, ids: readonly string[]): Promise<string[]> {
  if (!env.MACHINES) return [...ids]

  const emptied: string[] = []
  for (const round of chunks(ids, 20)) {
    const heard = await Promise.all(round.map((id) => askMachine(env, id, 'erase')))
    emptied.push(...round.filter((_, at) => heard[at]?.ok === true))
  }
  return emptied
}

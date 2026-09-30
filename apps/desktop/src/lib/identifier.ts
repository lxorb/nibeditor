/** Ids handed out within one run of the app: tabs, panes, documents, and the
 *  spaces the switcher keeps its order by.
 *
 *  The counter is what makes them unique. Eight random characters collide
 *  rarely, and rarely is not never, and two tabs sharing an id would share
 *  their place in the session and take each other's place in the strip. The random part
 *  keeps two windows from agreeing on the same id for different things. */

let handed = 0

export function identifier(): string {
  return `${(handed++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

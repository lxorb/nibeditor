/** What a program acting for somebody may reach.
 *
 *  There is already a token for that: `nib_...`, minted in the settings for an
 *  LLM connector, hashed at rest, one per account, read-only or not. Until now
 *  it reached exactly one endpoint, `POST /mcp`, and everything there answers in
 *  prose for a model - which is the right shape for a model and the wrong shape
 *  for a script. A repository of notes that wants to publish from CI needs the
 *  ordinary sync surface: the change feed, a note's words, a note written back, and
 *  the one rescue - a space put back to how it read at a moment.
 *
 *  So the same token reaches those too, and nothing else. Written as what is
 *  allowed rather than what is refused, the way the guest allowlist is, so a
 *  route added tomorrow is closed to a program until somebody says otherwise.
 *
 *  What is deliberately not in the list:
 *
 *  Deleting. A script that can delete is a script that can empty a space on a
 *  bad `if`, and nothing about publishing from CI needs it. A note taken away in
 *  the app still syncs down to a checkout as a tombstone; a checkout cannot take
 *  one away. A rollback is not this: it writes versions rather than removing rows,
 *  so a bad `if` there is another rollback away from being undone.
 *
 *  Anything about the account. No sharing, no publishing, no settings, no
 *  spaces created or renamed, no trash. A token in a CI secret should be able to
 *  read and write notes and to be unable to do anything else.
 *
 *  A per-space scope is not here either, and that is a gap worth naming: the
 *  token is the account's, so a CI job that can write one space can write them
 *  all. Narrowing it means a column and a second pane, which is a decision for
 *  whoever wants it rather than something to guess at. See docs/sync.md. */

const OPEN_TO_PROGRAMS: readonly { method: string; path: RegExp }[] = [
  // Which spaces there are, so a script can name one by its name.
  { method: 'GET', path: /^\/v1\/spaces$/ },
  // The change feed, which is how a checkout catches up without asking for
  // every note: a cursor in, the notes that moved out.
  { method: 'GET', path: /^\/v1\/spaces\/[^/]+\/changes$/ },
  // One note's words, and a note written back.
  { method: 'GET', path: /^\/v1\/notes\/[^/]+$/ },
  { method: 'PUT', path: /^\/v1\/notes\/[^/]+$/ },
  { method: 'POST', path: /^\/v1\/spaces\/[^/]+\/notes$/ },
  // What a note said before, which is what makes a mirror able to check itself.
  { method: 'GET', path: /^\/v1\/notes\/[^/]+\/versions$/ },
  { method: 'GET', path: /^\/v1\/notes\/[^/]+\/versions\/[^/]+$/ },
  // A space, or one folder of it, put back to how it read at a moment. Which is
  // the rescue a headless job needs and the app's pane has: a build that wrote a
  // thousand notes wrong is not something to undo by hand in a settings pane.
  //
  // It is here rather than beside the delete below because it is not one. Every
  // note it changes keeps what it said as a version, which is what makes a rollback
  // an edit like any other and undoable by another rollback; a `dry` run answers
  // what would change without changing anything; and it is bounded to four hundred
  // notes a request, so nothing about it is a way to spend an account in one call.
  // See `rollback` in notes.ts.
  { method: 'POST', path: /^\/v1\/spaces\/[^/]+\/rollback$/ },
]

/** The methods that change something, for a token that may only read. */
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function programMayReach(method: string, path: string, readOnly: boolean): boolean {
  if (readOnly && WRITES.has(method)) return false

  return OPEN_TO_PROGRAMS.some((one) => one.method === method && one.path.test(path))
}

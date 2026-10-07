/** The sentences more than one module refuses with.
 *
 *  Every refusal here is wire text: the service answers `{ error }` and the app
 *  drops it into a line of its own, so the bytes are the contract and an older
 *  client shows whatever this sends. They are lowercase for that reason, and none
 *  of them names a field a reader has never heard of.
 *
 *  A sentence two modules both send has to be the same sentence, and ten of them
 *  were two copies of a literal - which is a sentence that stays the same until
 *  somebody improves one of the two. Only the ones more than one module sends: a
 *  sentence one route sends three times is that route's own constant, beside the
 *  route. See test/refused.test.ts, which reads the rest off the source.
 *
 *  Nothing here is translated. The app translates what it shows; these arrive as the
 *  fallback for a client with nothing better. */

/** A body that was not the object the route reads its fields out of; see
 *  `objectBody` in body.ts. */
export const NOT_AN_OBJECT = 'send an object'

/** A space id nobody in this account can reach, said the same way as a note's. */
export const NO_SUCH_SPACE = 'no such space'

/** A note id nobody in this account can reach. Not "you may not": whether a note
 *  exists is itself something a stranger should not learn. */
export const NO_SUCH_NOTE = 'no such note'

/** No session, or one that has finished. The guard on `/v1/*`, the room's socket
 *  and the MCP endpoint each answer it, because each is reached without one. */
export const SIGN_IN = 'sign in first'

/** An emailed code, or one out of an authenticator, that was not the code. The same
 *  words for both: which of the two was wrong is not for somebody guessing. */
export const WRONG_CODE = 'that code is not right'

/** An address that has had its fill for the hour: of codes tried at it, or of
 *  mail sent to it. */
export const TRY_IN_AN_HOUR = 'too many tries - try again in an hour'

export const TOOK_TOO_LONG = 'start again - that took too long'

/** A path that climbs out of its space, names a disk, or is not a path at all. */
export const NOT_A_PATH = 'that path is not usable'

/** The account has no room for what is arriving. 507: the storage is at fault
 *  rather than the request. */
export const OUT_OF_SPACE = 'out of space'
/** A file named by anything but its hash, which a correct client never sends. */
export const NOT_A_HASH = 'that is not a hash'

export const SPACE_IS_FULL = 'that is as many people as one space holds'
export const NOT_AN_EMAIL = 'enter a valid email address'

/** A blog route reached before the space has an address. */
export const NO_ADDRESS = 'choose an address'

/** A guest reaching for something only an account has. */
export const SIGN_IN_TO_DO_THAT = 'sign in to do that'

/** A web state written under a lease that has since gone to another device: the
 *  hub refuses it, and so does the route for a device that holds no lease at all.
 *  See hub/hub.ts. A capture uploads in the background and the app answers a 409 with
 *  its own lock surface, so nobody reads this and it has no catalogue row. */
export const FENCED = 'another device is using this site now'

/** A note's room that did not answer: a moment to wait through, as a deploy is. The
 *  room's own door answers it to a socket, and a v1 save of a note whose room writes
 *  it answers it too. */
export const ROOM_AWAY = 'this room is not answering - try again'

/** Too many changes to a space's tree, or too many documents pushed, in a minute; see
 *  `mayChangeTree` in limits.ts. */
export const TOO_MANY_CHANGES = 'too many changes at once - try again in a minute'

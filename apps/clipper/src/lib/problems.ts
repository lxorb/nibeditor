/** Everything that can go wrong, as one sentence each.
 *
 *  The English sentence is the value that travels: between the content script,
 *  the service worker and the popup, and into `t()` at the moment it is drawn.
 *  That is how the app carries the service's own refusals too, and it means a
 *  sentence can never arrive somewhere as a code nothing has words for. */
export const PROBLEMS = {
  /** No session, so there is nowhere to put a note. */
  signIn: 'Sign in to nibeditor first.',
  /** A session, but the account has no space to write into yet. */
  noSpaces: 'Make a space in nibeditor first.',
  /** A page no extension may read: chrome://, the Web Store, the PDF viewer. */
  blocked: 'This page cannot be clipped.',
  /** The extractor found no article, nothing is selected, and the body is bare. */
  empty: 'There is nothing to clip here.',
  /** Past the API's four megabytes, before anything was sent. */
  tooLarge: 'This clip is larger than a note can be.',
  /** The account is full; see the 507 in `services/sync/src/storage.ts`. */
  full: 'Your account is out of space.',
  /** The network, or a service that answered with something unreadable. */
  unreachable: 'Could not reach nibeditor.',
  /** The interpreter's provider: no network, nothing listening at the address,
   *  or a refusal it gave no words for. Where it did give words, those are shown
   *  instead - untranslated, the way the sync service's are. */
  provider: 'Could not reach the provider.',
  /** The provider answered, and what it said was not properties. */
  unreadable: 'The provider answered with something else.',
} as const

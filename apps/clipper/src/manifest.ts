/** The extension's manifest, written here rather than as JSON so that the
 *  permissions can say why they are asked for. `vite.config.ts` emits it as
 *  `manifest.json` beside the bundles.
 *
 *  Chrome's own surfaces - the tile on chrome://extensions, the listing in the
 *  store, the shortcut list - read their words from `_locales`, which is the only
 *  mechanism they have: Chrome picks the folder by its own interface language and
 *  falls back to `default_locale`. So `public/_locales` covers the languages
 *  Chrome's interface is translated into, which is thirty-one of the catalogues.
 *
 *  Everything the extension itself draws is translated through those catalogues
 *  instead - all thirty-nine of them, chosen on the options page rather than by
 *  the browser; see `lib/translate.ts`. `src/lib/i18n.test.ts` holds the two
 *  halves to the same languages. */

export const manifest: chrome.runtime.ManifestV3 = {
  manifest_version: 3,
  name: '__MSG_name__',
  description: '__MSG_description__',
  default_locale: 'en',
  version: '0.1.0',

  icons: {
    16: 'icons/16.png',
    32: 'icons/32.png',
    48: 'icons/48.png',
    128: 'icons/128.png',
  },

  action: { default_popup: 'popup.html' },
  options_ui: { page: 'options.html', open_in_tab: true },
  background: { service_worker: 'background.js', type: 'module' },

  permissions: [
    // The session token, the space a clip goes to, and the language.
    'storage',
    // The three clip actions, on the page's own menu.
    'contextMenus',
    // The reader is injected into the tab the person triggered this from, and
    // only then. Nothing runs on a page nobody asked about.
    'scripting',
    'activeTab',
  ],

  // A clipped picture is fetched from wherever the article keeps it, which is
  // any host at all, and uploaded to the account so the note stops depending on
  // the site. That is the whole reason for the breadth; nibeditor.com alone
  // would leave every image a dead link the day the article moves.
  //
  // Asked for at install rather than at the first clip with pictures in it, which
  // would be the smaller prompt and was looked at: `chrome.permissions.request`
  // has to be made inside a user gesture, so it would move into the popup's Save
  // press; a reader who said no would need a sentence and a clip with no pictures
  // in it; and the browser drive - which runs the service worker directly and
  // fetches its pictures off a local server - has no way to answer a permission
  // prompt, so `test/e2e/clip.py` would stop proving anything. A narrower prompt
  // that costs a refusal path nobody designed and a drive that no longer drives is
  // not obviously the safer of the two. Said here so the next reader has the
  // reasoning rather than the question.
  host_permissions: ['<all_urls>'],

  // Suggestions rather than settings: Chrome hands them out only if nothing
  // else has them, and the options page links to chrome://extensions/shortcuts,
  // where they can be changed. `S` and `L` say what they do; the page would
  // have liked `P`, but Chrome keeps `Alt+Shift+` with A, C, N and P for itself
  // and hands out nothing at all rather than something else, so it gets the key
  // next to the link's.
  commands: {
    'clip-page': {
      suggested_key: { default: 'Alt+Shift+K' },
      description: '__MSG_clipPage__',
    },
    'clip-selection': {
      suggested_key: { default: 'Alt+Shift+S' },
      description: '__MSG_clipSelection__',
    },
    'clip-link': {
      suggested_key: { default: 'Alt+Shift+L' },
      description: '__MSG_clipLink__',
    },
  },
}

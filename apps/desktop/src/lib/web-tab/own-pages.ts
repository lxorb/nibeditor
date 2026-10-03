/** nib's own pages in a web tab: where Chrome has `chrome://history`.
 *
 *  Emil, 2026-09-13: what Chrome keeps inside the browser stays inside it, and Chrome
 *  keeps its history as a page in a tab, with its own address, that the address field
 *  leaves by being typed into. So does this: a web tab whose address is one of these
 *  draws nib's page in the pane where a site would be, builds no webview for it, and
 *  becomes an ordinary tab the moment it is sent anywhere else. The address is nib's
 *  own scheme, which no tab may open as a site (see `isWebAddress` in address.ts), so
 *  nothing outside this file can mistake one for the other.
 *
 *  Pure, and in no first paint: the pane asks it with the tab. */

/** The History page's address. */
export const HISTORY = 'nib://history'

/** Whether an address is one of nib's own pages. */
export function isOwnPage(url: string | null | undefined): boolean {
  return url === HISTORY
}

/** The page's mark for the strip and the bar, as the picture a site's favicon is: a
 *  clock going back, Chrome's own for its History. A picture rather than a glyph,
 *  because the strip draws a web tab's mark as a picture; the grey reads on either
 *  theme, as a site's own mark has to. */
export const HISTORY_MARK = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8a8f98" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>',
)}`

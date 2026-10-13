/** What the crate says when a page's browser did not answer and nothing was asked of it
 *  rather than the app waiting on it; see src-tauri/src/web_answers.rs. A tab's page and
 *  an extension's popup both say it, and both ask again a moment later. */
export const NOT_ANSWERING = 'that page is not answering'

/** How long before something a browser did not answer is asked again. A second: a
 *  browser busy with one heavy page is usually back by then, and each try costs the
 *  crate a moment of asking at most. */
export const ASK_AGAIN = 1000

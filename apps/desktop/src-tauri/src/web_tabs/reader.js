/** The page, read for a clip: the page's half of it, and deliberately the small half.
 *
 *  It writes the document down as the reader sees it - what a script wrote into it
 *  included, since a page that writes itself has already written itself - and nothing
 *  more. Finding the article in it is the window's, with the very extractor the clipper
 *  extension runs on a live page (`readSnapshot` in packages/markdown/src/article.ts), so
 *  the same page clips to the same note from a tab and from the extension. See
 *  packages/markdown/src/snapshot.ts for the two marks this writes.
 *
 *  - A doctype in front, which is how the window tells a snapshot from a fragment.
 *  - The reader's selection, when one was asked for and there is one, as the body, with
 *    `data-nib-selection` on the root. The head is the page's either way, so the title
 *    and the tags it publishes come along.
 *  - The page's base, resolved, as the first thing in the head: a document parsed in the
 *    window would otherwise resolve every relative address against the app.
 *  - No scripts, no styles, no stylesheets: nothing reads them, and they are most of a
 *    large page's bytes.
 *  - No field's value, and no password field at all - the rule `UNVALUED` in
 *    agents/page.rs holds an agent's markup to, because this is also what an agent reads
 *    a page's article with. Words typed into a field are not in markup anyway.
 *
 *  It runs in nib's own world where the engine offers one, and in the page's otherwise;
 *  see `web_clip`. Either way it touches nothing on the page: everything it changes is a
 *  copy. The answer is the object itself, which the engine hands back as JSON.
 *
 *  The crate fills in the two quoted words before it runs this: whether the selection is
 *  wanted, and how many characters at most come back. */
;(() => {
  const wanted = '__SELECTION__' === 'yes'
  const longest = Number('__LONGEST__')
  const title = (document.title || '').trim()

  try {
    const picked = wanted ? window.getSelection() : null
    const chosen =
      picked !== null &&
      !picked.isCollapsed &&
      picked.rangeCount > 0 &&
      picked.toString().trim() !== ''

    const root = document.documentElement.cloneNode(false)
    const head = document.head ? document.head.cloneNode(true) : document.createElement('head')
    let body

    if (chosen) {
      body = document.createElement('body')
      for (let index = 0; index < picked.rangeCount; index += 1) {
        body.append(picked.getRangeAt(index).cloneContents())
      }
      root.setAttribute('data-nib-selection', '')
    } else {
      body = document.body ? document.body.cloneNode(true) : document.createElement('body')
    }

    for (const one of head.querySelectorAll('base')) one.remove()
    const base = document.createElement('base')
    base.setAttribute('href', document.baseURI)
    head.prepend(base)

    root.append(head, body)
    for (const one of root.querySelectorAll('script, style, link')) one.remove()
    for (const one of root.querySelectorAll('input[type=password]')) one.remove()
    for (const one of root.querySelectorAll('input[value]')) one.removeAttribute('value')

    const html = `<!DOCTYPE html>${root.outerHTML}`
    return { url: location.href, title, html: html.slice(0, longest) }
  } catch {
    return { url: location.href, title, html: '' }
  }
})()

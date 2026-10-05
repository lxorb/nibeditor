/** The workspace and the pages online-opening.effect.test.ts opens tabs into: reactive,
 *  as the real stores are, so the watch over a tab's address runs as it does in the
 *  window. */

interface World {
  tabs: { id: string }[]
  active: string | null
}

class Page {
  url = $state<string | null>(null)
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- the pages are reactive, not the list
const pages = new Map<string, Page>()
const tabs = $state<{ id: string }[]>([])
let made = 0

function pageOf(id: string): Page {
  let page = pages.get(id)
  if (!page) {
    page = new Page()
    pages.set(id, page)
  }
  return page
}

export function pagesOf() {
  return { of: pageOf }
}

/** The tab `id` arriving at `url`, as the engine says it. */
export function land(id: string, url: string) {
  pageOf(id).url = url
}

export function reactive(
  world: World,
  opened: { url: string; ask: string; opener: string | undefined }[],
  closed: string[],
) {
  return {
    get tabs() {
      return [...world.tabs, ...tabs]
    },
    get activeTabId() {
      return world.active
    },
    set activeTabId(id: string | null) {
      world.active = id
    },
    openPage(url: string, ask: string, opener?: string) {
      made += 1
      const id = `tab-${String(made)}`
      opened.push({ url, ask, opener })
      tabs.push({ id })
      pageOf(id).url = url
      return id
    },
    close(id: string) {
      closed.push(id)
      const at = tabs.findIndex((one) => one.id === id)
      if (at >= 0) tabs.splice(at, 1)
    },
  }
}

/** A clean world for the next test. */
export function reset() {
  made = 0
  tabs.length = 0
  pages.clear()
}

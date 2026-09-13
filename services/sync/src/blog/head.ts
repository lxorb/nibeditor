/** The head of a published page, and the page it sits on.
 *
 *  Every page a site answers with - the index, a note, the password form, the
 *  one that says a path is not there - is the same document with a different
 *  body, so there is one place that writes the shell. What goes in the head is
 *  the other half of publishing a note: a title, a description, where the page
 *  lives, the picture a shared link shows, the feed a reader can follow and the
 *  icon a tab draws.
 *
 *  The values come from the note first and the site second; nothing here decides
 *  anything, it only writes what it is given. What a page says about itself is
 *  blog/front.ts, what the site says is spaces/site.ts. */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

export function escape(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character)
}

/** Everything the head of one page says. Whatever is absent is not written: a
 *  page with no description is a page with no description tag, not one with an
 *  empty one. */
export interface Head {
  /** What the tab says, and the title a shared link shows. */
  title: string
  /** The site's own name, for `og:site_name` and for a page that is the site. */
  site: string
  /** Where this page lives, absolute, for the canonical and `og:url`. */
  url: string
  description?: string | undefined
  /** Absolute, because the machines that read it do not resolve relative ones. */
  image?: string | undefined
  author?: string | null | undefined
  /** A page that is one piece of writing rather than the site's own front. */
  article?: boolean
  /** What the page's own date is, where it has one. */
  date?: string | undefined
  /** Whether the site offers a feed and an icon: both are the site's, so both
   *  are the same answer on every page of it. */
  feed?: boolean
  icon?: boolean
  /** A page nothing should index: the password form, which is the one page a
   *  crawler can reach on a site behind a password. */
  noindex?: boolean
  /** Extra stylesheets a deck needs, in the order they load. */
  sheets?: readonly string[]
  /** What goes at the end of the head as it is, for a deck's stage sizes. */
  style?: string
}

function tag(name: string, content: string | undefined): string {
  return content ? `<meta name="${name}" content="${escape(content)}">` : ''
}

function property(name: string, content: string | undefined): string {
  return content ? `<meta property="${name}" content="${escape(content)}">` : ''
}

/** The whole head, as one string.
 *
 *  Written in the order a reader of the source would want it: what the page is,
 *  then what machines are told about it, then what it loads. */
export function headOf(head: Head, sheets: readonly string[]): string {
  const description = head.description
  const canonical = head.url

  return [
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escape(head.title)}</title>`,
    tag('description', description),
    tag('author', head.author ?? undefined),
    head.noindex ? tag('robots', 'noindex, nofollow') : '',
    `<link rel="canonical" href="${escape(canonical)}">`,
    // Open Graph, which is what a link pasted into a chat reads, and Twitter's
    // own names for the same four things. A card with a picture is a different
    // card from one without, so the kind is said rather than guessed at.
    property('og:type', head.article ? 'article' : 'website'),
    property('og:title', head.title),
    property('og:description', description),
    property('og:url', canonical),
    property('og:site_name', head.site),
    property('og:image', head.image),
    head.article && head.date ? property('article:published_time', head.date) : '',
    tag('twitter:card', head.image ? 'summary_large_image' : 'summary'),
    tag('twitter:title', head.title),
    tag('twitter:description', description),
    tag('twitter:image', head.image),
    // Both feeds, because a reader pastes the address of a page into a reader and
    // lets it find the feed: one that only reads RSS and found only Atom would have
    // found nothing. The same writing either way; see blog/feed.ts.
    head.feed
      ? `<link rel="alternate" type="application/atom+xml" title="${escape(head.site)}" href="/feed.xml">
<link rel="alternate" type="application/rss+xml" title="${escape(head.site)}" href="/rss.xml">`
      : '',
    head.icon
      ? '<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/favicon.svg">'
      : '',
    ...sheets.map((href) => `<link rel="stylesheet" href="${escape(href)}">`),
    head.style ? `<style>${head.style}</style>` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** The search engines the address field can send a few words to: Chrome's list.
 *
 *  Emil's browser vision (2026-09-13) keeps the search engine choice inside the browser,
 *  where Chrome keeps it: Settings, one row, the engines Chrome offers for the reader's
 *  region and a custom one written with `%s` where the words go. Google stays the first
 *  and the default, which was Emil's call; see `SEARCH` in address.ts.
 *
 *  The addresses are the ones Chrome's own prepopulated list sends a search to
 *  (components/search_engines/prepopulated_engines.json), with `{searchTerms}` written
 *  as the `%s` Chrome's own custom engines use. Pure, so the list and what a choice
 *  makes of a few words are tested apart from any setting. */

import { isWebAddress, SEARCH, WORDS } from './address'

/** One engine: what it is called and where its search goes. */
export interface Engine {
  id: string
  name: string
  /** The search's address, `%s` where the words go. */
  url: string
}

/** The ones Chrome offers everywhere, in the order its own settings list them. */
const EVERYWHERE: readonly Engine[] = [
  { id: 'google', name: 'Google', url: SEARCH },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  { id: 'brave', name: 'Brave', url: 'https://search.brave.com/search?q=%s' },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/do/search?query=%s' },
  { id: 'qwant', name: 'Qwant', url: 'https://www.qwant.com/?q=%s' },
  { id: 'yahoo', name: 'Yahoo!', url: 'https://search.yahoo.com/search?p=%s' },
]

/** And the ones Chrome adds where a region has its own, by the reader's language. */
const REGIONAL: Readonly<Record<string, readonly Engine[]>> = {
  zh: [
    { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=%s' },
    { id: 'sogou', name: '搜狗', url: 'https://www.sogou.com/web?query=%s' },
    { id: 'so', name: '360', url: 'https://www.so.com/s?q=%s' },
  ],
  ja: [{ id: 'yahoo-jp', name: 'Yahoo! JAPAN', url: 'https://search.yahoo.co.jp/search?p=%s' }],
  ko: [
    { id: 'naver', name: 'NAVER', url: 'https://search.naver.com/search.naver?query=%s' },
    { id: 'daum', name: 'Daum', url: 'https://search.daum.net/search?q=%s' },
  ],
  ru: [{ id: 'yandex', name: 'Яндекс', url: 'https://yandex.ru/search/?text=%s' }],
}

/** The engines offered to a reader whose system speaks `language` (a BCP 47 tag). */
export function enginesFor(language: string): readonly Engine[] {
  const base = language.toLowerCase().split('-')[0] ?? ''
  return [...EVERYWHERE, ...(REGIONAL[base] ?? [])]
}

/** Every engine any region is offered, which is what a choice is read back against: a
 *  reader who chose Naver keeps it on a machine set to English. */
const ALL: readonly Engine[] = [...EVERYWHERE, ...Object.values(REGIONAL).flat()]

/** The engine with this id, or null. */
export function engineById(id: string): Engine | null {
  return ALL.find((one) => one.id === id) ?? null
}

/** Whether a custom engine's address can take a search: a web address once the words
 *  are in it, with somewhere to put them. */
export function isEngineAddress(url: string): boolean {
  const said = url.trim()
  return said.includes(WORDS) && isWebAddress(said.replaceAll(WORDS, 'nib'))
}

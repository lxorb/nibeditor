"""Does dump.js read out everything a site keeps, and does restore.js put it back as it was?

The two scripts beside this file are the page's half of carrying a web login from one
computer to another (see src-tauri/src/web_state.rs and docs/sync-v2.md 6.4). This drives
them in a real engine, headless, against a corpus of every kind of value IndexedDB can hold:
primitives with -0, NaN and the infinities, BigInts, sparse arrays and arrays with keys of
their own, a `__proto__` key, cycles and shared references, Dates valid and not, RegExps,
Maps and Sets with objects for keys, boxed primitives, ArrayBuffers and every typed array
and DataView (two views of one buffer included), Blobs and Files, Errors, CryptoKeys secret
and private, ImageData; keys of every kind (numbers, strings, dates, binary, arrays); stores
with key paths simple and compound, auto-increment, unique and multi-entry indexes; a
database with no stores (which broke Playwright's own); one past the size ceiling; one
holding a key that may not be exported. Plus localStorage and sessionStorage.

Per engine:

  1. a page on https://corpus.nib.test (answered by the route, so no network and a secure
     context) writes the corpus;
  2. dump.js reads it out;
  3. a fresh context, which is a second computer, restores it with restore.js;
  4. dump.js reads that out again, and the two dumps must be the same bytes;
  5. and the restored values are compared, in the page, with the corpus built again:
     types, prototypes, identity (a shared object is still shared, a cycle still a cycle),
     bytes of every buffer and Blob, keys by `indexedDB.cmp`, schema, index lookups, and
     that an auto-increment store carries on from its last key.

    python apps/desktop/src-tauri/src/web_state/scripts/corpus.py            chromium, webkit
    python apps/desktop/src-tauri/src/web_state/scripts/corpus.py firefox    any list

Exits non-zero on the first engine that does not round-trip.
"""

from __future__ import annotations

import json
import pathlib
import sys
import tempfile

from playwright.sync_api import BrowserContext, Page, Playwright, sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
DUMP = (HERE / "dump.js").read_text(encoding="utf-8")
RESTORE = (HERE / "restore.js").read_text(encoding="utf-8")

ORIGIN = "https://corpus.nib.test"

# Built the same way on both sides: written on the first computer, and built again on the
# second to compare what arrived with. Deterministic, so the two builds are equal.
CORPUS = r"""
globalThis.nibCorpus = async function nibCorpus() {
  const shared = { x: 1 }
  const cyclic = { name: 'self' }
  cyclic.self = cyclic
  const looped = []
  looped.push(looped)
  const mapped = new Map()
  mapped.set(mapped, mapped)
  mapped.set({ key: 'object' }, shared)
  const buffer = new ArrayBuffer(16)
  new Uint8Array(buffer).set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
  const sparse = [1, , 3]
  const keyed = ['a', 'b']
  keyed.extra = 'kept'
  const views = {}
  for (const name of ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array',
    'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array',
    'Float64Array', 'BigInt64Array', 'BigUint64Array']) {
    const View = globalThis[name]
    if (typeof View !== 'function') continue
    const bytes = new Uint8Array(View.BYTES_PER_ELEMENT * 3)
    for (let at = 0; at < bytes.length; at++) bytes[at] = (at * 37 + 11) & 255
    views[name] = new View(bytes.buffer)
  }
  const aes = await crypto.subtle.importKey('raw',
    new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
  const hmac = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7),
    { name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify'])
  const ec = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    d: 'Hy49TFtqeYgfLj1MW2p5iB8uPUxbanmIHy49TFtqeYg',
    x: 'vXxzuIsum0ztpiAistqL4TGTpbVu3Cbn33hC4kzQtes',
    y: 'BgWtp72oOsaiuA1-MUBA-kf_Frg7rIXO2wFEUbt85xo',
    ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
  const pixels = new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]), 2, 1)
  const error = new TypeError('boom')

  return {
    zero: 0, negativeZero: -0, float: 1.5, nan: NaN, infinity: Infinity,
    negativeInfinity: -Infinity, largest: Number.MAX_VALUE, tiny: Number.MIN_VALUE,
    empty: '', text: 'unicode ✓ 𝄞 \u0000 end', yes: true, no: false,
    nothing: null, missing: undefined, big: 10n ** 30n, negativeBig: -1n,
    array: [1, 'a', [2, [3]]], sparse, holes: new Array(5), keyed,
    object: { nested: { deeper: { deepest: 'x' } }, list: [{}, []] },
    proto: JSON.parse('{"__proto__": 5, "constructor": "c"}'),
    kKey: { k: 1, '#': 2, o: ['k'] },
    cyclic, looped, mapped, sharing: { a: shared, b: [shared, shared] },
    date: new Date(0), later: new Date(8.64e15), invalid: new Date(NaN),
    regexp: /a+b/gi, unicodeRegexp: /[\u{1F600}]/u, sticky: Object.assign(/x/y, { lastIndex: 3 }),
    map: new Map([[1, 'one'], ['two', 2], [{ o: 1 }, [shared]]]),
    set: new Set([1, 'a', shared, shared]),
    boxedFalse: new Boolean(false), boxedZero: new Number(-0), boxedText: new String('boxed'),
    boxedBig: Object(10n),
    emptyBuffer: new ArrayBuffer(0), buffer,
    overOne: { u8: new Uint8Array(buffer, 4, 8), dv: new DataView(buffer, 2, 6),
      f32: new Float32Array(buffer, 8, 2), whole: buffer },
    views,
    blob: new Blob(['hello ', new Uint8Array([0, 255, 128])], { type: 'text/plain' }),
    emptyBlob: new Blob([]),
    file: new File(['file body'], 'notes.txt', { type: 'text/plain', lastModified: 1700000000000 }),
    error,
    errors: [new Error('plain'), new RangeError('range')],
    aes, hmac, ec,
    pixels,
  }
}

globalThis.nibKeys = function nibKeys() {
  return [
    -Infinity, -1.5, 0, 7, Infinity,
    '', 'a', 'zé', '𝄞',
    new Date(0), new Date(1700000000000),
    new Uint8Array([]).buffer, new Uint8Array([0, 1, 255]).buffer,
    [], [1, 'a'], [new Date(5), [2, new Uint8Array([9]).buffer]],
  ]
}

function answered(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

async function opened(name, version, upgrade) {
  const request = indexedDB.open(name, version)
  request.onupgradeneeded = () => upgrade(request.result)
  return answered(request)
}

globalThis.nibSeed = async function nibSeed() {
  const corpus = await nibCorpus()
  localStorage.setItem('token', 'abc.def')
  localStorage.setItem('unicode ✓', 'value 𝄞')
  localStorage.setItem('empty', '')
  sessionStorage.setItem('wizard', 'step 3')
  sessionStorage.setItem('draft', '{"a":1}')

  let db = await opened('values', 1, (made) => made.createObjectStore('plain'))
  let transaction = db.transaction('plain', 'readwrite')
  for (const [name, value] of Object.entries(corpus)) {
    transaction.objectStore('plain').put(value, name)
  }
  transaction.objectStore('plain').put(corpus, 'all at once')
  await done(transaction)
  db.close()

  db = await opened('keys', 3, (made) => made.createObjectStore('k'))
  transaction = db.transaction('k', 'readwrite')
  nibKeys().forEach((key, at) => transaction.objectStore('k').put(at, key))
  await done(transaction)
  db.close()

  db = await opened('shaped', 7, (made) => {
    const inline = made.createObjectStore('inline', { keyPath: 'id' })
    inline.createIndex('byTag', 'tags', { multiEntry: true })
    inline.createIndex('byEmail', 'email', { unique: true })
    const compound = made.createObjectStore('compound', { keyPath: ['a', 'b'] })
    compound.createIndex('reversed', ['b', 'a'])
    made.createObjectStore('counter', { keyPath: 'n', autoIncrement: true })
    made.createObjectStore('auto', { autoIncrement: true })
  })
  transaction = db.transaction(['inline', 'compound', 'counter', 'auto'], 'readwrite')
  transaction.objectStore('inline').put({ id: 1, tags: ['x', 'y'], email: 'a@x' })
  transaction.objectStore('inline').put({ id: 2, tags: ['y'], email: 'b@x' })
  transaction.objectStore('compound').put({ a: 1, b: 'two', payload: corpus.sharing })
  transaction.objectStore('compound').put({ a: 2, b: 'one' })
  for (const word of ['first', 'second', 'third']) {
    transaction.objectStore('counter').put({ word })
    transaction.objectStore('auto').put(word)
  }
  await done(transaction)
  db.close()

  db = await opened('empty', 2, () => undefined)
  db.close()

  db = await opened('big', 1, (made) => made.createObjectStore('s'))
  transaction = db.transaction('s', 'readwrite')
  transaction.objectStore('s').put('x'.repeat(200000), 'large')
  await done(transaction)
  db.close()

  db = await opened('unmovable', 1, (made) => made.createObjectStore('s'))
  const locked = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false,
    ['encrypt'])
  transaction = db.transaction('s', 'readwrite')
  transaction.objectStore('s').put(locked, 'key')
  await done(transaction)
  db.close()
}

/** What arrived, against the corpus built again here: a list of what differs. */
globalThis.nibCheck = async function nibCheck() {
  const problems = []
  const tagOf = (value) => Object.prototype.toString.call(value).slice(8, -1)

  async function bytesOf(blob) {
    return [...new Uint8Array(await blob.arrayBuffer())].join(',')
  }

  async function same(expected, actual, path, pairs) {
    if (typeof expected !== typeof actual) {
      problems.push(`${path}: ${typeof expected} became ${typeof actual}`)
      return
    }
    if (typeof expected !== 'object' || expected === null || actual === null) {
      if (!Object.is(expected, actual)) problems.push(`${path}: ${String(expected)} became ${String(actual)}`)
      return
    }
    if (pairs.has(expected)) {
      if (pairs.get(expected) !== actual) problems.push(`${path}: a shared object came apart`)
      return
    }
    pairs.set(expected, actual)
    const tag = tagOf(expected)
    if (tagOf(actual) !== tag) {
      problems.push(`${path}: a ${tag} became a ${tagOf(actual)}`)
      return
    }
    if (Object.getPrototypeOf(expected) === Object.prototype
      && Object.getPrototypeOf(actual) !== Object.prototype) {
      problems.push(`${path}: the prototype changed`)
    }
    switch (tag) {
      case 'Object':
      case 'Array': {
        const keys = Object.keys(expected)
        if (JSON.stringify(keys) !== JSON.stringify(Object.keys(actual))) {
          problems.push(`${path}: keys ${keys} became ${Object.keys(actual)}`)
          return
        }
        if (tag === 'Array' && expected.length !== actual.length) {
          problems.push(`${path}: length ${expected.length} became ${actual.length}`)
        }
        for (const key of keys) await same(expected[key], actual[key], `${path}.${key}`, pairs)
        return
      }
      case 'Date':
        if (!Object.is(expected.getTime(), actual.getTime())) problems.push(`${path}: the date moved`)
        return
      case 'RegExp':
        if (expected.source !== actual.source || expected.flags !== actual.flags
          || actual.lastIndex !== 0) problems.push(`${path}: the pattern changed`)
        return
      case 'Map':
      case 'Set': {
        const left = [...expected.entries()]
        const right = [...actual.entries()]
        if (left.length !== right.length) {
          problems.push(`${path}: ${left.length} entries became ${right.length}`)
          return
        }
        for (let at = 0; at < left.length; at++) {
          await same(left[at][0], right[at][0], `${path}[${at}].key`, pairs)
          await same(left[at][1], right[at][1], `${path}[${at}].value`, pairs)
        }
        return
      }
      case 'Boolean':
      case 'Number':
      case 'String':
      case 'BigInt':
        if (!Object.is(expected.valueOf(), actual.valueOf())) problems.push(`${path}: the boxed value changed`)
        return
      case 'ArrayBuffer': {
        const left = [...new Uint8Array(expected)].join(',')
        const right = [...new Uint8Array(actual)].join(',')
        if (left !== right) problems.push(`${path}: the bytes changed`)
        return
      }
      case 'Blob':
      case 'File':
        if (expected.type !== actual.type || await bytesOf(expected) !== await bytesOf(actual)) {
          problems.push(`${path}: the blob changed`)
        }
        if (tag === 'File' && (expected.name !== actual.name
          || expected.lastModified !== actual.lastModified)) problems.push(`${path}: the file changed`)
        return
      case 'Error':
      case 'TypeError':
        if (expected.name !== actual.name || expected.message !== actual.message) {
          problems.push(`${path}: the error changed`)
        }
        return
      case 'CryptoKey': {
        const format = expected.type === 'secret' ? 'raw' : 'jwk'
        const left = JSON.stringify(format === 'raw'
          ? [...new Uint8Array(await crypto.subtle.exportKey(format, expected))]
          : await crypto.subtle.exportKey(format, expected))
        const right = JSON.stringify(format === 'raw'
          ? [...new Uint8Array(await crypto.subtle.exportKey(format, actual))]
          : await crypto.subtle.exportKey(format, actual))
        if (left !== right || expected.type !== actual.type
          || JSON.stringify(expected.usages) !== JSON.stringify(actual.usages)
          || expected.algorithm.name !== actual.algorithm.name) problems.push(`${path}: the key changed`)
        return
      }
      case 'ImageData':
        if (expected.width !== actual.width || expected.height !== actual.height
          || expected.data.join(',') !== actual.data.join(',')) problems.push(`${path}: the pixels changed`)
        return
      default:
        if (ArrayBuffer.isView(expected)) {
          if (expected.byteOffset !== actual.byteOffset || expected.byteLength !== actual.byteLength) {
            problems.push(`${path}: the view moved`)
          }
          await same(expected.buffer, actual.buffer, `${path}.buffer`, pairs)
          return
        }
        problems.push(`${path}: nothing compares a ${tag}`)
    }
  }

  const corpus = await nibCorpus()
  let db = await answered(indexedDB.open('values'))
  let store = db.transaction('plain').objectStore('plain')
  for (const [name, value] of Object.entries(corpus)) {
    await same(value, await answered(store.get(name)), name, new Map())
    store = db.transaction('plain').objectStore('plain')
  }
  await same(corpus, await answered(store.get('all at once')), 'all at once', new Map())
  db.close()

  db = await answered(indexedDB.open('keys'))
  const keys = await answered(db.transaction('k').objectStore('k').getAllKeys())
  const expectedKeys = nibKeys()
  if (keys.length !== expectedKeys.length) problems.push(`keys: ${keys.length} of ${expectedKeys.length}`)
  for (const key of expectedKeys) {
    if (!keys.some((one) => indexedDB.cmp(one, key) === 0)) problems.push(`keys: ${String(key)} is missing`)
  }
  if (db.version !== 3) problems.push(`keys: version ${db.version}`)
  db.close()

  db = await answered(indexedDB.open('shaped'))
  if (db.version !== 7) problems.push(`shaped: version ${db.version}`)
  let transaction = db.transaction(['inline', 'compound', 'counter', 'auto'], 'readwrite')
  const inline = transaction.objectStore('inline')
  if (inline.keyPath !== 'id') problems.push('shaped: inline lost its key path')
  const byTag = inline.index('byTag')
  const byEmail = inline.index('byEmail')
  if (!byTag.multiEntry || byTag.unique) problems.push('shaped: byTag changed')
  if (!byEmail.unique || byEmail.multiEntry) problems.push('shaped: byEmail changed')
  if ((await answered(byTag.getAll('y'))).length !== 2) problems.push('shaped: byTag finds the wrong rows')
  if ((await answered(byEmail.get('b@x')))?.id !== 2) problems.push('shaped: byEmail finds the wrong row')
  const compound = transaction.objectStore('compound')
  if (JSON.stringify(compound.keyPath) !== '["a","b"]') problems.push('shaped: compound key path')
  if (JSON.stringify(compound.index('reversed').keyPath) !== '["b","a"]') problems.push('shaped: reversed index')
  const sharing = (await answered(compound.get([1, 'two']))).payload
  if (sharing.a !== sharing.b[0] || sharing.b[0] !== sharing.b[1]) problems.push('shaped: shared payload came apart')
  const counter = transaction.objectStore('counter')
  if (!counter.autoIncrement) problems.push('shaped: counter lost auto-increment')
  const next = await answered(counter.add({ word: 'fourth' }))
  if (next !== 4) problems.push(`shaped: the counter carries on at ${next}, not 4`)
  const autoNext = await answered(transaction.objectStore('auto').add('fourth'))
  if (autoNext !== 4) problems.push(`shaped: auto carries on at ${autoNext}, not 4`)
  transaction.abort()
  db.close()

  const names = (await indexedDB.databases()).map((one) => one.name).sort()
  if (JSON.stringify(names) !== '["empty","keys","shaped","values"]') {
    problems.push(`databases: ${names}`)
  }
  if (localStorage.getItem('token') !== 'abc.def' || localStorage.getItem('empty') !== '') {
    problems.push('localStorage')
  }
  if (sessionStorage.getItem('wizard') !== 'step 3') problems.push('sessionStorage')
  return problems
}
"""


def dumped(page: Page, most: dict[str, int]) -> dict[str, object]:
    """Everything dump.js says about the page, one call per database as the crate makes."""

    listed = json.loads(page.evaluate("(a) => nibDump('list', a)", json.dumps({"session": True})))
    databases = {}
    for one in sorted(listed["databases"], key=lambda db: db["name"]):
        asked = {"name": one["name"], "most": most.get(one["name"], 16 * 1024 * 1024)}
        databases[one["name"]] = page.evaluate("(a) => nibDump('database', a)", json.dumps(asked))
    listed["databases"] = sorted(listed["databases"], key=lambda db: db["name"])
    return {"list": listed, "databases": databases}


def fresh_page(playwright: Playwright, engine: str, folder: str) -> tuple[BrowserContext, Page]:
    """A browser with a profile of its own in `folder`, which is one computer.

    A persistent profile rather than Playwright's usual throwaway context, because that
    is what a web store is, and because WebKit refuses a Blob in IndexedDB in a session
    that keeps nothing (as Safari's private windows do)."""

    context = getattr(playwright, engine).launch_persistent_context(folder, headless=True)
    page = context.new_page()
    page.route(
        f"{ORIGIN}/**",
        lambda route: route.fulfill(
            status=200, content_type="text/html", body="<!doctype html><title>corpus</title>"
        ),
    )
    page.goto(f"{ORIGIN}/")
    # As scripts of the page rather than evaluated expressions: each file's value is a
    # function, which Playwright would take for one to call.
    for source in (DUMP, RESTORE, CORPUS):
        page.add_script_tag(content=source)
    return context, page


def round_trip(engine: str) -> list[str]:
    problems: list[str] = []
    with sync_playwright() as playwright, tempfile.TemporaryDirectory(
        prefix="nib-corpus-"
    ) as here:
        one, first = fresh_page(playwright, engine, f"{here}/one")
        two, second = fresh_page(playwright, engine, f"{here}/two")
        try:
            first.evaluate("nibSeed()")
            most = {"big": 1000}
            before = dumped(first, most)

            skipped = {
                name for name, text in before["databases"].items() if "skip" in json.loads(text)
            }
            for name, why in (("big", "large"), ("unmovable", "unmovable")):
                said = json.loads(before["databases"][name])
                if said.get("skip") != why:
                    problems.append(f"{name} was not skipped as {why}: {str(said)[:120]}")
            if json.loads(before["databases"]["big"]).get("size", 0) < 200000:
                problems.append("the skipped database's size is not all of it")

            second.evaluate("() => nibRestore('clear', '{}')")
            second.evaluate("(a) => nibRestore('local', a)", json.dumps(before["list"]["local"]))
            second.evaluate(
                "(a) => nibRestore('session', a)", json.dumps(before["list"]["session"])
            )
            for name, text in before["databases"].items():
                if name in skipped:
                    continue
                database = json.loads(text)["db"]
                second.evaluate("(a) => nibRestore('database', a)", json.dumps(database))
            after = dumped(second, most)

            for key in ("local", "session"):
                if before["list"][key] != after["list"][key]:
                    problems.append(f"{key} differs")
            carried = [db for db in before["list"]["databases"] if db["name"] not in skipped]
            if carried != after["list"]["databases"]:
                problems.append(f"databases differ: {carried} / {after['list']['databases']}")
            for name, text in before["databases"].items():
                if name in skipped:
                    continue
                if text != after["databases"].get(name):
                    problems.append(f"{name} is not the same bytes after the round trip")

            problems.extend(second.evaluate("nibCheck()"))
            sizes = {name: len(text) for name, text in before["databases"].items()}
            print(f"{engine}: dumped {sizes}")
        finally:
            one.close()
            two.close()
    return problems


def main() -> int:
    engines = sys.argv[1:] or ["chromium", "webkit"]
    failed = 0
    for engine in engines:
        problems = round_trip(engine)
        if problems:
            failed += 1
            print(f"{engine}: FAIL")
            for problem in problems:
                print(f"  {problem}")
        else:
            print(f"{engine}: every value round-trips, byte for byte")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

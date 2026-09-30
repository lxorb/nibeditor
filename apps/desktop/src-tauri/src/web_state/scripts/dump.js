/** What a site keeps in the page's own storage, read out of it: the page's half of
 *  capturing a web login. See src-tauri/src/web_state.rs and docs/sync-v2.md 6.4.
 *
 *  One file for every engine. The crate runs it in an isolated world of a page on the
 *  origin (a DevTools world under WebView2, a `WKContentWorld` on a Mac, a script world
 *  under WebKitGTK), so the site's own scripts can neither see it nor change what it
 *  reads: they share the storage with this world and nothing else. It defines one name
 *  on that world's global and the crate calls it:
 *
 *    nibDump('list', '{"session":true}')         the origin, localStorage, the tab's
 *                                                 sessionStorage, and which databases
 *    nibDump('database', '{"name":"x","most":n}') one IndexedDB database, whole
 *
 *  Both answer a JSON string, because a string is the one value every engine hands back
 *  to native code unchanged.
 *
 *  A database is its schema (version, stores with their key path and auto-increment,
 *  indexes with unique and multi-entry) and every record by cursor, key and value, in
 *  a tagged form of the structured clone: what IndexedDB can hold, restore.js puts back
 *  exactly as it was. Playwright's `storageState` does the same walk and is the model;
 *  it drops Blobs, Files and CryptoKeys and chokes on a database with no stores, and
 *  this does neither.
 *
 *  The encoding, one JSON value per clone value:
 *
 *    a string, true, false, null, a finite number other than -0   as itself
 *    ['u']                        undefined
 *    ['n', 'NaN' | 'Infinity' | '-Infinity' | '-0']
 *    ['i', '123']                 a BigInt, in decimal
 *    ['#', n]                     the n-th object of this value, again: shared and cyclic
 *                                 references stay one object
 *    ['o', [k, v, k, v, ...]]     a plain object: its own enumerable string keys
 *    ['a', [v, v, ...]]           a dense array with no other keys
 *    ['A', length, [k, v, ...]]   any other array: holes, and keys that are not indexes
 *    ['d', ms | null]             a Date, null where it is invalid
 *    ['r', source, flags]         a RegExp
 *    ['m', [k, v, ...]]           a Map;  ['s', [v, ...]] a Set
 *    ['B', b] ['N', n] ['S', s] ['I', '1']   Boolean, Number, String, BigInt objects
 *    ['ab', base64]               an ArrayBuffer
 *    ['v', kind, offset, length, buffer]     a typed array or DataView over `buffer`,
 *                                 which is encoded like any object, so two views of one
 *                                 buffer stay views of one buffer
 *    ['b', type, base64]          a Blob;  ['f', name, type, lastModified, base64] a File
 *    ['e', name, message, stack]  an Error
 *    ['k', format, key, algorithm, usages]   an extractable CryptoKey, exported
 *    ['img', width, height, colorSpace, base64]  ImageData
 *
 *  Every tag but 'u', 'n', 'i' and '#' is an object, numbered in the order it is first
 *  met, depth first, parent before children, from nought for each key and each value
 *  (each is a clone of its own); restore.js numbers them in the same order, which is
 *  why the numbers are never written. A value that cannot travel - a CryptoKey that may
 *  not be exported, a platform object this does not know - makes the whole database
 *  `unmovable`: half a database is worse than none, and a site starting empty is a site
 *  that fills itself again. */
globalThis.nibDump = async function nibDump(op, argsJson) {
  const args = JSON.parse(argsJson)

  /** Why a database cannot travel, thrown from deep inside the walk. */
  class Unmovable extends Error {}

  /** Every typed array this engine has, by the name the encoding carries. */
  const VIEWS = [
    'Int8Array',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int16Array',
    'Uint16Array',
    'Int32Array',
    'Uint32Array',
    'Float16Array',
    'Float32Array',
    'Float64Array',
    'BigInt64Array',
    'BigUint64Array',
  ].filter((name) => typeof globalThis[name] === 'function')

  /** Bytes as base64, in slices, because one `String.fromCharCode` over a few
   *  megabytes is more arguments than an engine takes. */
  function base64(bytes) {
    let text = ''
    for (let at = 0; at < bytes.length; at += 0x8000) {
      text += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000))
    }
    return btoa(text)
  }

  /** How `Object.prototype.toString` names a value, which is the one test a value
   *  from another world or with a changed prototype cannot lie to. */
  function kind(value) {
    return Object.prototype.toString.call(value).slice(8, -1)
  }

  /** A CryptoKey's algorithm as plain JSON: a name, and the few members an import
   *  needs, with a public exponent's bytes as numbers. */
  function algorithmOf(algorithm) {
    const out = {}
    for (const [key, value] of Object.entries(algorithm)) {
      if (value instanceof Uint8Array) out[key] = [...value]
      else if (value && typeof value === 'object') out[key] = algorithmOf(value)
      else out[key] = value
    }
    return out
  }

  /** An encoder: `root` encodes one key or one value; `later` collects what can only
   *  be read asynchronously (a Blob's bytes, an exported key), filled in by `settle`
   *  once the walk is done, because the walk runs inside a cursor's callback and a
   *  transaction closes the moment its callback returns without asking for more.
   *  `counted.size` is about how many bytes the encoding takes, for the ceiling. */
  function encoder() {
    const seen = new Map()
    const later = []
    const counted = { size: 0 }

    function number(value) {
      if (Object.is(value, -0)) return ['n', '-0']
      if (Number.isNaN(value)) return ['n', 'NaN']
      if (value === Infinity) return ['n', 'Infinity']
      if (value === -Infinity) return ['n', '-Infinity']
      counted.size += 8
      return value
    }

    function pairs(entries) {
      const out = []
      for (const [key, value] of entries) out.push(encode(key), encode(value))
      return out
    }

    function bytesOf(buffer, offset, length) {
      counted.size += Math.ceil((length * 4) / 3)
      return base64(new Uint8Array(buffer, offset, length))
    }

    function later64(node, read) {
      later.push(async () => {
        node[node.length - 1] = base64(new Uint8Array(await read()))
      })
      return node
    }

    function encode(value) {
      switch (typeof value) {
        case 'string':
          counted.size += value.length + 2
          return value
        case 'number':
          return number(value)
        case 'boolean':
          counted.size += 5
          return value
        case 'undefined':
          return ['u']
        case 'bigint':
          return ['i', value.toString()]
        case 'object':
          break
        default:
          throw new Unmovable(`a ${typeof value} cannot be stored`)
      }
      if (value === null) return null

      const known = seen.get(value)
      if (known !== undefined) return ['#', known]
      seen.set(value, seen.size)
      counted.size += 4

      const tag = kind(value)
      switch (tag) {
        case 'Object':
          return ['o', Object.keys(value).flatMap((key) => [key, encode(value[key])])]
        case 'Array': {
          const keys = Object.keys(value)
          const dense = keys.length === value.length && keys.every((key, at) => key === String(at))
          if (dense) return ['a', value.map(encode)]
          return ['A', value.length, keys.flatMap((key) => [key, encode(value[key])])]
        }
        case 'Date': {
          const time = value.getTime()
          return ['d', Number.isNaN(time) ? null : time]
        }
        case 'RegExp':
          return ['r', value.source, value.flags]
        case 'Map':
          return ['m', pairs(value)]
        case 'Set':
          return ['s', [...value].map(encode)]
        case 'Boolean':
          return ['B', value.valueOf()]
        case 'Number':
          return ['N', number(value.valueOf())]
        case 'String':
          return ['S', value.valueOf()]
        case 'BigInt':
          return ['I', value.valueOf().toString()]
        case 'ArrayBuffer':
          return ['ab', bytesOf(value, 0, value.byteLength)]
        case 'DataView':
          return ['v', 'DataView', value.byteOffset, value.byteLength, encode(value.buffer)]
        case 'Blob':
          counted.size += Math.ceil((value.size * 4) / 3)
          return later64(['b', value.type, ''], () => value.arrayBuffer())
        case 'File':
          counted.size += Math.ceil((value.size * 4) / 3)
          return later64(['f', value.name, value.type, value.lastModified, ''], () =>
            value.arrayBuffer(),
          )
        case 'Error':
          return ['e', String(value.name), String(value.message), String(value.stack ?? '')]
        case 'CryptoKey': {
          if (!value.extractable) throw new Unmovable('a key that may not be exported')
          const format = value.type === 'secret' ? 'raw' : 'jwk'
          const node = ['k', format, null, algorithmOf(value.algorithm), [...value.usages]]
          later.push(async () => {
            const exported = await crypto.subtle.exportKey(format, value)
            node[2] = format === 'raw' ? base64(new Uint8Array(exported)) : exported
          })
          return node
        }
        case 'ImageData':
          return [
            'img',
            value.width,
            value.height,
            value.colorSpace ?? 'srgb',
            bytesOf(value.data.buffer, value.data.byteOffset, value.data.byteLength),
          ]
        default:
          if (VIEWS.includes(tag)) {
            return ['v', tag, value.byteOffset, value.length, encode(value.buffer)]
          }
          throw new Unmovable(`a ${tag} cannot be carried`)
      }
    }

    return {
      root(value) {
        seen.clear()
        return encode(value)
      },
      counted,
      async settle() {
        for (const one of later) await one()
      },
    }
  }

  /** The pairs of a Storage, in its own order, or null where the engine refuses it
   *  (a sandboxed frame, storage switched off). */
  function stored(storage) {
    try {
      const out = []
      for (let at = 0; at < storage.length; at++) {
        const key = storage.key(at)
        if (key !== null) out.push([key, storage.getItem(key) ?? ''])
      }
      return out
    } catch {
      return null
    }
  }

  async function listed(asked) {
    let databases = []
    try {
      databases = (await indexedDB.databases())
        .filter((one) => typeof one.name === 'string')
        .map((one) => ({ name: one.name, version: one.version }))
    } catch {
      // An engine without `databases()`, or storage refused: nothing to carry.
    }
    return {
      origin: location.origin,
      local: stored(localStorage),
      session: asked.session ? stored(sessionStorage) : null,
      databases,
    }
  }

  /** Opens a database that exists, and only that: `open` without a version would
   *  make an empty one of any name, so an upgrade here means it went away between
   *  the listing and now, and is stopped before it is made. */
  function opened(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name)
      let fresh = false
      request.onupgradeneeded = () => {
        fresh = true
        request.transaction.abort()
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => (fresh ? resolve(null) : reject(request.error))
      request.onblocked = () => reject(new Error(`${name} is held open elsewhere`))
    })
  }

  /** Every record of one store by cursor, handed to `each` inside the cursor's own
   *  callback, and done when the cursor is. */
  function walked(store, each) {
    return new Promise((resolve, reject) => {
      const request = store.openCursor()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve()
          return
        }
        try {
          each(cursor.primaryKey, cursor.value)
        } catch (error) {
          reject(error)
          return
        }
        cursor.continue()
      }
    })
  }

  /** One database, or why it stays behind: `large` past `most` bytes, `unmovable` when
   *  something in it cannot travel, `gone` when it went away meanwhile; and about how
   *  many bytes it is either way. A large one is walked to the end all the same, each
   *  record counted and let go, so the size said is the whole of it. */
  async function dumped(name, most) {
    const db = await opened(name)
    if (!db) return { skip: 'gone', size: 0 }

    const kept = encoder()
    const names = [...db.objectStoreNames]
    const stores = []
    let skip = null
    let size = 0

    function each(records, key, value) {
      if (skip === 'unmovable') return
      try {
        if (skip === 'large') {
          const probe = encoder()
          probe.root(key)
          probe.root(value)
          size += probe.counted.size
          return
        }
        // The key travels whether it is in the value or not: restore.js needs it for a
        // store without a key path.
        const record = [kept.root(key), kept.root(value)]
        size = kept.counted.size
        if (size > most) {
          skip = 'large'
          stores.length = 0
        } else records.push(record)
      } catch (error) {
        if (!(error instanceof Unmovable)) throw error
        skip = 'unmovable'
      }
    }

    try {
      // A transaction over no stores is an error, which is what broke Playwright on a
      // database that has none; it is simply a version with nothing in it.
      const transaction = names.length ? db.transaction(names, 'readonly') : null
      await Promise.all(
        names.map((storeName) => {
          const store = transaction.objectStore(storeName)
          const records = []
          stores.push({
            name: storeName,
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement,
            indexes: [...store.indexNames].map((indexName) => {
              const index = store.index(indexName)
              return {
                name: index.name,
                keyPath: index.keyPath,
                unique: index.unique,
                multiEntry: index.multiEntry,
              }
            }),
            records,
          })
          return walked(store, (key, value) => each(records, key, value))
        }),
      )
      if (!skip) await kept.settle()
    } finally {
      db.close()
    }

    if (skip) return { skip, size }
    return { size, db: { name, version: db.version, stores } }
  }

  if (op === 'list') return JSON.stringify(await listed(args))
  if (op === 'database') return JSON.stringify(await dumped(args.name, args.most ?? Infinity))
  throw new Error(`there is no dump called ${op}`)
}

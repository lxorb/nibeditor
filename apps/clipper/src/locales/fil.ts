import type { Dictionary } from '../lib/translate'

export const fil: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Pahina',
  Selection: 'Pinili',
  Link: 'Link',
  // Saving one
  Save: 'I-save',
  Saving: 'Sinasave',
  Saved: 'Naka-save',
  // Where it goes
  Space: 'Espasyo',
  Folder: 'Folder',
  // The account
  Account: 'Account',
  'Sign out': 'Mag-sign out',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Wika',
  'Match the system': 'Sundin ang sistema',
  'Machine-translated. Corrections welcome.': 'Salin ng makina. Tanggap ang pagwawasto.',
  Appearance: 'Anyo',
  Light: 'Maliwanag',
  Dark: 'Madilim',
  Shortcuts: 'Mga shortcut',
  Open: 'Buksan',
  // The interpreter, in the popup
  Template: 'Plantilya',
  Interpret: 'Suriin',
  '{count} characters sent': {
    one: '{count} karakter ang ipinadala',
    other: '{count} karakter ang ipinadala',
  },
  // And on the options page
  Interpreter: 'Pagsusuri',
  Off: 'Sara',
  'Another server': 'Ibang server',
  'Ollama is running here': 'Tumatakbo ang Ollama dito',
  'Use it': 'Gamitin ito',
  Address: 'Address',
  'API key': 'API key',
  Model: 'Modelo',
  Templates: 'Mga plantilya',
  Reset: 'Ibalik',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Nananatili ang mga key sa browser na ito at hindi naka-encrypt: walang keychain ang isang extension. Ang bawat isa ay ipinapadala lang sa sariling provider nito at wala nang iba.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'Ang linya {line} ay hindi sinasabi ng isang plantilya.',
  'Line {line} names a property the clip writes itself.':
    'Pinapangalanan ng linya {line} ang isang property na isinusulat na mismo ng clip.',
  'The template on line {line} has no name.': 'Walang pangalan ang plantilya sa linya {line}.',
  'Line {line} repeats a name that is already there.':
    'Inuulit ng linya {line} ang pangalang naroon na.',
  'There is no template in there.': 'Walang plantilya riyan.',
  // Signing in
  'Email address': 'Email address',
  Continue: 'Magpatuloy',
  Sending: 'Ipinapadala',
  'Code sent to': 'Ipinadala ang code sa',
  'Send a new code': 'Magpadala ng bagong code',
  'Resend in {seconds}s': 'Ipadala muli sa {seconds}s',
  'Digit {number}': 'Digit {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Mag-sign in muna sa nibeditor.',
  'Make a space in nibeditor first.': 'Gumawa muna ng espasyo sa nibeditor.',
  'This page cannot be clipped.': 'Hindi maaaring i-clip ang pahinang ito.',
  'There is nothing to clip here.': 'Walang maaaring i-clip dito.',
  'This clip is larger than a note can be.':
    'Mas malaki ang clip na ito kaysa sa maaaring maging tala.',
  'Your account is out of space.': 'Wala nang espasyo ang account mo.',
  'Could not reach nibeditor.': 'Hindi maabot ang nibeditor.',
  'Could not reach the provider.': 'Hindi maabot ang provider.',
  'The provider answered with something else.': 'Ibang bagay ang isinagot ng provider.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'maglagay ng tamang email address',
  'that code is not right': 'hindi tama ang code na iyon',
  'that code has expired - ask for a new one': 'lumipas na ang code - humiling ng bago',
  'too many tries - ask for a new code': 'sobrang dami nang subok - humiling ng bagong code',
  'sign in first': 'mag-sign in muna',
  'no such space': 'walang ganoong espasyo',
  'that path is not usable': 'hindi magagamit ang path na iyon',
}

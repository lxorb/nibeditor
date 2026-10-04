import type { Dictionary } from '../lib/translate'

export const gsw: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Siite',
  Selection: 'Uuswahl',
  Link: 'Link',
  // Saving one
  Save: 'Spichere',
  Saving: 'Spichere',
  Saved: 'Gspicheret',
  // Where it goes
  Space: 'Ablag',
  Folder: 'Mappe',
  // The account
  Account: 'Konto',
  'Sign out': 'Abmelde',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Sprach',
  'Match the system': 'Wie s System',
  'Machine-translated. Corrections welcome.': 'Maschinell übersetzt. Korrekture willkomme.',
  Appearance: 'Uussehe',
  Light: 'Hell',
  Dark: 'Dunkel',
  Shortcuts: 'Tastechürzel',
  Open: 'Ufmache',
  // The interpreter, in the popup
  Template: 'Vorlag',
  Interpret: 'Deute',
  '{count} characters sent': { one: '{count} Zeiche gschickt', other: '{count} Zeiche gschickt' },
  // And on the options page
  Interpreter: 'Deutig',
  Off: 'Us',
  'Another server': 'En andere Server',
  'Ollama is running here': 'Ollama laufft da',
  'Use it': 'Bruuche',
  Address: 'Adrässe',
  'API key': 'API-Schlüssel',
  Model: 'Modäll',
  Templates: 'Vorlage',
  Reset: 'Zrugsetze',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Schlüssel liged unverschlüsselet i däm Browser: en Erwiiterig hät kein Schlüsselbund. Jede gaht nur zu sim eigete Aabieter und susch niene häre.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'Ziile {line} seit nüt, wo en Vorlag chan säge.',
  'Line {line} names a property the clip writes itself.':
    'Ziile {line} nennt en Eigeschaft, wo de Uusschnitt sälber schriibt.',
  'The template on line {line} has no name.': 'Die Vorlag i de Ziile {line} hät kein Name.',
  'Line {line} repeats a name that is already there.':
    'Ziile {line} widerholt en Name, wo s scho git.',
  'There is no template in there.': 'Da inne isch kei Vorlag.',
  // Signing in
  'Email address': 'E-Mail-Adrässe',
  Continue: 'Wiiter',
  Sending: 'Wird gschickt',
  'Code sent to': 'Code gschickt a',
  'Send a new code': 'Nöie Code schicke',
  'Resend in {seconds}s': 'Nomal i {seconds}s',
  'Digit {number}': 'Ziffer {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Mäld di zerscht bi nibeditor aa.',
  'Make a space in nibeditor first.': 'Mach zerscht en Ablag i nibeditor.',
  'This page cannot be clipped.': 'Die Siite laat sich nöd sichere.',
  'There is nothing to clip here.': 'Da gits nüt z sichere.',
  'This clip is larger than a note can be.': 'De Uusschnitt isch z gross für e Notiz.',
  'Your account is out of space.': 'Dis Konto hät kein Platz meh.',
  'Could not reach nibeditor.': 'nibeditor isch nöd z erreiche gsi.',
  'Could not reach the provider.': 'De Aabieter isch nöd z erreiche gsi.',
  'The provider answered with something else.': 'De Aabieter hät öppis anders gantwortet.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'Gib e gültigi E-Mail-Adrässe ii',
  'that code is not right': 'De Code stimmt nöd',
  'that code has expired - ask for a new one': 'De Code isch abgloffe - frag en nöie aa',
  'too many tries - ask for a new code': 'Z vill Versüech - frag en nöie Code aa',
  'sign in first': 'Mäld di zerscht aa',
  'no such space': 'Die Ablag gits nöd',
  'that path is not usable': 'De Pfad gaht nöd',
  // A page as a task in the inbox
  'As a task': 'Als Ufgab',
}

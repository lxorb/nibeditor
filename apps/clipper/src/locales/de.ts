/** German. Words the app already says are spelled the way it spells them, so
 *  the extension and the editor sound like one product; see
 *  `apps/desktop/src/locales/de.ts`.
 *
 *  This is the reference every other catalogue is held to: a row it has and
 *  another has not is a string that would come out in English, and a row nothing
 *  here asks for is a row nobody asks for. See `../lib/i18n.test.ts`. */

import type { Dictionary } from '../lib/translate'

export const de: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Seite',
  Selection: 'Auswahl',
  Link: 'Link',

  // Saving one
  Save: 'Speichern',
  Saving: 'Speichern',
  Saved: 'Gespeichert',

  // Where it goes
  Space: 'Bereich',
  Folder: 'Ordner',

  // The account
  Account: 'Konto',
  'Sign out': 'Abmelden',

  // The language, and what the row under it says about the catalogue on screen
  Language: 'Sprache',
  'Match the system': 'Wie das System',
  'Machine-translated. Corrections welcome.': 'Maschinell übersetzt. Korrekturen willkommen.',

  Appearance: 'Darstellung',
  Light: 'Hell',
  Dark: 'Dunkel',

  Shortcuts: 'Tastenkürzel',
  Open: 'Öffnen',

  // The interpreter, in the popup
  Template: 'Vorlage',
  Interpret: 'Deuten',
  '{count} characters sent': { one: '{count} Zeichen gesendet', other: '{count} Zeichen gesendet' },

  // And on the options page
  Interpreter: 'Deutung',
  Off: 'Aus',
  'Another server': 'Ein anderer Server',
  'Ollama is running here': 'Ollama läuft hier',
  'Use it': 'Verwenden',
  Address: 'Adresse',
  'API key': 'API-Schlüssel',
  Model: 'Modell',
  Templates: 'Vorlagen',
  Reset: 'Zurücksetzen',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Schlüssel liegen unverschlüsselt in diesem Browser: eine Erweiterung hat keinen Schlüsselbund. Jeder geht nur an seinen eigenen Anbieter und sonst nirgendwohin.',

  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'Zeile {line} sagt nichts, was eine Vorlage sagen kann.',
  'Line {line} names a property the clip writes itself.':
    'Zeile {line} nennt eine Eigenschaft, die der Ausschnitt selbst schreibt.',
  'The template on line {line} has no name.': 'Die Vorlage in Zeile {line} hat keinen Namen.',
  'Line {line} repeats a name that is already there.':
    'Zeile {line} wiederholt einen Namen, den es schon gibt.',
  'There is no template in there.': 'Da ist keine Vorlage drin.',

  // Signing in
  'Email address': 'E-Mail-Adresse',
  Continue: 'Weiter',
  Sending: 'Wird gesendet',
  'Code sent to': 'Code gesendet an',
  'Send a new code': 'Neuen Code senden',
  'Resend in {seconds}s': 'Erneut in {seconds}s',
  'Digit {number}': 'Ziffer {number}',

  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Melde dich zuerst bei nibeditor an.',
  'Make a space in nibeditor first.': 'Lege zuerst einen Bereich in nibeditor an.',
  'This page cannot be clipped.': 'Diese Seite lässt sich nicht sichern.',
  'There is nothing to clip here.': 'Hier gibt es nichts zu sichern.',
  'This clip is larger than a note can be.':
    'Dieser Ausschnitt ist grösser, als eine Notiz sein darf.',
  'Your account is out of space.': 'Dein Konto hat keinen Speicher mehr frei.',
  'Could not reach nibeditor.': 'nibeditor war nicht zu erreichen.',
  'Could not reach the provider.': 'Der Anbieter war nicht zu erreichen.',
  'The provider answered with something else.': 'Der Anbieter hat etwas anderes geantwortet.',

  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'Gib eine gültige E-Mail-Adresse ein',
  'that code is not right': 'Der Code stimmt nicht',
  'that code has expired - ask for a new one': 'Der Code ist abgelaufen - fordere einen neuen an',
  'too many tries - ask for a new code': 'Zu viele Versuche - fordere einen neuen Code an',
  'sign in first': 'Melde dich zuerst an',
  'no such space': 'Diesen Bereich gibt es nicht',
  'that path is not usable': 'Dieser Pfad geht nicht',
  // A page as a task in the inbox
  'As a task': 'Als Aufgabe',
}

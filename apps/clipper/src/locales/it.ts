import type { Dictionary } from '../lib/translate'

export const it: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Pagina',
  Selection: 'Selezione',
  Link: 'Link',
  // Saving one
  Save: 'Salva',
  Saving: 'Salvataggio',
  Saved: 'Salvato',
  // Where it goes
  Space: 'Spazio',
  Folder: 'Cartella',
  // The account
  Account: 'Account',
  'Sign out': 'Disconnetti',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Lingua',
  'Match the system': 'Come il sistema',
  'Machine-translated. Corrections welcome.': 'Tradotto automaticamente. Correzioni benvenute.',
  Appearance: 'Aspetto',
  Light: 'Chiaro',
  Dark: 'Scuro',
  Shortcuts: 'Scorciatoie',
  Open: 'Apri',
  // The interpreter, in the popup
  Template: 'Schema',
  Interpret: 'Interpreta',
  '{count} characters sent': {
    one: '{count} carattere inviato',
    many: '{count} caratteri inviati',
    other: '{count} caratteri inviati',
  },
  // And on the options page
  Interpreter: 'Interpretazione',
  Off: 'Disattivo',
  'Another server': 'Un altro server',
  'Ollama is running here': 'Ollama è in funzione qui',
  'Use it': 'Usalo',
  Address: 'Indirizzo',
  'API key': 'Chiave API',
  Model: 'Modello',
  Templates: 'Schemi',
  Reset: 'Reimposta',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Le chiavi restano in questo browser senza cifratura: un’estensione non ha un portachiavi. Ognuna va solo al suo fornitore e a nessun altro.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'La riga {line} non dice nulla che dica uno schema.',
  'Line {line} names a property the clip writes itself.':
    'La riga {line} nomina una proprietà che il ritaglio scrive da sé.',
  'The template on line {line} has no name.': 'Lo schema alla riga {line} non ha nome.',
  'Line {line} repeats a name that is already there.': 'La riga {line} ripete un nome che c’è già.',
  'There is no template in there.': 'Lì non c’è nessuno schema.',
  // Signing in
  'Email address': 'Indirizzo email',
  Continue: 'Continua',
  Sending: 'Invio',
  'Code sent to': 'Codice inviato a',
  'Send a new code': 'Invia un nuovo codice',
  'Resend in {seconds}s': 'Rinvia tra {seconds} s',
  'Digit {number}': 'Cifra {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Accedi prima a nibeditor.',
  'Make a space in nibeditor first.': 'Crea prima uno spazio in nibeditor.',
  'This page cannot be clipped.': 'Questa pagina non si può ritagliare.',
  'There is nothing to clip here.': 'Qui non c’è niente da ritagliare.',
  'This clip is larger than a note can be.':
    'Questo ritaglio è più grande di quanto possa essere una nota.',
  'Your account is out of space.': 'Il tuo account non ha più spazio.',
  'Could not reach nibeditor.': 'Non è stato possibile raggiungere nibeditor.',
  'Could not reach the provider.': 'Non è stato possibile raggiungere il fornitore.',
  'The provider answered with something else.': 'Il fornitore ha risposto altro.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'inserisci un indirizzo email valido',
  'that code is not right': 'quel codice non è giusto',
  'that code has expired - ask for a new one': 'quel codice è scaduto - chiedine uno nuovo',
  'too many tries - ask for a new code': 'troppi tentativi - chiedi un nuovo codice',
  'sign in first': 'accedi prima',
  'no such space': 'spazio inesistente',
  'that path is not usable': 'quel percorso non è utilizzabile',
}

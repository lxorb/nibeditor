import type { Dictionary } from '../lib/translate'

export const pl: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Strona',
  Selection: 'Zaznaczenie',
  Link: 'Link',
  // Saving one
  Save: 'Zapisz',
  Saving: 'Zapisywanie',
  Saved: 'Zapisano',
  // Where it goes
  Space: 'Przestrzeń',
  Folder: 'Folder',
  // The account
  Account: 'Konto',
  'Sign out': 'Wyloguj się',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Język',
  'Match the system': 'Jak system',
  'Machine-translated. Corrections welcome.': 'Tłumaczenie maszynowe. Poprawki są mile widziane.',
  Appearance: 'Wygląd',
  Light: 'Jasny',
  Dark: 'Ciemny',
  Shortcuts: 'Skróty',
  Open: 'Otwórz',
  // The interpreter, in the popup
  Template: 'Szablon',
  Interpret: 'Zinterpretuj',
  '{count} characters sent': {
    one: 'Wysłano {count} znak',
    few: 'Wysłano {count} znaki',
    many: 'Wysłano {count} znaków',
    other: 'Wysłano {count} znaku',
  },
  // And on the options page
  Interpreter: 'Interpretacja',
  Off: 'Wyłączone',
  'Another server': 'Inny serwer',
  'Ollama is running here': 'Ollama działa tutaj',
  'Use it': 'Użyj go',
  Address: 'Adres',
  'API key': 'Klucz API',
  Model: 'Model',
  Templates: 'Szablony',
  Reset: 'Resetuj',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Klucze leżą w tej przeglądarce bez szyfrowania: rozszerzenie nie ma pęku kluczy. Każdy trafia tylko do swojego dostawcy i nigdzie więcej.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'Wiersz {line} nie mówi nic, co mówi szablon.',
  'Line {line} names a property the clip writes itself.':
    'Wiersz {line} nazywa właściwość, którą wycinek zapisuje sam.',
  'The template on line {line} has no name.': 'Szablon w wierszu {line} nie ma nazwy.',
  'Line {line} repeats a name that is already there.':
    'Wiersz {line} powtarza nazwę, która już jest.',
  'There is no template in there.': 'Nie ma tam żadnego szablonu.',
  // Signing in
  'Email address': 'Adres e-mail',
  Continue: 'Kontynuuj',
  Sending: 'Wysyłanie',
  'Code sent to': 'Kod wysłany na',
  'Send a new code': 'Wyślij nowy kod',
  'Resend in {seconds}s': 'Ponów za {seconds} s',
  'Digit {number}': 'Cyfra {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Najpierw zaloguj się w nibeditor.',
  'Make a space in nibeditor first.': 'Najpierw utwórz przestrzeń w nibeditor.',
  'This page cannot be clipped.': 'Tej strony nie można wyciąć.',
  'There is nothing to clip here.': 'Nie ma tu nic do wycięcia.',
  'This clip is larger than a note can be.': 'Ten wycinek jest większy, niż może być notatka.',
  'Your account is out of space.': 'W Twoim koncie nie ma już miejsca.',
  'Could not reach nibeditor.': 'Nie udało się połączyć z nibeditor.',
  'Could not reach the provider.': 'Nie udało się połączyć z dostawcą.',
  'The provider answered with something else.': 'Dostawca odpowiedział czymś innym.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'podaj poprawny adres e-mail',
  'that code is not right': 'ten kod jest niepoprawny',
  'that code has expired - ask for a new one': 'ten kod wygasł - poproś o nowy',
  'too many tries - ask for a new code': 'za dużo prób - poproś o nowy kod',
  'sign in first': 'najpierw się zaloguj',
  'no such space': 'brak takiej przestrzeni',
  'that path is not usable': 'ta ścieżka nie nadaje się do użycia',
  // A page as a task in the inbox
  'As a task': 'Jako zadanie',
}

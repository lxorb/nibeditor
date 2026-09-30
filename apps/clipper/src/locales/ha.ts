import type { Dictionary } from '../lib/translate'

export const ha: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Shafi',
  Selection: 'Zaɓi',
  Link: 'Haɗi',
  // Saving one
  Save: 'Ajiye',
  Saving: 'Ana ajiye',
  Saved: 'An ajiye',
  // Where it goes
  Space: 'Wuri',
  Folder: 'Babban fayil',
  // The account
  Account: 'Asusu',
  'Sign out': 'Fita',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Harshe',
  'Match the system': 'Bi tsarin',
  'Machine-translated. Corrections welcome.': 'Fassarar inji. Ana maraba da gyara.',
  Appearance: 'Kamanni',
  Light: 'Haske',
  Dark: 'Duhu',
  Shortcuts: 'Gajerun hanyoyi',
  Open: 'Buɗe',
  // The interpreter, in the popup
  Template: 'Tsari',
  Interpret: 'Tantance',
  '{count} characters sent': { one: 'An aika harafi {count}', other: 'An aika haruffa {count}' },
  // And on the options page
  Interpreter: 'Tantancewa',
  Off: 'A kashe',
  'Another server': 'Wata uwar garke',
  'Ollama is running here': 'Ollama na aiki a nan',
  'Use it': 'A yi amfani da shi',
  Address: 'Adireshi',
  'API key': 'Maɓallin API',
  Model: 'Samfuri',
  Templates: 'Tsare-tsare',
  Reset: 'Mayar',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Ana ajiye maɓallai a wannan birawuza ba tare da ɓoyewa ba: ƙari ba shi da sarƙar maɓalli. Kowanne zuwa mai bayarwa nasa kawai ake aika shi, ba wani wuri ba.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'Layi {line} bai faɗi abin da tsari ke faɗi ba.',
  'Line {line} names a property the clip writes itself.':
    'Layi {line} ya ambaci sifar da yankin da kansa ke rubutawa.',
  'The template on line {line} has no name.': 'Tsarin da ke layi {line} ba shi da suna.',
  'Line {line} repeats a name that is already there.': 'Layi {line} ya maimaita sunan da ke can.',
  'There is no template in there.': 'Babu tsari a ciki.',
  // Signing in
  'Email address': 'Adireshin imel',
  Continue: 'Ci gaba',
  Sending: 'Ana aikawa',
  'Code sent to': 'An aika lamba zuwa',
  'Send a new code': 'Aika sabon lamba',
  'Resend in {seconds}s': 'Sake aika cikin {seconds}s',
  'Digit {number}': 'Lambar {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Ka shiga nibeditor da farko.',
  'Make a space in nibeditor first.': 'Ka ƙirƙiri wuri a nibeditor da farko.',
  'This page cannot be clipped.': 'Ba za a iya yanke wannan shafi ba.',
  'There is nothing to clip here.': 'Babu abin da za a yanke a nan.',
  'This clip is larger than a note can be.':
    'Wannan yanki ya fi girman da bayanin kula zai iya kaiwa.',
  'Your account is out of space.': "Asusunka ya ƙare da ma'aji.",
  'Could not reach nibeditor.': 'Ba a iya kai wa nibeditor ba.',
  'Could not reach the provider.': 'Ba a iya kai wa mai bayarwa ba.',
  'The provider answered with something else.': 'Mai bayarwa ya amsa wani abu dabam.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'shigar da adireshin imel mai inganci',
  'that code is not right': 'wannan lambar ba daidai ba',
  'that code has expired - ask for a new one': 'wannan lambar ta ƙare - nemi sabuwa',
  'too many tries - ask for a new code': 'ƙoƙari da yawa - nemi sabuwar lamba',
  'sign in first': 'shiga da farko',
  'no such space': 'babu irin wannan wurin',
  'that path is not usable': 'ba za a iya amfani da wannan hanyar ba',
}

import type { Dictionary } from '../lib/translate'

export const sw: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Ukurasa',
  Selection: 'Uteuzi',
  Link: 'Kiungo',
  // Saving one
  Save: 'Hifadhi',
  Saving: 'Inahifadhi',
  Saved: 'Imehifadhiwa',
  // Where it goes
  Space: 'Nafasi',
  Folder: 'Folda',
  // The account
  Account: 'Akaunti',
  'Sign out': 'Toka',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Lugha',
  'Match the system': 'Fuata mfumo',
  'Machine-translated. Corrections welcome.': 'Tafsiri ya mashine. Masahihisho yanakaribishwa.',
  Appearance: 'Muonekano',
  Light: 'Nuru',
  Dark: 'Giza',
  Shortcuts: 'Njia za mkato',
  Open: 'Fungua',
  // The interpreter, in the popup
  Template: 'Kiolezo',
  Interpret: 'Fasiri',
  '{count} characters sent': { one: 'Herufi {count} imetumwa', other: 'Herufi {count} zimetumwa' },
  // And on the options page
  Interpreter: 'Ufasiri',
  Off: 'Imezimwa',
  'Another server': 'Seva nyingine',
  'Ollama is running here': 'Ollama inaendeshwa hapa',
  'Use it': 'Itumie',
  Address: 'Anwani',
  'API key': 'Kitufe cha API',
  Model: 'Modeli',
  Templates: 'Violezo',
  Reset: 'Rejesha',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Vitufe hukaa katika kivinjari hiki bila usimbaji: kiendelezi hakina mkufu wa vitufe. Kila kimoja hutumwa kwa mtoa huduma wake pekee na si kwingine.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'Mstari {line} hausemi kile kiolezo husema.',
  'Line {line} names a property the clip writes itself.':
    'Mstari {line} unataja sifa ambayo dondoo hujiandikia.',
  'The template on line {line} has no name.': 'Kiolezo cha mstari {line} hakina jina.',
  'Line {line} repeats a name that is already there.': 'Mstari {line} unarudia jina lililopo.',
  'There is no template in there.': 'Hakuna kiolezo humo.',
  // Signing in
  'Email address': 'Anwani ya barua pepe',
  Continue: 'Endelea',
  Sending: 'Inatuma',
  'Code sent to': 'Kodi imetumwa kwa',
  'Send a new code': 'Tuma kodi mpya',
  'Resend in {seconds}s': 'Tuma tena baada ya {seconds}s',
  'Digit {number}': 'Tarakimu {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Ingia kwa nibeditor kwanza.',
  'Make a space in nibeditor first.': 'Fanya nafasi katika nibeditor kwanza.',
  'This page cannot be clipped.': 'Ukurasa huu hauwezi kudondolewa.',
  'There is nothing to clip here.': 'Hakuna kitu cha kudondoa hapa.',
  'This clip is larger than a note can be.': 'Dondoo hili ni kubwa kuliko dokezo linaweza kuwa.',
  'Your account is out of space.': 'Akaunti yako haina hifadhi.',
  'Could not reach nibeditor.': 'nibeditor haikufikiwa.',
  'Could not reach the provider.': 'Mtoa huduma haikufikiwa.',
  'The provider answered with something else.': 'Mtoa huduma alijibu kitu kingine.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'weka anwani halali ya barua pepe',
  'that code is not right': 'kodi hiyo si sahihi',
  'that code has expired - ask for a new one': 'kodi hiyo imepitwa - omba nyingine',
  'too many tries - ask for a new code': 'majaribio mengi mno - omba kodi mpya',
  'sign in first': 'ingia kwanza',
  'no such space': 'hakuna nafasi hiyo',
  'that path is not usable': 'njia hiyo haitumiki',
}

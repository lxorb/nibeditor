import type { Dictionary } from '../lib/translate'

export const ml: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'പേജ്',
  Selection: 'തിരഞ്ഞെടുപ്പ്',
  Link: 'ലിങ്ക്',
  // Saving one
  Save: 'സേവ് ചെയ്യുക',
  Saving: 'സേവ് ചെയ്യൽ',
  Saved: 'സേവ് ചെയ്തു',
  // Where it goes
  Space: 'സ്പേസ്',
  Folder: 'ഫോൾഡർ',
  // The account
  Account: 'അക്കൗണ്ട്',
  'Sign out': 'സൈൻ ഔട്ട്',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'ഭാഷ',
  'Match the system': 'സിസ്റ്റം അനുസരിച്ച്',
  'Machine-translated. Corrections welcome.': 'യന്ത്ര വിവർത്തനം. തിരുത്തലുകൾ സ്വാഗതം.',
  Appearance: 'രൂപം',
  Light: 'ലൈറ്റ്',
  Dark: 'ഡാർക്ക്',
  Shortcuts: 'കുറുക്കുവഴികൾ',
  Open: 'തുറക്കുക',
  // The interpreter, in the popup
  Template: 'ടെംപ്ലേറ്റ്',
  Interpret: 'വ്യാഖ്യാനിക്കുക',
  '{count} characters sent': { one: '{count} അക്ഷരം അയച്ചു', other: '{count} അക്ഷരങ്ങൾ അയച്ചു' },
  // And on the options page
  Interpreter: 'വ്യാഖ്യാനം',
  Off: 'ഓഫ്',
  'Another server': 'മറ്റൊരു സെർവർ',
  'Ollama is running here': 'Ollama ഇവിടെ പ്രവർത്തിക്കുന്നു',
  'Use it': 'അത് ഉപയോഗിക്കുക',
  Address: 'വിലാസം',
  'API key': 'API കീ',
  Model: 'മോഡൽ',
  Templates: 'ടെംപ്ലേറ്റുകൾ',
  Reset: 'പുനഃസജ്ജം',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'കീകൾ എൻക്രിപ്ഷൻ ഇല്ലാതെ ഈ ബ്രൗസറിൽ കിടക്കും: ഒരു എക്സ്റ്റൻഷന് കീചെയിൻ ഇല്ല. ഓരോന്നും അതിന്റെ പ്രൊവൈഡറിലേക്ക് മാത്രം പോകുന്നു, മറ്റെങ്ങോട്ടുമില്ല.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'വരി {line} ഒരു ടെംപ്ലേറ്റ് പറയുന്നതൊന്നും പറയുന്നില്ല.',
  'Line {line} names a property the clip writes itself.':
    'വരി {line} ക്ലിപ്പ് സ്വയം എഴുതുന്ന ഒരു ഗുണത്തെ പേരെടുക്കുന്നു.',
  'The template on line {line} has no name.': 'വരി {line}-ലെ ടെംപ്ലേറ്റിന് പേരില്ല.',
  'Line {line} repeats a name that is already there.':
    'വരി {line} ഇപ്പോൾ തന്നെയുള്ള ഒരു പേര് ആവർത്തിക്കുന്നു.',
  'There is no template in there.': 'അതിൽ ടെംപ്ലേറ്റ് ഇല്ല.',
  // Signing in
  'Email address': 'ഇമെയിൽ വിലാസം',
  Continue: 'തുടരുക',
  Sending: 'അയയ്ക്കുന്നു',
  'Code sent to': 'കോഡ് അയച്ച വിലാസം',
  'Send a new code': 'പുതിയ കോഡ് അയയ്ക്കുക',
  'Resend in {seconds}s': '{seconds} സെക്കൻഡിൽ വീണ്ടും അയയ്ക്കുക',
  'Digit {number}': 'അങ്കം {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'ആദ്യം nibeditor-ൽ സൈൻ ഇൻ ചെയ്യുക.',
  'Make a space in nibeditor first.': 'ആദ്യം nibeditor-ൽ ഒരു സ്പേസ് ഉണ്ടാക്കുക.',
  'This page cannot be clipped.': 'ഈ പേജ് ക്ലിപ്പ് ചെയ്യാനാവില്ല.',
  'There is nothing to clip here.': 'ഇവിടെ ക്ലിപ്പ് ചെയ്യാൻ ഒന്നുമില്ല.',
  'This clip is larger than a note can be.': 'ഈ ക്ലിപ്പ് ഒരു കുറിപ്പിന് ആകാവുന്നതിലും വലുതാണ്.',
  'Your account is out of space.': 'നിങ്ങളുടെ അക്കൗണ്ടിൽ സ്റ്റോറേജ് ഇല്ല.',
  'Could not reach nibeditor.': 'nibeditor-ൽ എത്താനായില്ല.',
  'Could not reach the provider.': 'പ്രൊവൈഡറിൽ എത്താനായില്ല.',
  'The provider answered with something else.': 'പ്രൊവൈഡർ മറ്റെന്തോ മറുപടി നൽകി.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'ശരിയായ ഇമെയിൽ വിലാസം നൽകുക',
  'that code is not right': 'ആ കോഡ് ശരിയല്ല',
  'that code has expired - ask for a new one': 'ആ കോഡിന്റെ കാലാവധി കഴിഞ്ഞു - പുതിയത് ചോദിക്കുക',
  'too many tries - ask for a new code': 'വളരെയധികം ശ്രമങ്ങൾ - പുതിയ കോഡ് ചോദിക്കുക',
  'sign in first': 'ആദ്യം സൈൻ ഇൻ ചെയ്യുക',
  'no such space': 'അങ്ങനെയൊരു സ്പേസില്ല',
  'that path is not usable': 'ആ പാത്ത് ഉപയോഗിക്കാനാകില്ല',
  // A page as a task in the inbox
  'As a task': 'ജോലിയായി',
}

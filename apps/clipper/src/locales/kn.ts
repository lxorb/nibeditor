import type { Dictionary } from '../lib/translate'

export const kn: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'ಪುಟ',
  Selection: 'ಆಯ್ಕೆ',
  Link: 'ಲಿಂಕ್',
  // Saving one
  Save: 'ಉಳಿಸಿ',
  Saving: 'ಉಳಿಸುವಿಕೆ',
  Saved: 'ಉಳಿಸಲಾಗಿದೆ',
  // Where it goes
  Space: 'ಸ್ಪೇಸ್',
  Folder: 'ಫೋಲ್ಡರ್',
  // The account
  Account: 'ಖಾತೆ',
  'Sign out': 'ಸೈನ್ ಔಟ್',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'ಭಾಷೆ',
  'Match the system': 'ಸಿಸ್ಟಂ ಪ್ರಕಾರ',
  'Machine-translated. Corrections welcome.': 'ಯಂತ್ರ ಅನುವಾದ. ತಿದ್ದುಪಡಿಗಳಿಗೆ ಸ್ವಾಗತ.',
  Appearance: 'ರೂಪ',
  Light: 'ಲೈಟ್',
  Dark: 'ಡಾರ್ಕ್',
  Shortcuts: 'ಶಾರ್ಟ್‌ಕಟ್‌ಗಳು',
  Open: 'ತೆರೆಯಿರಿ',
  // The interpreter, in the popup
  Template: 'ಟೆಂಪ್ಲೇಟ್',
  Interpret: 'ಅರ್ಥೈಸಿ',
  '{count} characters sent': {
    one: '{count} ಅಕ್ಷರ ಕಳುಹಿಸಲಾಗಿದೆ',
    other: '{count} ಅಕ್ಷರಗಳು ಕಳುಹಿಸಲಾಗಿವೆ',
  },
  // And on the options page
  Interpreter: 'ಅರ್ಥೈಸುವಿಕೆ',
  Off: 'ಆಫ್',
  'Another server': 'ಇನ್ನೊಂದು ಸರ್ವರ್',
  'Ollama is running here': 'Ollama ಇಲ್ಲಿ ಚಾಲನೆಯಲ್ಲಿದೆ',
  'Use it': 'ಅದನ್ನು ಬಳಸಿ',
  Address: 'ವಿಳಾಸ',
  'API key': 'API ಕೀ',
  Model: 'ಮಾದರಿ',
  Templates: 'ಟೆಂಪ್ಲೇಟ್‌ಗಳು',
  Reset: 'ಮರುಹೊಂದಿಸಿ',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'ಕೀಗಳು ಈ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಎನ್‌ಕ್ರಿಪ್ಷನ್ ಇಲ್ಲದೆ ಇರುತ್ತವೆ: ವಿಸ್ತರಣೆಗೆ ಕೀಚೈನ್ ಇಲ್ಲ. ಪ್ರತಿಯೊಂದೂ ತನ್ನ ಪೂರೈಕೆದಾರನಿಗೆ ಮಾತ್ರ ಹೋಗುತ್ತದೆ, ಬೇರೆಲ್ಲಿಗೂ ಇಲ್ಲ.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'ಸಾಲು {line} ಟೆಂಪ್ಲೇಟ್ ಹೇಳುವುದನ್ನು ಹೇಳುತ್ತಿಲ್ಲ.',
  'Line {line} names a property the clip writes itself.':
    'ಸಾಲು {line} ಕ್ಲಿಪ್ ತಾನೇ ಬರೆಯುವ ಗುಣವನ್ನು ಹೆಸರಿಸುತ್ತದೆ.',
  'The template on line {line} has no name.': 'ಸಾಲು {line} ರಲ್ಲಿನ ಟೆಂಪ್ಲೇಟ್‌ಗೆ ಹೆಸರಿಲ್ಲ.',
  'Line {line} repeats a name that is already there.':
    'ಸಾಲು {line} ಈಗಾಗಲೇ ಇರುವ ಹೆಸರನ್ನು ಪುನರಾವರ್ತಿಸುತ್ತದೆ.',
  'There is no template in there.': 'ಅದರಲ್ಲಿ ಟೆಂಪ್ಲೇಟ್ ಇಲ್ಲ.',
  // Signing in
  'Email address': 'ಇಮೇಲ್ ವಿಳಾಸ',
  Continue: 'ಮುಂದುವರಿಸಿ',
  Sending: 'ಕಳುಹಿಸುತ್ತಿದೆ',
  'Code sent to': 'ಕೋಡ್ ಕಳುಹಿಸಿದ ವಿಳಾಸ',
  'Send a new code': 'ಹೊಸ ಕೋಡ್ ಕಳುಹಿಸಿ',
  'Resend in {seconds}s': '{seconds} ಸೆಕೆಂಡಿನಲ್ಲಿ ಮತ್ತೆ ಕಳುಹಿಸಿ',
  'Digit {number}': 'ಅಂಕಿ {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'ಮೊದಲು nibeditor ಗೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.',
  'Make a space in nibeditor first.': 'ಮೊದಲು nibeditor ನಲ್ಲಿ ಸ್ಪೇಸ್ ಮಾಡಿ.',
  'This page cannot be clipped.': 'ಈ ಪುಟವನ್ನು ಕ್ಲಿಪ್ ಮಾಡಲಾಗದು.',
  'There is nothing to clip here.': 'ಇಲ್ಲಿ ಕ್ಲಿಪ್ ಮಾಡಲು ಏನೂ ಇಲ್ಲ.',
  'This clip is larger than a note can be.': 'ಈ ಕ್ಲಿಪ್ ಟಿಪ್ಪಣಿಗಿಂತ ದೊಡ್ಡದು.',
  'Your account is out of space.': 'ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ಸಂಗ್ರಹಣೆ ಇಲ್ಲ.',
  'Could not reach nibeditor.': 'nibeditor ತಲುಪಲಾಗಲಿಲ್ಲ.',
  'Could not reach the provider.': 'ಪೂರೈಕೆದಾರ ತಲುಪಲಾಗಲಿಲ್ಲ.',
  'The provider answered with something else.': 'ಪೂರೈಕೆದಾರ ಬೇರೆ ಏನನ್ನೋ ಉತ್ತರಿಸಿದೆ.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'ಸರಿಯಾದ ಇಮೇಲ್ ವಿಳಾಸ ನಮೂದಿಸಿ',
  'that code is not right': 'ಆ ಕೋಡ್ ಸರಿಯಿಲ್ಲ',
  'that code has expired - ask for a new one': 'ಆ ಕೋಡ್ ಅವಧಿ ಮುಗಿದಿದೆ - ಹೊಸದನ್ನು ಕೇಳಿ',
  'too many tries - ask for a new code': 'ತುಂಬಾ ಪ್ರಯತ್ನಗಳು - ಹೊಸ ಕೋಡ್ ಕೇಳಿ',
  'sign in first': 'ಮೊದಲು ಸೈನ್ ಇನ್ ಮಾಡಿ',
  'no such space': 'ಅಂತಹ ಸ್ಪೇಸ್ ಇಲ್ಲ',
  'that path is not usable': 'ಆ ಪಾತ್ ಬಳಸಲು ಯೋಗ್ಯವಲ್ಲ',
}

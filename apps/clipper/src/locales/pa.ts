import type { Dictionary } from '../lib/translate'

export const pa: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'ਸਫ਼ਾ',
  Selection: 'ਚੋਣ',
  Link: 'ਕੜੀ',
  // Saving one
  Save: 'ਸਾਂਭੋ',
  Saving: 'ਸਾਂਭ ਰਿਹਾ ਹੈ',
  Saved: 'ਸਾਂਭਿਆ',
  // Where it goes
  Space: 'ਥਾਂ',
  Folder: 'ਫੋਲਡਰ',
  // The account
  Account: 'ਖਾਤਾ',
  'Sign out': 'ਸਾਈਨ ਆਉਟ',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'ਭਾਸ਼ਾ',
  'Match the system': 'ਸਿਸਟਮ ਮੁਤਾਬਕ',
  'Machine-translated. Corrections welcome.': 'ਮਸ਼ੀਨੀ ਅਨੁਵਾਦ। ਸੁਧਾਰ ਜੀ ਆਇਆਂ ਨੂੰ।',
  Appearance: 'ਦਿੱਖ',
  Light: 'ਚਾਨਣ',
  Dark: 'ਗੂੜ੍ਹਾ',
  Shortcuts: 'ਛੋਟੇ ਰਾਹ',
  Open: 'ਖੋਲ੍ਹੋ',
  // The interpreter, in the popup
  Template: 'ਨਮੂਨਾ',
  Interpret: 'ਅਰਥ ਕੱਢੋ',
  '{count} characters sent': { one: '{count} ਅੱਖਰ ਭੇਜਿਆ', other: '{count} ਅੱਖਰ ਭੇਜੇ' },
  // And on the options page
  Interpreter: 'ਅਰਥ ਕੱਢਣਾ',
  Off: 'ਬੰਦ',
  'Another server': 'ਕੋਈ ਹੋਰ ਸਰਵਰ',
  'Ollama is running here': 'Ollama ਇੱਥੇ ਚੱਲ ਰਿਹਾ ਹੈ',
  'Use it': 'ਇਹ ਵਰਤੋ',
  Address: 'ਪਤਾ',
  'API key': 'API ਕੁੰਜੀ',
  Model: 'ਮਾਡਲ',
  Templates: 'ਨਮੂਨੇ',
  Reset: 'ਮੁੜ ਲਾਓ',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'ਕੁੰਜੀਆਂ ਇਸ ਬ੍ਰਾਊਜ਼ਰ ਵਿੱਚ ਬਿਨਾਂ ਇਨਕ੍ਰਿਪਸ਼ਨ ਰਹਿੰਦੀਆਂ ਹਨ: ਇੱਕ ਐਕਸਟੈਂਸ਼ਨ ਕੋਲ ਕੀਚੇਨ ਨਹੀਂ ਹੁੰਦੀ। ਹਰ ਇੱਕ ਸਿਰਫ਼ ਆਪਣੇ ਪ੍ਰਦਾਤਾ ਨੂੰ ਜਾਂਦੀ ਹੈ, ਹੋਰ ਕਿਤੇ ਨਹੀਂ।',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'ਲਾਈਨ {line} ਉਹ ਨਹੀਂ ਕਹਿੰਦੀ ਜੋ ਨਮੂਨਾ ਕਹਿੰਦਾ ਹੈ।',
  'Line {line} names a property the clip writes itself.':
    'ਲਾਈਨ {line} ਉਸ ਗੁਣ ਦਾ ਨਾਂ ਲੈਂਦੀ ਹੈ ਜੋ ਕਲਿੱਪ ਆਪ ਲਿਖਦੀ ਹੈ।',
  'The template on line {line} has no name.': 'ਲਾਈਨ {line} ਵਾਲੇ ਨਮੂਨੇ ਦਾ ਨਾਂ ਨਹੀਂ ਹੈ।',
  'Line {line} repeats a name that is already there.':
    'ਲਾਈਨ {line} ਪਹਿਲਾਂ ਹੀ ਮੌਜੂਦ ਨਾਂ ਦੁਹਰਾਉਂਦੀ ਹੈ।',
  'There is no template in there.': 'ਉਸ ਵਿੱਚ ਕੋਈ ਨਮੂਨਾ ਨਹੀਂ ਹੈ।',
  // Signing in
  'Email address': 'ਈਮੇਲ ਪਤਾ',
  Continue: 'ਅੱਗੇ ਵਧੋ',
  Sending: 'ਭੇਜ ਰਿਹਾ ਹੈ',
  'Code sent to': 'ਕੋਡ ਇਸ ਨੂੰ ਭੇਜਿਆ',
  'Send a new code': 'ਨਵਾਂ ਕੋਡ ਭੇਜੋ',
  'Resend in {seconds}s': '{seconds} ਸਕਿੰਟ ਵਿੱਚ ਮੁੜ ਭੇਜੋ',
  'Digit {number}': 'ਅੰਕ {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'ਪਹਿਲਾਂ nibeditor ਵਿੱਚ ਸਾਈਨ ਇਨ ਕਰੋ।',
  'Make a space in nibeditor first.': 'ਪਹਿਲਾਂ nibeditor ਵਿੱਚ ਥਾਂ ਬਣਾਓ।',
  'This page cannot be clipped.': 'ਇਹ ਸਫ਼ਾ ਕਲਿੱਪ ਨਹੀਂ ਹੋ ਸਕਦਾ।',
  'There is nothing to clip here.': 'ਇੱਥੇ ਕਲਿੱਪ ਕਰਨ ਲਈ ਕੁਝ ਨਹੀਂ ਹੈ।',
  'This clip is larger than a note can be.': 'ਇਹ ਕਲਿੱਪ ਇੱਕ ਨੋਟ ਤੋਂ ਵੱਡੀ ਹੈ।',
  'Your account is out of space.': 'ਤੁਹਾਡੇ ਖਾਤੇ ਵਿੱਚ ਥਾਂ ਨਹੀਂ ਬਚੀ।',
  'Could not reach nibeditor.': 'nibeditor ਤੱਕ ਨਹੀਂ ਪਹੁੰਚ ਸਕੇ।',
  'Could not reach the provider.': 'ਪ੍ਰਦਾਤਾ ਤੱਕ ਨਹੀਂ ਪਹੁੰਚ ਸਕੇ।',
  'The provider answered with something else.': 'ਪ੍ਰਦਾਤਾ ਨੇ ਕੁਝ ਹੋਰ ਜਵਾਬ ਦਿੱਤਾ।',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'ਜਾਇਜ਼ ਈਮੇਲ ਪਤਾ ਪਾਓ',
  'that code is not right': 'ਉਹ ਕੋਡ ਠੀਕ ਨਹੀਂ',
  'that code has expired - ask for a new one': 'ਉਸ ਕੋਡ ਦੀ ਮਿਆਦ ਮੁੱਕ ਗਈ - ਨਵਾਂ ਮੰਗੋ',
  'too many tries - ask for a new code': 'ਬਹੁਤ ਕੋਸ਼ਿਸ਼ਾਂ - ਨਵਾਂ ਕੋਡ ਮੰਗੋ',
  'sign in first': 'ਪਹਿਲਾਂ ਸਾਈਨ ਇਨ ਕਰੋ',
  'no such space': 'ਐਸੀ ਥਾਂ ਨਹੀਂ',
  'that path is not usable': 'ਉਹ ਰਾਹ ਵਰਤਣ ਯੋਗ ਨਹੀਂ',
  // A page as a task in the inbox
  'As a task': 'ਕੰਮ ਵਜੋਂ',
}

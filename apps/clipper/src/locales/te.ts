import type { Dictionary } from '../lib/translate'

export const te: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'పేజీ',
  Selection: 'ఎంపిక',
  Link: 'లింక్',
  // Saving one
  Save: 'సేవ్ చేయి',
  Saving: 'సేవ్ చేయడం',
  Saved: 'సేవ్ అయింది',
  // Where it goes
  Space: 'స్పేస్',
  Folder: 'ఫోల్డర్',
  // The account
  Account: 'ఖాతా',
  'Sign out': 'సైన్ అవుట్',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'భాష',
  'Match the system': 'సిస్టమ్ ప్రకారం',
  'Machine-translated. Corrections welcome.': 'యంత్ర అనువాదం. సరిదిద్దుబాట్లు స్వాగతం.',
  Appearance: 'రూపం',
  Light: 'లైట్',
  Dark: 'డార్క్',
  Shortcuts: 'షార్ట్‌కట్‌లు',
  Open: 'తెరువు',
  // The interpreter, in the popup
  Template: 'మూస',
  Interpret: 'వ్యాఖ్యానించు',
  '{count} characters sent': {
    one: '{count} అక్షరం పంపబడింది',
    other: '{count} అక్షరాలు పంపబడ్డాయి',
  },
  // And on the options page
  Interpreter: 'వ్యాఖ్యానం',
  Off: 'ఆఫ్',
  'Another server': 'మరో సర్వర్',
  'Ollama is running here': 'Ollama ఇక్కడ నడుస్తోంది',
  'Use it': 'అది వాడు',
  Address: 'చిరునామా',
  'API key': 'API కీ',
  Model: 'మోడల్',
  Templates: 'మూసలు',
  Reset: 'రీసెట్',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'కీలు ఈ బ్రౌజర్‌లో ఎన్‌క్రిప్షన్ లేకుండా ఉంటాయి: పొడిగింపుకు కీచెయిన్ లేదు. ప్రతి కీ తన ప్రొవైడర్‌కు మాత్రమే వెళ్తుంది, మరెక్కడికీ కాదు.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'పంక్తి {line} మూస చెప్పేది ఏదీ చెప్పదు.',
  'Line {line} names a property the clip writes itself.':
    'పంక్తి {line} క్లిప్ తానే రాసే లక్షణాన్ని పేర్కొంటుంది.',
  'The template on line {line} has no name.': 'పంక్తి {line} లోని మూసకు పేరు లేదు.',
  'Line {line} repeats a name that is already there.':
    'పంక్తి {line} ఇప్పటికే ఉన్న పేరును మళ్లీ చెబుతుంది.',
  'There is no template in there.': 'అందులో మూస లేదు.',
  // Signing in
  'Email address': 'ఇమెయిల్ చిరునామా',
  Continue: 'కొనసాగు',
  Sending: 'పంపుతోంది',
  'Code sent to': 'కోడ్ పంపిన చిరునామా',
  'Send a new code': 'కొత్త కోడ్ పంపు',
  'Resend in {seconds}s': '{seconds} సెకన్లలో మళ్లీ పంపు',
  'Digit {number}': 'అంకె {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'మొదట nibeditor లో సైన్ ఇన్ చేయండి.',
  'Make a space in nibeditor first.': 'మొదట nibeditor లో ఒక స్పేస్ చేయండి.',
  'This page cannot be clipped.': 'ఈ పేజీని క్లిప్ చేయలేము.',
  'There is nothing to clip here.': 'ఇక్కడ క్లిప్ చేయడానికి ఏమీ లేదు.',
  'This clip is larger than a note can be.': 'ఈ క్లిప్ ఒక నోట్ కంటే పెద్దది.',
  'Your account is out of space.': 'మీ ఖాతాలో స్టోరేజ్ లేదు.',
  'Could not reach nibeditor.': 'nibeditor ను చేరుకోలేకపోయాము.',
  'Could not reach the provider.': 'ప్రొవైడర్‌ను చేరుకోలేకపోయాము.',
  'The provider answered with something else.': 'ప్రొవైడర్ మరేదో బదులిచ్చింది.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'సరైన ఇమెయిల్ చిరునామా ఇవ్వండి',
  'that code is not right': 'ఆ కోడ్ సరైనది కాదు',
  'that code has expired - ask for a new one': 'ఆ కోడ్ గడువు ముగిసింది - కొత్తది అడగండి',
  'too many tries - ask for a new code': 'చాలా ప్రయత్నాలు - కొత్త కోడ్ అడగండి',
  'sign in first': 'ముందు సైన్ ఇన్ చేయండి',
  'no such space': 'అలాంటి స్పేస్ లేదు',
  'that path is not usable': 'ఆ పాత్ వాడదగినది కాదు',
}

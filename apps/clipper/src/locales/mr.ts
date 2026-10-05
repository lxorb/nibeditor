import type { Dictionary } from '../lib/translate'

export const mr: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'पान',
  Selection: 'निवड',
  Link: 'लिंक',
  // Saving one
  Save: 'जतन करा',
  Saving: 'जतन करणे',
  Saved: 'जतन झाले',
  // Where it goes
  Space: 'स्पेस',
  Folder: 'फोल्डर',
  // The account
  Account: 'खाते',
  'Sign out': 'साइन आउट',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'भाषा',
  'Match the system': 'सिस्टमप्रमाणे',
  'Machine-translated. Corrections welcome.': 'यंत्राने अनुवादित. सुधारणा स्वागतार्ह.',
  Appearance: 'रूप',
  Light: 'फिकट',
  Dark: 'गडद',
  Shortcuts: 'शॉर्टकट',
  Open: 'उघडा',
  // The interpreter, in the popup
  Template: 'साचा',
  Interpret: 'अर्थ लावा',
  '{count} characters sent': { one: '{count} अक्षर पाठवले', other: '{count} अक्षरे पाठवली' },
  // And on the options page
  Interpreter: 'अर्थ लावणे',
  Off: 'बंद',
  'Another server': 'दुसरा सर्व्हर',
  'Ollama is running here': 'Ollama येथे चालू आहे',
  'Use it': 'तो वापरा',
  Address: 'पत्ता',
  'API key': 'API कळ',
  Model: 'मॉडेल',
  Templates: 'साचे',
  Reset: 'रीसेट करा',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'कळा या ब्राउझरमध्ये एन्क्रिप्शनशिवाय राहतात: विस्ताराला कीचेन नसते. प्रत्येक कळ फक्त आपल्या पुरवठादाराकडे जाते, अन्यत्र कुठेही नाही.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'ओळ {line} साचा सांगतो असे काही सांगत नाही.',
  'Line {line} names a property the clip writes itself.':
    'ओळ {line} क्लिप स्वतः लिहिते असा गुणधर्म सांगते.',
  'The template on line {line} has no name.': 'ओळ {line} वरील साच्याला नाव नाही.',
  'Line {line} repeats a name that is already there.': 'ओळ {line} आधीच असलेले नाव पुन्हा सांगते.',
  'There is no template in there.': 'त्यात कोणताही साचा नाही.',
  // Signing in
  'Email address': 'ईमेल पत्ता',
  Continue: 'पुढे चला',
  Sending: 'पाठवत आहे',
  'Code sent to': 'कोड पाठवला',
  'Send a new code': 'नवीन कोड पाठवा',
  'Resend in {seconds}s': '{seconds} सेकंदांत पुन्हा पाठवा',
  'Digit {number}': 'अंक {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'आधी nibeditor मध्ये साइन इन करा.',
  'Make a space in nibeditor first.': 'आधी nibeditor मध्ये स्पेस बनवा.',
  'This page cannot be clipped.': 'हे पान क्लिप करता येत नाही.',
  'There is nothing to clip here.': 'येथे क्लिप करण्यासारखे काही नाही.',
  'This clip is larger than a note can be.': 'ही क्लिप नोंद असू शकते त्याहून मोठी आहे.',
  'Your account is out of space.': 'तुमच्या खात्यात जागा उरली नाही.',
  'Could not reach nibeditor.': 'nibeditor पर्यंत पोहोचता आले नाही.',
  'Could not reach the provider.': 'पुरवठादारापर्यंत पोहोचता आले नाही.',
  'The provider answered with something else.': 'पुरवठादाराने दुसरे काही उत्तर दिले.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'योग्य ईमेल पत्ता लिहा',
  'that code is not right': 'तो कोड बरोबर नाही',
  'that code has expired - ask for a new one': 'तो कोड संपला - नवीन मागा',
  'too many tries - ask for a new code': 'फार प्रयत्न - नवीन कोड मागा',
  'sign in first': 'आधी साइन इन करा',
  'no such space': 'असा स्पेस नाही',
  'that path is not usable': 'तो पथ वापरता येत नाही',
  // A page as a task in the inbox
  'As a task': 'काम म्हणून',
}

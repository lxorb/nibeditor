import type { Dictionary } from '../lib/translate'

export const hi: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'पेज',
  Selection: 'चयन',
  Link: 'लिंक',
  // Saving one
  Save: 'सहेजें',
  Saving: 'सहेजना',
  Saved: 'सहेजा गया',
  // Where it goes
  Space: 'स्पेस',
  Folder: 'फ़ोल्डर',
  // The account
  Account: 'खाता',
  'Sign out': 'साइन आउट',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'भाषा',
  'Match the system': 'सिस्टम के अनुसार',
  'Machine-translated. Corrections welcome.': 'मशीन से अनुवादित। सुधार का स्वागत है।',
  Appearance: 'दिखावट',
  Light: 'हल्का',
  Dark: 'गहरा',
  Shortcuts: 'शॉर्टकट',
  Open: 'खोलें',
  // The interpreter, in the popup
  Template: 'टेम्पलेट',
  Interpret: 'व्याख्या',
  '{count} characters sent': { one: '{count} अक्षर भेजा', other: '{count} अक्षर भेजे' },
  // And on the options page
  Interpreter: 'व्याख्याकार',
  Off: 'बंद',
  'Another server': 'कोई और सर्वर',
  'Ollama is running here': 'Ollama यहाँ चल रहा है',
  'Use it': 'इसे इस्तेमाल करें',
  Address: 'पता',
  'API key': 'API कुंजी',
  Model: 'मॉडल',
  Templates: 'टेम्पलेट',
  Reset: 'रीसेट करें',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'कुंजियाँ इस ब्राउज़र में बिना एन्क्रिप्शन रहती हैं: एक्सटेंशन के पास कीचेन नहीं होती। हर कुंजी सिर्फ़ अपने प्रदाता को जाती है, और कहीं नहीं।',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'पंक्ति {line} वह नहीं कहती जो टेम्पलेट कहता है।',
  'Line {line} names a property the clip writes itself.':
    'पंक्ति {line} उस गुण का नाम लेती है जिसे क्लिप खुद लिखता है।',
  'The template on line {line} has no name.': 'पंक्ति {line} के टेम्पलेट का नाम नहीं है।',
  'Line {line} repeats a name that is already there.':
    'पंक्ति {line} पहले से मौजूद नाम दोहराती है।',
  'There is no template in there.': 'उसमें कोई टेम्पलेट नहीं है।',
  // Signing in
  'Email address': 'ईमेल पता',
  Continue: 'जारी रखें',
  Sending: 'भेजा जा रहा है',
  'Code sent to': 'कोड भेजा गया',
  'Send a new code': 'नया कोड भेजें',
  'Resend in {seconds}s': '{seconds} सेकंड में फिर भेजें',
  'Digit {number}': 'अंक {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'पहले nibeditor में साइन इन करें।',
  'Make a space in nibeditor first.': 'पहले nibeditor में एक स्पेस बनाएँ।',
  'This page cannot be clipped.': 'यह पेज क्लिप नहीं हो सकता।',
  'There is nothing to clip here.': 'यहाँ क्लिप करने के लिए कुछ नहीं है।',
  'This clip is larger than a note can be.': 'यह क्लिप एक नोट से बड़ी है।',
  'Your account is out of space.': 'आपके खाते में जगह नहीं बची।',
  'Could not reach nibeditor.': 'nibeditor तक नहीं पहुँच सके।',
  'Could not reach the provider.': 'प्रदाता तक नहीं पहुँच सके।',
  'The provider answered with something else.': 'प्रदाता ने कुछ और उत्तर दिया।',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'सही ईमेल पता लिखें',
  'that code is not right': 'वह कोड सही नहीं है',
  'that code has expired - ask for a new one': 'वह कोड खत्म हो गया - नया मँगाएँ',
  'too many tries - ask for a new code': 'बहुत कोशिशें - नया कोड मँगाएँ',
  'sign in first': 'पहले साइन इन करें',
  'no such space': 'ऐसा कोई स्पेस नहीं',
  'that path is not usable': 'वह पथ काम का नहीं',
  // A page as a task in the inbox
  'As a task': 'कार्य के रूप में',
}

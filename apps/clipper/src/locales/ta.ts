import type { Dictionary } from '../lib/translate'

export const ta: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'பக்கம்',
  Selection: 'தேர்வு',
  Link: 'இணைப்பு',
  // Saving one
  Save: 'சேமி',
  Saving: 'சேமித்தல்',
  Saved: 'சேமிக்கப்பட்டது',
  // Where it goes
  Space: 'இடம்',
  Folder: 'கோப்புறை',
  // The account
  Account: 'கணக்கு',
  'Sign out': 'வெளியேறு',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'மொழி',
  'Match the system': 'கணினியின்படி',
  'Machine-translated. Corrections welcome.':
    'இயந்திர மொழிபெயர்ப்பு. திருத்தங்கள் வரவேற்கப்படுகின்றன.',
  Appearance: 'தோற்றம்',
  Light: 'வெளிர்',
  Dark: 'இருள்',
  Shortcuts: 'குறுக்குவழிகள்',
  Open: 'திற',
  // The interpreter, in the popup
  Template: 'வார்ப்புரு',
  Interpret: 'விளக்கு',
  '{count} characters sent': {
    one: '{count} எழுத்து அனுப்பப்பட்டது',
    other: '{count} எழுத்துகள் அனுப்பப்பட்டன',
  },
  // And on the options page
  Interpreter: 'விளக்கம்',
  Off: 'ஆஃப்',
  'Another server': 'வேறொரு சேவையகம்',
  'Ollama is running here': 'Ollama இங்கே இயங்குகிறது',
  'Use it': 'அதைப் பயன்படுத்து',
  Address: 'முகவரி',
  'API key': 'API சாவி',
  Model: 'மாடல்',
  Templates: 'வார்ப்புருக்கள்',
  Reset: 'மீட்டமை',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'சாவிகள் இந்த உலாவியில் மறையாக்கம் இல்லாமல் இருக்கும்: நீட்டிப்புக்குச் சாவிக்கொத்து இல்லை. ஒவ்வொன்றும் தன் வழங்குநருக்கு மட்டுமே செல்லும், வேறெங்கும் இல்லை.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'வரி {line} வார்ப்புரு சொல்வதை எதையும் சொல்லவில்லை.',
  'Line {line} names a property the clip writes itself.':
    'வரி {line} துணுக்கு தானே எழுதும் ஒரு பண்பைப் பெயரிடுகிறது.',
  'The template on line {line} has no name.': 'வரி {line} இல் உள்ள வார்ப்புருவுக்குப் பெயர் இல்லை.',
  'Line {line} repeats a name that is already there.':
    'வரி {line} ஏற்கனவே உள்ள பெயரை மீண்டும் சொல்கிறது.',
  'There is no template in there.': 'அதில் வார்ப்புரு இல்லை.',
  // Signing in
  'Email address': 'மின்னஞ்சல் முகவரி',
  Continue: 'தொடர்',
  Sending: 'அனுப்புகிறது',
  'Code sent to': 'குறியீடு அனுப்பப்பட்டது',
  'Send a new code': 'புதிய குறியீட்டை அனுப்பு',
  'Resend in {seconds}s': '{seconds} வினாடியில் மீண்டும் அனுப்பு',
  'Digit {number}': 'இலக்கம் {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'முதலில் nibeditor இல் உள்நுழையுங்கள்.',
  'Make a space in nibeditor first.': 'முதலில் nibeditor இல் ஒரு இடத்தை உருவாக்குங்கள்.',
  'This page cannot be clipped.': 'இந்தப் பக்கத்தைத் துணுக்காக எடுக்க முடியாது.',
  'There is nothing to clip here.': 'இங்கே எடுக்க ஒன்றும் இல்லை.',
  'This clip is larger than a note can be.':
    'இந்தத் துணுக்கு ஒரு குறிப்பு இருக்கக்கூடியதைவிடப் பெரியது.',
  'Your account is out of space.': 'உங்கள் கணக்கில் சேமிப்பிடம் இல்லை.',
  'Could not reach nibeditor.': 'nibeditor ஐ அணுக முடியவில்லை.',
  'Could not reach the provider.': 'வழங்குநரை அணுக முடியவில்லை.',
  'The provider answered with something else.': 'வழங்குநர் வேறு எதையோ பதிலளித்தது.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'சரியான மின்னஞ்சல் முகவரியை உள்ளிடவும்',
  'that code is not right': 'அந்தக் குறியீடு சரியில்லை',
  'that code has expired - ask for a new one':
    'அந்தக் குறியீட்டின் காலம் முடிந்தது - புதியது கேட்கவும்',
  'too many tries - ask for a new code': 'மிக அதிக முயற்சிகள் - புதிய குறியீடு கேட்கவும்',
  'sign in first': 'முதலில் உள்நுழையவும்',
  'no such space': 'அப்படி ஒரு இடம் இல்லை',
  'that path is not usable': 'அந்தப் பாதை பயன்படுத்த முடியாதது',
  // A page as a task in the inbox
  'As a task': 'பணியாக',
}

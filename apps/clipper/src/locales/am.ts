import type { Dictionary } from '../lib/translate'

export const am: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'ገጽ',
  Selection: 'ምርጫ',
  Link: 'አገናኝ',
  // Saving one
  Save: 'አስቀምጥ',
  Saving: 'በማስቀመጥ ላይ',
  Saved: 'ተቀምጧል',
  // Where it goes
  Space: 'ቦታ',
  Folder: 'ፎልደር',
  // The account
  Account: 'መዝገብ',
  'Sign out': 'ውጣ',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'ቋንቋ',
  'Match the system': 'ሥርዓቱን ተከተል',
  'Machine-translated. Corrections welcome.': 'በማሽን የተተረጎመ። ማስተካከያ በደስታ ይቀበላል።',
  Appearance: 'መልክ',
  Light: 'ብርሃን',
  Dark: 'ጨለማ',
  Shortcuts: 'አቋራጮች',
  Open: 'ክፈት',
  // The interpreter, in the popup
  Template: 'አብነት',
  Interpret: 'ተንትን',
  '{count} characters sent': { one: '{count} ቁምፊ ተልኳል', other: '{count} ቁምፊዎች ተልኳል' },
  // And on the options page
  Interpreter: 'ትንታኔ',
  Off: 'ጠፍቷል',
  'Another server': 'ሌላ አገልጋይ',
  'Ollama is running here': 'Ollama እዚህ ይሠራል',
  'Use it': 'ተጠቀምበት',
  Address: 'አድራሻ',
  'API key': 'የAPI ቁልፍ',
  Model: 'ሞዴል',
  Templates: 'አብነቶች',
  Reset: 'መልስ',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'ቁልፎች ባልተመሰጠረ ሁኔታ በዚህ አሳሽ ውስጥ ይቀመጣሉ፦ ቅጥያ የቁልፍ ማስቀመጫ የለውም። ሁሉም ወደ ራሱ አቅራቢ ብቻ ይላካል፣ ወደ ሌላ ስፍራ አይሄድም።',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'መስመር {line} አብነት የሚናገረውን አይናገርም።',
  'Line {line} names a property the clip writes itself.': 'መስመር {line} ቅንጥቡ ራሱ የሚጽፈውን ንብረት ይጠራል።',
  'The template on line {line} has no name.': 'በመስመር {line} ላይ ያለው አብነት ስም የለውም።',
  'Line {line} repeats a name that is already there.': 'መስመር {line} አስቀድሞ ያለን ስም ይደግማል።',
  'There is no template in there.': 'እዚያ ውስጥ አብነት የለም።',
  // Signing in
  'Email address': 'የኢሜይል አድራሻ',
  Continue: 'ቀጥል',
  Sending: 'በመላክ ላይ',
  'Code sent to': 'ኮድ የተላከለት',
  'Send a new code': 'አዲስ ኮድ ላክ',
  'Resend in {seconds}s': 'በ{seconds} ሰከንድ እንደገና ላክ',
  'Digit {number}': 'አሃዝ {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'በቅድሚያ ወደ nibeditor ግባ።',
  'Make a space in nibeditor first.': 'በቅድሚያ በ nibeditor ውስጥ ቦታ ፍጠር።',
  'This page cannot be clipped.': 'ይህ ገጽ ሊቀነጠብ አይችልም።',
  'There is nothing to clip here.': 'እዚህ የሚቀነጠብ ምንም የለም።',
  'This clip is larger than a note can be.': 'ይህ ቅንጥብ ማስታወሻ ከሚችለው በላይ ትልቅ ነው።',
  'Your account is out of space.': 'መዝገብህ ማከማቻ ሞልቷል።',
  'Could not reach nibeditor.': 'nibeditor ላይ መድረስ አልተቻለም።',
  'Could not reach the provider.': 'አቅራቢው ላይ መድረስ አልተቻለም።',
  'The provider answered with something else.': 'አቅራቢው ሌላ ነገር መለሰ።',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'ትክክለኛ የኢሜይል አድራሻ አስገባ',
  'that code is not right': 'ያ ኮድ ትክክል አይደለም',
  'that code has expired - ask for a new one': 'ያ ኮድ ጊዜው አልቋል - አዲስ ጠይቅ',
  'too many tries - ask for a new code': 'ብዙ ሙከራ - አዲስ ኮድ ጠይቅ',
  'sign in first': 'መጀመሪያ ግባ',
  'no such space': 'እንዲህ ያለ ቦታ የለም',
  'that path is not usable': 'ያ መንገድ አይሠራም',
}

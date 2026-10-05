import type { Dictionary } from '../lib/translate'

export const gu: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'પાનું',
  Selection: 'પસંદગી',
  Link: 'કડી',
  // Saving one
  Save: 'સાચવો',
  Saving: 'સાચવે છે',
  Saved: 'સાચવ્યું',
  // Where it goes
  Space: 'જગ્યા',
  Folder: 'ફોલ્ડર',
  // The account
  Account: 'ખાતું',
  'Sign out': 'સાઇન આઉટ',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'ભાષા',
  'Match the system': 'સિસ્ટમ પ્રમાણે',
  'Machine-translated. Corrections welcome.': 'યાંત્રિક અનુવાદ. સુધારા આવકાર્ય.',
  Appearance: 'દેખાવ',
  Light: 'આછું',
  Dark: 'ઘાટું',
  Shortcuts: 'ટૂંકાં માર્ગ',
  Open: 'ખોલો',
  // The interpreter, in the popup
  Template: 'ટેમ્પ્લેટ',
  Interpret: 'સમજાવો',
  '{count} characters sent': { one: '{count} અક્ષર મોકલ્યો', other: '{count} અક્ષર મોકલ્યા' },
  // And on the options page
  Interpreter: 'સમજણ',
  Off: 'બંધ',
  'Another server': 'બીજો સર્વર',
  'Ollama is running here': 'Ollama અહીં ચાલે છે',
  'Use it': 'એ વાપરો',
  Address: 'સરનામું',
  'API key': 'API કી',
  Model: 'મોડેલ',
  Templates: 'ટેમ્પ્લેટો',
  Reset: 'પાછું કરો',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'કીઓ આ બ્રાઉઝરમાં એન્ક્રિપ્શન વગર રહે છે: એક્સ્ટેન્શન પાસે કીચેન નથી. દરેક કી ફક્ત પોતાના પ્રદાતાને જાય છે, બીજે ક્યાંય નહીં.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'લીટી {line} ટેમ્પ્લેટ કહે એવું કંઈ કહેતી નથી.',
  'Line {line} names a property the clip writes itself.':
    'લીટી {line} એવા ગુણધર્મનું નામ આપે છે જે ક્લિપ પોતે લખે છે.',
  'The template on line {line} has no name.': 'લીટી {line} પરના ટેમ્પ્લેટને નામ નથી.',
  'Line {line} repeats a name that is already there.': 'લીટી {line} પહેલેથી હોય એ નામ ફરી કહે છે.',
  'There is no template in there.': 'એમાં કોઈ ટેમ્પ્લેટ નથી.',
  // Signing in
  'Email address': 'ઈમેલ સરનામું',
  Continue: 'આગળ વધો',
  Sending: 'મોકલે છે',
  'Code sent to': 'કોડ આને મોકલ્યો',
  'Send a new code': 'નવો કોડ મોકલો',
  'Resend in {seconds}s': '{seconds} સેકન્ડમાં ફરી મોકલો',
  'Digit {number}': 'અંક {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'પહેલાં nibeditor માં સાઇન ઇન કરો.',
  'Make a space in nibeditor first.': 'પહેલાં nibeditor માં જગ્યા બનાવો.',
  'This page cannot be clipped.': 'આ પાનું ક્લિપ થઈ શકતું નથી.',
  'There is nothing to clip here.': 'અહીં ક્લિપ કરવા જેવું કંઈ નથી.',
  'This clip is larger than a note can be.': 'આ ક્લિપ નોંધ હોઈ શકે તેથી મોટી છે.',
  'Your account is out of space.': 'તમારા ખાતામાં જગ્યા નથી.',
  'Could not reach nibeditor.': 'nibeditor સુધી પહોંચી શકાયું નહીં.',
  'Could not reach the provider.': 'પ્રદાતા સુધી પહોંચી શકાયું નહીં.',
  'The provider answered with something else.': 'પ્રદાતાએ બીજું કંઈક જવાબ આપ્યો.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'માન્ય ઈમેલ સરનામું લખો',
  'that code is not right': 'એ કોડ સાચો નથી',
  'that code has expired - ask for a new one': 'એ કોડની મુદત પૂરી - નવો માંગો',
  'too many tries - ask for a new code': 'બહુ પ્રયત્ન - નવો કોડ માંગો',
  'sign in first': 'પહેલાં સાઇન ઇન કરો',
  'no such space': 'એવી જગ્યા નથી',
  'that path is not usable': 'એ પથ વાપરી શકાતો નથી',
  // A page as a task in the inbox
  'As a task': 'કાર્ય તરીકે',
}

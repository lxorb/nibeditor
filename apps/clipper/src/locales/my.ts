import type { Dictionary } from '../lib/translate'

export const my: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'စာမျက်နှာ',
  Selection: 'ရွေးချယ်မှု',
  Link: 'လင့်',
  // Saving one
  Save: 'သိမ်းဆည်း',
  Saving: 'သိမ်းဆည်းမှု',
  Saved: 'သိမ်းပြီး',
  // Where it goes
  Space: 'အလုပ်ခွင်',
  Folder: 'ဖိုင်တွဲ',
  // The account
  Account: 'အကောင့်',
  'Sign out': 'အကောင့်ထွက်',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'ဘာသာစကား',
  'Match the system': 'စနစ်အတိုင်း',
  'Machine-translated. Corrections welcome.': 'စက်ဖြင့်ဘာသာပြန်။ အမှားပြင်ချက်ကြိုဆို။',
  Appearance: 'အသွင်အပြင်',
  Light: 'အလင်း',
  Dark: 'အမှောင်',
  Shortcuts: 'အတိုကောက်များ',
  Open: 'ဖွင့်',
  // The interpreter, in the popup
  Template: 'နမူနာပုံစံ',
  Interpret: 'အနက်ဖွင့်',
  '{count} characters sent': 'အက္ခရာ {count} လုံး ပို့လိုက်သည်',
  // And on the options page
  Interpreter: 'အနက်ဖွင့်ခြင်း',
  Off: 'ပိတ်',
  'Another server': 'အခြားဆာဗာ',
  'Ollama is running here': 'Ollama ဒီမှာ အလုပ်လုပ်နေသည်',
  'Use it': 'ဒါကိုသုံးပါ',
  Address: 'လိပ်စာ',
  'API key': 'API သော့',
  Model: 'မော်ဒယ်',
  Templates: 'နမူနာပုံစံများ',
  Reset: 'ပြန်ထားပါ',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'သော့များကို ဤဘရောက်ဇာတွင် အသွင်ဝှက်မထားဘဲ ထားသည်။ တိုးချဲ့ချက်တွင် သော့တွဲမရှိပါ။ သော့တိုင်းသည် မိမိပေးသူဆီသာ ရောက်သည်၊ အခြားမည်သည့်ဆီမျှ မရောက်ပါ။',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'လိုင်း {line} သည် နမူနာပုံစံဆိုသည့်အရာကို မဆိုပါ။',
  'Line {line} names a property the clip writes itself.':
    'လိုင်း {line} သည် ကလစ်ကိုယ်တိုင်ရေးသော အရည်အချင်းကို အမည်ပေးသည်။',
  'The template on line {line} has no name.': 'လိုင်း {line} ရှိ နမူနာပုံစံတွင် အမည်မရှိပါ။',
  'Line {line} repeats a name that is already there.':
    'လိုင်း {line} သည် ရှိပြီးသားအမည်ကို ထပ်ဆိုသည်။',
  'There is no template in there.': 'ထဲတွင် နမူနာပုံစံမရှိပါ။',
  // Signing in
  'Email address': 'အီးမေးလ်လိပ်စာ',
  Continue: 'ဆက်လုပ်',
  Sending: 'ပို့နေသည်',
  'Code sent to': 'ကုဒ်ပို့လိုက်သည်',
  'Send a new code': 'ကုဒ်အသစ်ပို့',
  'Resend in {seconds}s': '{seconds} စက္ကန့်အတွင်းပြန်ပို့',
  'Digit {number}': 'ဂဏန်း {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'ဦးစွာ nibeditor တွင် အကောင့်ဝင်ပါ။',
  'Make a space in nibeditor first.': 'ဦးစွာ nibeditor တွင် အလုပ်ခွင်တစ်ခု ဖန်တီးပါ။',
  'This page cannot be clipped.': 'ဤစာမျက်နှာကို ကလစ်မလုပ်နိုင်ပါ။',
  'There is nothing to clip here.': 'ဒီမှာ ကလစ်လုပ်ဖွယ် မရှိပါ။',
  'This clip is larger than a note can be.': 'ဤကလစ်သည် မှတ်စုတစ်ခုဖြစ်နိုင်သည့်အရွယ်ထက် ကြီးသည်။',
  'Your account is out of space.': 'သင့်အကောင့်တွင် သိုလှောင်မှုမရှိပါ။',
  'Could not reach nibeditor.': 'nibeditor နှင့် မဆက်သွယ်နိုင်ပါ။',
  'Could not reach the provider.': 'ပေးသူနှင့် မဆက်သွယ်နိုင်ပါ။',
  'The provider answered with something else.': 'ပေးသူသည် အခြားအရာဖြေသည်။',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'မှန်သောအီးမေးလ်လိပ်စာ ထည့်ပါ',
  'that code is not right': 'ထိုကုဒ် မမှန်ပါ',
  'that code has expired - ask for a new one': 'ထိုကုဒ် သက်တမ်းကုန်ပြီ - အသစ်တောင်းပါ',
  'too many tries - ask for a new code': 'ကြိုးပမ်းမှုများလွန်းသည် - ကုဒ်အသစ်တောင်းပါ',
  'sign in first': 'ဦးစွာဝင်ပါ',
  'no such space': 'ထိုနေရာ မရှိပါ',
  'that path is not usable': 'ထိုလမ်းကြောင်း အသုံးမပြုနိုင်ပါ',
  // A page as a task in the inbox
  'As a task': 'လုပ်ငန်းအဖြစ်',
}

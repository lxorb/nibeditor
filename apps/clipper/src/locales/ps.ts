import type { Dictionary } from '../lib/translate'

export const ps: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'مخ',
  Selection: 'ټاکنه',
  Link: 'تړنه',
  // Saving one
  Save: 'خوندول',
  Saving: 'خوندول',
  Saved: 'خوندي شو',
  // Where it goes
  Space: 'ځای',
  Folder: 'دوتنپوښ',
  // The account
  Account: 'حساب',
  'Sign out': 'وتل',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'ژبه',
  'Match the system': 'د غونډال سره',
  'Machine-translated. Corrections welcome.': 'ماشيني ژباړه. سمونې ښه راغلاست.',
  Appearance: 'بڼه',
  Light: 'روښانه',
  Dark: 'تياره',
  Shortcuts: 'لنډ لارې',
  Open: 'پرانيستل',
  // The interpreter, in the popup
  Template: 'کينډۍ',
  Interpret: 'تفسير',
  '{count} characters sent': { one: '{count} توری ولېږل شو', other: '{count} توري ولېږل شول' },
  // And on the options page
  Interpreter: 'تفسيرګر',
  Off: 'بند',
  'Another server': 'بل سرور',
  'Ollama is running here': 'Ollama دلته کار کوي',
  'Use it': 'دا وکاروه',
  Address: 'پته',
  'API key': 'د API کيلي',
  Model: 'ماډل',
  Templates: 'کينډۍ',
  Reset: 'بېرته کول',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'کيليانې پرته له کوډ کولو په همدې کوټګر کې پاتې کېږي: غځېدنه کيلي زنځير نه لري. هره يوه يوازې خپل برابرونکي ته ځي، بل هيچېرې نه.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'کرښه {line} هغه څه نه وايي چې کينډۍ يې وايي.',
  'Line {line} names a property the clip writes itself.':
    'کرښه {line} هغه ځانګړنه نوموي چې کليپ پخپله ليکي.',
  'The template on line {line} has no name.': 'په کرښه {line} کې کينډۍ نوم نه لري.',
  'Line {line} repeats a name that is already there.':
    'کرښه {line} هغه نوم بيا وايي چې لا دمخه دی.',
  'There is no template in there.': 'هلته هيڅ کينډۍ نشته.',
  // Signing in
  'Email address': 'د برېښناليک پته',
  Continue: 'دوام',
  Sending: 'لېږل',
  'Code sent to': 'کوډ ولېږل شو',
  'Send a new code': 'نوې کوډ لېږل',
  'Resend in {seconds}s': 'په {seconds} ثانيو کې بيا لېږل',
  'Digit {number}': 'ګڼه {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'لومړی nibeditor ته ننوځه.',
  'Make a space in nibeditor first.': 'لومړی په nibeditor کې ځای جوړ کړه.',
  'This page cannot be clipped.': 'دا مخ نه شي کليپ کېدای.',
  'There is nothing to clip here.': 'دلته د کليپ کولو لپاره څه نشته.',
  'This clip is larger than a note can be.': 'دا کليپ له هغه لوی دی چې يادښت کېدای شي.',
  'Your account is out of space.': 'ستا حساب زېرمه نه لري.',
  'Could not reach nibeditor.': 'nibeditor ته ونه رسېدل.',
  'Could not reach the provider.': 'برابرونکي ته ونه رسېدل.',
  'The provider answered with something else.': 'برابرونکي بل څه ځواب ورکړ.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'سمه د برېښناليک پته وليکئ',
  'that code is not right': 'هغه کوډ سم نه دی',
  'that code has expired - ask for a new one': 'هغه کوډ پای ته رسېدلی - نوی وغواړئ',
  'too many tries - ask for a new code': 'ډېرې هڅې - نوی کوډ وغواړئ',
  'sign in first': 'لومړی ننوځئ',
  'no such space': 'داسې ځای نشته',
  'that path is not usable': 'هغه لار نه کارېدی شي',
}

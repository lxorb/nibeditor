import type { Dictionary } from '../lib/translate'

export const ar: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'صفحة',
  Selection: 'التحديد',
  Link: 'رابط',
  // Saving one
  Save: 'حفظ',
  Saving: 'الحفظ',
  Saved: 'محفوظ',
  // Where it goes
  Space: 'مساحة',
  Folder: 'مجلد',
  // The account
  Account: 'الحساب',
  'Sign out': 'تسجيل الخروج',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'اللغة',
  'Match the system': 'مطابقة النظام',
  'Machine-translated. Corrections welcome.': 'ترجمة آلية. التصحيحات مرحّب بها.',
  Appearance: 'المظهر',
  Light: 'فاتح',
  Dark: 'داكن',
  Shortcuts: 'الاختصارات',
  Open: 'فتح',
  // The interpreter, in the popup
  Template: 'قالب',
  Interpret: 'تفسير',
  '{count} characters sent': {
    zero: 'أُرسل {count} حرف',
    one: 'أُرسل {count} حرف',
    two: 'أُرسل {count} حرفان',
    few: 'أُرسل {count} أحرف',
    many: 'أُرسل {count} حرفًا',
    other: 'أُرسل {count} حرف',
  },
  // And on the options page
  Interpreter: 'المفسّر',
  Off: 'إيقاف',
  'Another server': 'خادم آخر',
  'Ollama is running here': 'Ollama يعمل هنا',
  'Use it': 'استخدامه',
  Address: 'العنوان',
  'API key': 'مفتاح API',
  Model: 'النموذج',
  Templates: 'القوالب',
  Reset: 'إعادة تعيين',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'تُحفظ المفاتيح في هذا المتصفح بدون تشفير: الامتداد لا يملك سلسلة مفاتيح. ويُرسل كل مفتاح إلى مزوّده وحده ولا إلى غيره.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'السطر {line} لا يقول شيئًا يقوله قالب.',
  'Line {line} names a property the clip writes itself.':
    'السطر {line} يسمّي خاصية يكتبها المقتطف بنفسه.',
  'The template on line {line} has no name.': 'القالب في السطر {line} بلا اسم.',
  'Line {line} repeats a name that is already there.': 'السطر {line} يكرّر اسمًا موجودًا.',
  'There is no template in there.': 'لا قالب هناك.',
  // Signing in
  'Email address': 'عنوان البريد',
  Continue: 'متابعة',
  Sending: 'الإرسال',
  'Code sent to': 'أُرسل الرمز إلى',
  'Send a new code': 'إرسال رمز جديد',
  'Resend in {seconds}s': 'إعادة الإرسال بعد {seconds} ث',
  'Digit {number}': 'الرقم {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'سجّل الدخول إلى nibeditor أولًا.',
  'Make a space in nibeditor first.': 'أنشئ مساحة في nibeditor أولًا.',
  'This page cannot be clipped.': 'لا يمكن اقتطاف هذه الصفحة.',
  'There is nothing to clip here.': 'لا شيء هنا لاقتطافه.',
  'This clip is larger than a note can be.': 'هذا المقتطف أكبر مما تتحمله ملاحظة.',
  'Your account is out of space.': 'نفدت مساحة حسابك.',
  'Could not reach nibeditor.': 'تعذّر الوصول إلى nibeditor.',
  'Could not reach the provider.': 'تعذّر الوصول إلى المزوّد.',
  'The provider answered with something else.': 'أجاب المزوّد بشيء آخر.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'أدخل عنوان بريد صحيحًا',
  'that code is not right': 'الرمز غير صحيح',
  'that code has expired - ask for a new one': 'انتهت صلاحية الرمز - اطلب رمزًا جديدًا',
  'too many tries - ask for a new code': 'محاولات كثيرة - اطلب رمزًا جديدًا',
  'sign in first': 'سجّل الدخول أولًا',
  'no such space': 'لا مساحة بهذا الاسم',
  'that path is not usable': 'المسار غير قابل للاستخدام',
}

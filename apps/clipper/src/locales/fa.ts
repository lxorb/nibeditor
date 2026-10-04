import type { Dictionary } from '../lib/translate'

export const fa: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'صفحه',
  Selection: 'گزینش',
  Link: 'پیوند',
  // Saving one
  Save: 'ذخیره',
  Saving: 'در حال ذخیره',
  Saved: 'ذخیره شد',
  // Where it goes
  Space: 'فضا',
  Folder: 'پوشه',
  // The account
  Account: 'حساب',
  'Sign out': 'خروج',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'زبان',
  'Match the system': 'پیروی از سامانه',
  'Machine-translated. Corrections welcome.': 'ترجمه ماشینی. اصلاح‌ها خوش‌آمدند.',
  Appearance: 'نمایه',
  Light: 'روشن',
  Dark: 'تیره',
  Shortcuts: 'کلیدهای میان‌بر',
  Open: 'گشودن',
  // The interpreter, in the popup
  Template: 'الگو',
  Interpret: 'تفسیر',
  '{count} characters sent': { one: '{count} نویسه فرستاده شد', other: '{count} نویسه فرستاده شد' },
  // And on the options page
  Interpreter: 'تفسیرگر',
  Off: 'خاموش',
  'Another server': 'کارساز دیگر',
  'Ollama is running here': 'Ollama همین‌جا در کار است',
  'Use it': 'به کار بگیر',
  Address: 'نشانی',
  'API key': 'کلید API',
  Model: 'مدل',
  Templates: 'الگوها',
  Reset: 'بازنشانی',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'کلیدها رمزنگاری‌نشده در همین مرورگر می‌مانند: افزونه دسته‌کلید ندارد. هر کلید تنها به فراهم‌کننده خودش فرستاده می‌شود و جای دیگری نمی‌رود.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'خط {line} چیزی نمی‌گوید که الگو بگوید.',
  'Line {line} names a property the clip writes itself.':
    'خط {line} ویژگی‌ای را نام می‌برد که بریده خودش می‌نویسد.',
  'The template on line {line} has no name.': 'الگوی خط {line} نام ندارد.',
  'Line {line} repeats a name that is already there.': 'خط {line} نامی را که هست دوباره می‌آورد.',
  'There is no template in there.': 'آنجا هیچ الگویی نیست.',
  // Signing in
  'Email address': 'نشانی رایانامه',
  Continue: 'ادامه',
  Sending: 'در حال فرستادن',
  'Code sent to': 'کد فرستاده شد به',
  'Send a new code': 'فرستادن کد تازه',
  'Resend in {seconds}s': 'فرستادن دوباره در {seconds} ثانیه',
  'Digit {number}': 'رقم {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'نخست به nibeditor وارد شوید.',
  'Make a space in nibeditor first.': 'نخست در nibeditor فضایی بسازید.',
  'This page cannot be clipped.': 'این صفحه بریده نمی‌شود.',
  'There is nothing to clip here.': 'اینجا چیزی برای بریدن نیست.',
  'This clip is larger than a note can be.': 'این بریده بزرگ‌تر از آن است که یادداشت بگیرد.',
  'Your account is out of space.': 'حساب شما انبار خالی ندارد.',
  'Could not reach nibeditor.': 'nibeditor در دسترس نبود.',
  'Could not reach the provider.': 'فراهم‌کننده در دسترس نبود.',
  'The provider answered with something else.': 'فراهم‌کننده چیز دیگری پاسخ داد.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'نشانی رایانامه درست بنویسید',
  'that code is not right': 'آن کد درست نیست',
  'that code has expired - ask for a new one': 'آن کد سرآمده - تازه بخواهید',
  'too many tries - ask for a new code': 'کوشش بسیار - کد تازه بخواهید',
  'sign in first': 'نخست وارد شوید',
  'no such space': 'چنین فضایی نیست',
  'that path is not usable': 'آن مسیر به‌کار نمی‌آید',
  // A page as a task in the inbox
  'As a task': 'به‌عنوان کار',
}

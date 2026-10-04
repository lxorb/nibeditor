import type { Dictionary } from '../lib/translate'

export const ur: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'صفحہ',
  Selection: 'انتخاب',
  Link: 'لنک',
  // Saving one
  Save: 'محفوظ کریں',
  Saving: 'محفوظ کرنا',
  Saved: 'محفوظ',
  // Where it goes
  Space: 'اسپیس',
  Folder: 'فولڈر',
  // The account
  Account: 'اکاؤنٹ',
  'Sign out': 'سائن آؤٹ',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'زبان',
  'Match the system': 'سسٹم کے مطابق',
  'Machine-translated. Corrections welcome.': 'مشینی ترجمہ۔ تصحیح خوش آمدید۔',
  Appearance: 'ظاہری شکل',
  Light: 'ہلکا',
  Dark: 'گہرا',
  Shortcuts: 'شارٹ کٹس',
  Open: 'کھولیں',
  // The interpreter, in the popup
  Template: 'سانچہ',
  Interpret: 'تشریح',
  '{count} characters sent': { one: '{count} حرف بھیجا گیا', other: '{count} حروف بھیجے گئے' },
  // And on the options page
  Interpreter: 'تشریح کار',
  Off: 'آف',
  'Another server': 'کوئی اور سرور',
  'Ollama is running here': 'Ollama یہاں چل رہا ہے',
  'Use it': 'یہ استعمال کریں',
  Address: 'پتہ',
  'API key': 'API کلید',
  Model: 'ماڈل',
  Templates: 'سانچے',
  Reset: 'ری سیٹ',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'کلیدیں اس براؤزر میں بغیر خفیہ کاری رہتی ہیں: ایکسٹینشن کے پاس کلید زنجیر نہیں ہوتی۔ ہر ایک صرف اپنے فراہم کنندہ کو جاتی ہے، اور کہیں نہیں۔',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'سطر {line} وہ نہیں کہتی جو سانچہ کہتا ہے۔',
  'Line {line} names a property the clip writes itself.':
    'سطر {line} اس خاصیت کا نام لیتی ہے جو تراشہ خود لکھتا ہے۔',
  'The template on line {line} has no name.': 'سطر {line} کے سانچے کا نام نہیں ہے۔',
  'Line {line} repeats a name that is already there.': 'سطر {line} پہلے سے موجود نام دہراتی ہے۔',
  'There is no template in there.': 'اس میں کوئی سانچہ نہیں ہے۔',
  // Signing in
  'Email address': 'ای میل پتہ',
  Continue: 'جاری رکھیں',
  Sending: 'بھیجا جا رہا ہے',
  'Code sent to': 'کوڈ بھیجا گیا',
  'Send a new code': 'نیا کوڈ بھیجیں',
  'Resend in {seconds}s': '{seconds} سیکنڈ بعد دوبارہ',
  'Digit {number}': 'ہندسہ {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'پہلے nibeditor میں سائن ان کریں۔',
  'Make a space in nibeditor first.': 'پہلے nibeditor میں ایک اسپیس بنائیں۔',
  'This page cannot be clipped.': 'یہ صفحہ تراشا نہیں جا سکتا۔',
  'There is nothing to clip here.': 'یہاں تراشنے کے لیے کچھ نہیں ہے۔',
  'This clip is larger than a note can be.': 'یہ تراشہ ایک نوٹ سے بڑا ہے۔',
  'Your account is out of space.': 'آپ کے اکاؤنٹ میں ذخیرہ نہیں بچا۔',
  'Could not reach nibeditor.': 'nibeditor تک نہیں پہنچ سکے۔',
  'Could not reach the provider.': 'فراہم کنندہ تک نہیں پہنچ سکے۔',
  'The provider answered with something else.': 'فراہم کنندہ نے کچھ اور جواب دیا۔',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'درست ای میل پتہ لکھیں',
  'that code is not right': 'یہ کوڈ درست نہیں',
  'that code has expired - ask for a new one': 'اس کوڈ کی مدت ختم - نیا منگوائیں',
  'too many tries - ask for a new code': 'بہت زیادہ کوششیں - نیا کوڈ منگوائیں',
  'sign in first': 'پہلے سائن ان کریں',
  'no such space': 'ایسا اسپیس نہیں',
  'that path is not usable': 'یہ راستہ قابلِ استعمال نہیں',
  // A page as a task in the inbox
  'As a task': 'بطور کام',
}

import type { Dictionary } from '../lib/translate'

export const bn: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'পৃষ্ঠা',
  Selection: 'নির্বাচন',
  Link: 'লিংক',
  // Saving one
  Save: 'সেভ',
  Saving: 'সেভ করা',
  Saved: 'সেভ হয়েছে',
  // Where it goes
  Space: 'স্পেস',
  Folder: 'ফোল্ডার',
  // The account
  Account: 'অ্যাকাউন্ট',
  'Sign out': 'সাইন আউট',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'ভাষা',
  'Match the system': 'সিস্টেম অনুযায়ী',
  'Machine-translated. Corrections welcome.': 'যন্ত্রে অনুবাদ করা। সংশোধন স্বাগত।',
  Appearance: 'চেহারা',
  Light: 'লাইট',
  Dark: 'ডার্ক',
  Shortcuts: 'শর্টকাট',
  Open: 'খুলুন',
  // The interpreter, in the popup
  Template: 'টেমপ্লেট',
  Interpret: 'ব্যাখ্যা',
  '{count} characters sent': {
    one: '{count} অক্ষর পাঠানো হয়েছে',
    other: '{count} অক্ষর পাঠানো হয়েছে',
  },
  // And on the options page
  Interpreter: 'ব্যাখ্যাকারী',
  Off: 'বন্ধ',
  'Another server': 'অন্য একটি সার্ভার',
  'Ollama is running here': 'Ollama এখানে চলছে',
  'Use it': 'এটি ব্যবহার করুন',
  Address: 'ঠিকানা',
  'API key': 'API কী',
  Model: 'মডেল',
  Templates: 'টেমপ্লেটগুলি',
  Reset: 'রিসেট',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'কী এই ব্রাউজারে এনক্রিপশন ছাড়াই থাকে: এক্সটেনশনের কোনো কীচেইন নেই। প্রতিটি কেবল নিজের প্রদানকারীর কাছে যায়, আর কোথাও নয়।',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': '{line} নম্বর লাইন টেমপ্লেটের মতো কিছু বলে না।',
  'Line {line} names a property the clip writes itself.':
    '{line} নম্বর লাইন এমন একটি বৈশিষ্ট্যের নাম দেয় যা ক্লিপ নিজেই লেখে।',
  'The template on line {line} has no name.': '{line} নম্বর লাইনের টেমপ্লেটের নাম নেই।',
  'Line {line} repeats a name that is already there.':
    '{line} নম্বর লাইন আগেই থাকা একটি নাম আবার বলে।',
  'There is no template in there.': 'ওখানে কোনো টেমপ্লেট নেই।',
  // Signing in
  'Email address': 'ইমেইল ঠিকানা',
  Continue: 'চালিয়ে যান',
  Sending: 'পাঠানো হচ্ছে',
  'Code sent to': 'কোড পাঠানো হয়েছে',
  'Send a new code': 'নতুন কোড পাঠান',
  'Resend in {seconds}s': '{seconds}s পরে আবার পাঠান',
  'Digit {number}': 'সংখ্যা {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'আগে nibeditor-এ সাইন ইন করুন।',
  'Make a space in nibeditor first.': 'আগে nibeditor-এ একটি স্পেস বানান।',
  'This page cannot be clipped.': 'এই পৃষ্ঠা ক্লিপ করা যায় না।',
  'There is nothing to clip here.': 'এখানে ক্লিপ করার কিছু নেই।',
  'This clip is larger than a note can be.': 'এই ক্লিপ একটি নোট যতটা হতে পারে তার চেয়ে বড়।',
  'Your account is out of space.': 'আপনার অ্যাকাউন্টে জায়গা নেই।',
  'Could not reach nibeditor.': 'nibeditor-এ পৌঁছানো গেল না।',
  'Could not reach the provider.': 'প্রদানকারীর কাছে পৌঁছানো গেল না।',
  'The provider answered with something else.': 'প্রদানকারী অন্য কিছু উত্তর দিয়েছে।',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'সঠিক ইমেইল ঠিকানা দিন',
  'that code is not right': 'কোডটি ঠিক নয়',
  'that code has expired - ask for a new one': 'কোডটির সময় শেষ - নতুন কোড চান',
  'too many tries - ask for a new code': 'অনেকবার চেষ্টা - নতুন কোড চান',
  'sign in first': 'আগে সাইন ইন করুন',
  'no such space': 'এমন স্পেস নেই',
  'that path is not usable': 'পাথটি ব্যবহারযোগ্য নয়',
  // A page as a task in the inbox
  'As a task': 'কাজ হিসেবে',
}

import type { Dictionary } from '../lib/translate'

export const tr: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Sayfa',
  Selection: 'Seçim',
  Link: 'Bağlantı',
  // Saving one
  Save: 'Kaydet',
  Saving: 'Kaydediliyor',
  Saved: 'Kaydedildi',
  // Where it goes
  Space: 'Alan',
  Folder: 'Klasör',
  // The account
  Account: 'Hesap',
  'Sign out': 'Oturumu kapat',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Dil',
  'Match the system': 'Sistemle aynı',
  'Machine-translated. Corrections welcome.': 'Makine çevirisi. Düzeltmeler beklenir.',
  Appearance: 'Görünüm',
  Light: 'Açık',
  Dark: 'Koyu',
  Shortcuts: 'Kısayollar',
  Open: 'Aç',
  // The interpreter, in the popup
  Template: 'Şablon',
  Interpret: 'Yorumla',
  '{count} characters sent': {
    one: '{count} karakter gönderildi',
    other: '{count} karakter gönderildi',
  },
  // And on the options page
  Interpreter: 'Yorumlama',
  Off: 'Kapalı',
  'Another server': 'Başka bir sunucu',
  'Ollama is running here': 'Ollama burada çalışıyor',
  'Use it': 'Onu kullan',
  Address: 'Adres',
  'API key': 'API anahtarı',
  Model: 'Model',
  Templates: 'Şablonlar',
  Reset: 'Sıfırla',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Anahtarlar bu tarayıcıda şifrelenmeden durur: bir uzantının anahtar zinciri yoktur. Her biri yalnızca kendi sağlayıcısına gider, başka hiçbir yere gitmez.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    '{line}. satır bir şablonun söylediği bir şeyi söylemiyor.',
  'Line {line} names a property the clip writes itself.':
    '{line}. satır, kupürün kendi yazdığı bir özelliği adlandırıyor.',
  'The template on line {line} has no name.': '{line}. satırdaki şablonun adı yok.',
  'Line {line} repeats a name that is already there.':
    '{line}. satır zaten olan bir adı yineliyor.',
  'There is no template in there.': 'Orada şablon yok.',
  // Signing in
  'Email address': 'E-posta adresi',
  Continue: 'Devam',
  Sending: 'Gönderiliyor',
  'Code sent to': 'Kod şuraya gönderildi',
  'Send a new code': 'Yeni kod gönder',
  'Resend in {seconds}s': '{seconds} sn sonra yeniden gönder',
  'Digit {number}': '{number}. hane',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Önce nibeditor’da oturum aç.',
  'Make a space in nibeditor first.': 'Önce nibeditor’da bir alan oluştur.',
  'This page cannot be clipped.': 'Bu sayfa kırpılamaz.',
  'There is nothing to clip here.': 'Burada kırpılacak bir şey yok.',
  'This clip is larger than a note can be.': 'Bu kupür bir notun olabileceğinden büyük.',
  'Your account is out of space.': 'Hesabının yeri kalmadı.',
  'Could not reach nibeditor.': 'nibeditor’a ulaşılamadı.',
  'Could not reach the provider.': 'Sağlayıcıya ulaşılamadı.',
  'The provider answered with something else.': 'Sağlayıcı başka bir şey yanıtladı.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'geçerli bir e-posta adresi girin',
  'that code is not right': 'bu kod doğru değil',
  'that code has expired - ask for a new one': 'bu kodun süresi geçti - yenisini isteyin',
  'too many tries - ask for a new code': 'çok fazla deneme - yeni bir kod isteyin',
  'sign in first': 'önce oturum açın',
  'no such space': 'böyle bir alan yok',
  'that path is not usable': 'bu yol kullanılabilir değil',
  // A page as a task in the inbox
  'As a task': 'Görev olarak',
}

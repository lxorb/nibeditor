import type { Dictionary } from '../lib/translate'

export const ms: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Halaman',
  Selection: 'Pilihan',
  Link: 'Pautan',
  // Saving one
  Save: 'Simpan',
  Saving: 'Menyimpan',
  Saved: 'Disimpan',
  // Where it goes
  Space: 'Ruang',
  Folder: 'Folder',
  // The account
  Account: 'Akaun',
  'Sign out': 'Keluar',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Bahasa',
  'Match the system': 'Ikut sistem',
  'Machine-translated. Corrections welcome.': 'Terjemahan mesin. Pembetulan dialu-alukan.',
  Appearance: 'Penampilan',
  Light: 'Cerah',
  Dark: 'Gelap',
  Shortcuts: 'Pintasan',
  Open: 'Buka',
  // The interpreter, in the popup
  Template: 'Templat',
  Interpret: 'Tafsirkan',
  '{count} characters sent': '{count} aksara dihantar',
  // And on the options page
  Interpreter: 'Penafsir',
  Off: 'Mati',
  'Another server': 'Pelayan lain',
  'Ollama is running here': 'Ollama berjalan di sini',
  'Use it': 'Guna itu',
  Address: 'Alamat',
  'API key': 'Kunci API',
  Model: 'Model',
  Templates: 'Templat',
  Reset: 'Set semula',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Kunci disimpan dalam pelayar ini tanpa penyulitan: sambungan tidak mempunyai rantai kunci. Setiap satu dihantar hanya kepada pembekalnya sendiri dan tidak ke mana-mana lagi.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'Baris {line} tidak mengatakan apa yang dikatakan oleh templat.',
  'Line {line} names a property the clip writes itself.':
    'Baris {line} menamakan sifat yang ditulis sendiri oleh klip.',
  'The template on line {line} has no name.': 'Templat pada baris {line} tiada nama.',
  'Line {line} repeats a name that is already there.':
    'Baris {line} mengulang nama yang sudah ada.',
  'There is no template in there.': 'Tiada templat di dalamnya.',
  // Signing in
  'Email address': 'Alamat e-mel',
  Continue: 'Teruskan',
  Sending: 'Menghantar',
  'Code sent to': 'Kod dihantar ke',
  'Send a new code': 'Hantar kod baharu',
  'Resend in {seconds}s': 'Hantar semula dalam {seconds}s',
  'Digit {number}': 'Digit {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Masuk ke nibeditor dahulu.',
  'Make a space in nibeditor first.': 'Buat satu ruang dalam nibeditor dahulu.',
  'This page cannot be clipped.': 'Halaman ini tidak boleh diklip.',
  'There is nothing to clip here.': 'Tiada apa-apa untuk diklip di sini.',
  'This clip is larger than a note can be.': 'Klip ini lebih besar daripada sebuah nota.',
  'Your account is out of space.': 'Akaun anda tiada ruang simpanan.',
  'Could not reach nibeditor.': 'Tidak dapat menghubungi nibeditor.',
  'Could not reach the provider.': 'Tidak dapat menghubungi pembekal.',
  'The provider answered with something else.': 'Pembekal menjawab sesuatu yang lain.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'masukkan alamat e-mel yang sah',
  'that code is not right': 'kod itu tidak betul',
  'that code has expired - ask for a new one': 'kod itu telah luput - minta yang baharu',
  'too many tries - ask for a new code': 'terlalu banyak cubaan - minta kod baharu',
  'sign in first': 'masuk dahulu',
  'no such space': 'tiada ruang sedemikian',
  'that path is not usable': 'laluan itu tidak boleh digunakan',
  // A page as a task in the inbox
  'As a task': 'Sebagai tugasan',
}

import type { Dictionary } from '../lib/translate'

export const id: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Halaman',
  Selection: 'Pilihan',
  Link: 'Tautan',
  // Saving one
  Save: 'Simpan',
  Saving: 'Menyimpan',
  Saved: 'Tersimpan',
  // Where it goes
  Space: 'Ruang',
  Folder: 'Folder',
  // The account
  Account: 'Akun',
  'Sign out': 'Keluar',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Bahasa',
  'Match the system': 'Ikuti sistem',
  'Machine-translated. Corrections welcome.': 'Terjemahan mesin. Koreksi diterima.',
  Appearance: 'Tampilan',
  Light: 'Terang',
  Dark: 'Gelap',
  Shortcuts: 'Pintasan',
  Open: 'Buka',
  // The interpreter, in the popup
  Template: 'Templat',
  Interpret: 'Tafsirkan',
  '{count} characters sent': '{count} karakter terkirim',
  // And on the options page
  Interpreter: 'Penafsir',
  Off: 'Mati',
  'Another server': 'Server lain',
  'Ollama is running here': 'Ollama berjalan di sini',
  'Use it': 'Pakai itu',
  Address: 'Alamat',
  'API key': 'Kunci API',
  Model: 'Model',
  Templates: 'Templat',
  Reset: 'Setel ulang',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Kunci disimpan di peramban ini tanpa enkripsi: sebuah ekstensi tidak punya gantungan kunci. Masing-masing hanya dikirim ke penyedianya sendiri dan tidak ke mana pun lagi.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'Baris {line} tidak mengatakan hal yang dikatakan sebuah templat.',
  'Line {line} names a property the clip writes itself.':
    'Baris {line} menyebut properti yang ditulis sendiri oleh klip.',
  'The template on line {line} has no name.': 'Templat di baris {line} tidak punya nama.',
  'Line {line} repeats a name that is already there.':
    'Baris {line} mengulang nama yang sudah ada.',
  'There is no template in there.': 'Tidak ada templat di dalamnya.',
  // Signing in
  'Email address': 'Alamat email',
  Continue: 'Lanjut',
  Sending: 'Mengirim',
  'Code sent to': 'Kode dikirim ke',
  'Send a new code': 'Kirim kode baru',
  'Resend in {seconds}s': 'Kirim lagi dalam {seconds}s',
  'Digit {number}': 'Angka {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Masuk ke nibeditor dulu.',
  'Make a space in nibeditor first.': 'Buat sebuah ruang di nibeditor dulu.',
  'This page cannot be clipped.': 'Halaman ini tidak bisa diklip.',
  'There is nothing to clip here.': 'Tidak ada yang bisa diklip di sini.',
  'This clip is larger than a note can be.': 'Klip ini lebih besar daripada sebuah catatan.',
  'Your account is out of space.': 'Akun Anda kehabisan ruang penyimpanan.',
  'Could not reach nibeditor.': 'Tidak dapat menghubungi nibeditor.',
  'Could not reach the provider.': 'Tidak dapat menghubungi penyedia.',
  'The provider answered with something else.': 'Penyedia menjawab hal lain.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'masukkan alamat email yang sah',
  'that code is not right': 'kode itu tidak tepat',
  'that code has expired - ask for a new one': 'kode itu kedaluwarsa - minta yang baru',
  'too many tries - ask for a new code': 'terlalu banyak percobaan - minta kode baru',
  'sign in first': 'masuk dahulu',
  'no such space': 'tidak ada ruang itu',
  'that path is not usable': 'jalur itu tidak dapat dipakai',
}

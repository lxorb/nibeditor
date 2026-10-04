import type { Dictionary } from '../lib/translate'

export const jv: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Kaca',
  Selection: 'Pilihan',
  Link: 'Pranala',
  // Saving one
  Save: 'Simpen',
  Saving: 'Nyimpen',
  Saved: 'Wis disimpen',
  // Where it goes
  Space: 'Papan',
  Folder: 'Folder',
  // The account
  Account: 'Akun',
  'Sign out': 'Metu',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Basa',
  'Match the system': 'Manut sistem',
  'Machine-translated. Corrections welcome.': 'Terjemahan mesin. Koreksi ditampa.',
  Appearance: 'Wewujudan',
  Light: 'Padhang',
  Dark: 'Peteng',
  Shortcuts: 'Dalan cekak',
  Open: 'Bukak',
  // The interpreter, in the popup
  Template: 'Cithakan',
  Interpret: 'Tegesi',
  '{count} characters sent': '{count} aksara wis dikirim',
  // And on the options page
  Interpreter: 'Panegesan',
  Off: 'Mati',
  'Another server': 'Server liya',
  'Ollama is running here': 'Ollama mlaku ing kene',
  'Use it': 'Gunakake iku',
  Address: 'Alamat',
  'API key': 'Kunci API',
  Model: 'Model',
  Templates: 'Cithakan',
  Reset: 'Balekake',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Kunci disimpen ing panjelajah iki tanpa enkripsi: ekstensi ora duwe gantungan kunci. Saben kunci mung dikirim menyang panyedhiyane dhewe lan ora menyang ngendi-endi.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'Larik {line} ora ngucapake apa sing diucapake cithakan.',
  'Line {line} names a property the clip writes itself.':
    'Larik {line} nyebut sipat sing ditulis dhewe dening klip.',
  'The template on line {line} has no name.': 'Cithakan ing larik {line} ora duwe jeneng.',
  'Line {line} repeats a name that is already there.': 'Larik {line} mbaleni jeneng sing wis ana.',
  'There is no template in there.': 'Ora ana cithakan ing kono.',
  // Signing in
  'Email address': 'Alamat email',
  Continue: 'Terusake',
  Sending: 'Ngirim',
  'Code sent to': 'Kode dikirim menyang',
  'Send a new code': 'Kirim kode anyar',
  'Resend in {seconds}s': 'Kirim maneh sawise {seconds}d',
  'Digit {number}': 'Angka {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Mlebu nibeditor dhisik.',
  'Make a space in nibeditor first.': 'Gawe papan ing nibeditor dhisik.',
  'This page cannot be clipped.': 'Kaca iki ora bisa diklip.',
  'There is nothing to clip here.': 'Ora ana sing bisa diklip ing kene.',
  'This clip is larger than a note can be.': 'Klip iki luwih gedhe tinimbang cathetan.',
  'Your account is out of space.': 'Akunmu wis entek panyimpenane.',
  'Could not reach nibeditor.': 'Ora bisa nggayuh nibeditor.',
  'Could not reach the provider.': 'Ora bisa nggayuh panyedhiya.',
  'The provider answered with something else.': 'Panyedhiya mangsuli liyane.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'lebokake alamat email sing bener',
  'that code is not right': 'kode kuwi ora bener',
  'that code has expired - ask for a new one': 'kode kuwi wis kadaluwarsa - njaluk anyar',
  'too many tries - ask for a new code': 'kakehan nyoba - njaluk kode anyar',
  'sign in first': 'mlebu dhisik',
  'no such space': 'ora ana papan kuwi',
  'that path is not usable': 'dalan kuwi ora bisa dipakai',
  // A page as a task in the inbox
  'As a task': 'Dadi tugas',
}

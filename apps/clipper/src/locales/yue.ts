import type { Dictionary } from '../lib/translate'

/** Cantonese, written as Cantonese: derived from the Hong Kong catalogue row by row and
 *  read through, the way the app's own `yue` was. A word Cantonese and standard written
 *  Chinese spell the same way - 儲存, 帳戶, 範本 - stays as it is; a sentence is said
 *  the way a Cantonese reader says it. */
export const yue: Dictionary = {
  // The three clips, in the order they are offered
  Page: '頁面',
  Selection: '揀咗嘅內容',
  Link: '連結',
  // Saving one
  Save: '儲存',
  Saving: '儲存緊',
  Saved: '儲存咗',
  // Where it goes
  Space: '空間',
  Folder: '檔案夾',
  // The account
  Account: '帳戶',
  'Sign out': '登出',
  // The language, and what the row under it says about the catalogue on screen
  Language: '語言',
  'Match the system': '跟返系統',
  'Machine-translated. Corrections welcome.': '係機器翻譯嘅，歡迎指正。',
  Appearance: '外觀',
  Light: '淺色',
  Dark: '深色',
  Shortcuts: '快捷鍵',
  Open: '打開',
  // The interpreter, in the popup
  Template: '範本',
  Interpret: '解讀',
  '{count} characters sent': '傳送咗 {count} 個字元',
  // And on the options page
  Interpreter: '解讀器',
  Off: '關',
  'Another server': '另一部伺服器',
  'Ollama is running here': 'Ollama 喺呢度運行緊',
  'Use it': '就用佢',
  Address: '網址',
  'API key': 'API 密鑰',
  Model: '模型',
  Templates: '範本',
  Reset: '重設',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    '密鑰冇加密，就咁留喺呢個瀏覽器度：擴充功能冇鎖匙圈。每條密鑰淨係會送去佢自己嘅服務商，唔會送去第二度。',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': '第 {line} 行唔係範本會講嘅嘢。',
  'Line {line} names a property the clip writes itself.': '第 {line} 行講嘅屬性，剪藏自己會寫。',
  'The template on line {line} has no name.': '第 {line} 行嘅範本冇名。',
  'Line {line} repeats a name that is already there.': '第 {line} 行重複咗一個已經有嘅名。',
  'There is no template in there.': '嗰度冇範本。',
  // Signing in
  'Email address': '電郵地址',
  Continue: '繼續',
  Sending: '發送緊',
  'Code sent to': '驗證碼已經發咗去',
  'Send a new code': '再發一個新驗證碼',
  'Resend in {seconds}s': '{seconds} 秒之後可以再發',
  'Digit {number}': '第 {number} 位',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': '請先登入 nibeditor。',
  'Make a space in nibeditor first.': '請先喺 nibeditor 開一個空間。',
  'This page cannot be clipped.': '呢個頁面剪藏唔到。',
  'There is nothing to clip here.': '呢度冇嘢可以剪藏。',
  'This clip is larger than a note can be.': '呢個剪藏大過一則筆記可以有嘅大小。',
  'Your account is out of space.': '你個帳戶冇晒儲存空間。',
  'Could not reach nibeditor.': '連唔到 nibeditor。',
  'Could not reach the provider.': '連唔到服務商。',
  'The provider answered with something else.': '服務商答咗啲唔相干嘅嘢。',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': '請輸入一個有效嘅電郵地址',
  'that code is not right': '驗證碼唔啱',
  'that code has expired - ask for a new one': '驗證碼過咗期，請攞過一個新嘅',
  'too many tries - ask for a new code': '試咗太多次，請攞過一個新驗證碼',
  'sign in first': '請先登入',
  'no such space': '冇呢個空間',
  'that path is not usable': '嗰個路徑用唔到',
  // A page as a task in the inbox
  'As a task': '當任務',
}

import type { Dictionary } from '../lib/translate'

export const zhHant: Dictionary = {
  // The three clips, in the order they are offered
  Page: '頁面',
  Selection: '選取內容',
  Link: '連結',
  // Saving one
  Save: '儲存',
  Saving: '儲存',
  Saved: '已儲存',
  // Where it goes
  Space: '空間',
  Folder: '資料夾',
  // The account
  Account: '帳號',
  'Sign out': '登出',
  // The language, and what the row under it says about the catalogue on screen
  Language: '語言',
  'Match the system': '與系統相同',
  'Machine-translated. Corrections welcome.': '機器翻譯，歡迎指正。',
  Appearance: '外觀',
  Light: '淺色',
  Dark: '深色',
  Shortcuts: '快速鍵',
  Open: '開啟',
  // The interpreter, in the popup
  Template: '範本',
  Interpret: '解讀',
  '{count} characters sent': '已傳送 {count} 個字元',
  // And on the options page
  Interpreter: '解讀器',
  Off: '關',
  'Another server': '另一個伺服器',
  'Ollama is running here': 'Ollama 正在這裡執行',
  'Use it': '就用它',
  Address: '網址',
  'API key': 'API金鑰',
  Model: '模型',
  Templates: '範本',
  Reset: '重設',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    '金鑰不加密地留在此瀏覽器中：擴充功能沒有鑰匙圈。每個金鑰只送往它自己的供應商，不送往別處。',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': '第 {line} 行不是範本會說的話。',
  'Line {line} names a property the clip writes itself.': '第 {line} 行指的是剪藏自己會寫的屬性。',
  'The template on line {line} has no name.': '第 {line} 行的範本沒有名字。',
  'Line {line} repeats a name that is already there.': '第 {line} 行重複了已有的名字。',
  'There is no template in there.': '那裡沒有範本。',
  // Signing in
  'Email address': '電子郵件地址',
  Continue: '繼續',
  Sending: '傳送中',
  'Code sent to': '驗證碼已傳送至',
  'Send a new code': '重新傳送驗證碼',
  'Resend in {seconds}s': '{seconds}秒後可重寄',
  'Digit {number}': '第{number}位',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': '請先登入 nibeditor。',
  'Make a space in nibeditor first.': '請先在 nibeditor 中建立一個空間。',
  'This page cannot be clipped.': '此頁面無法剪藏。',
  'There is nothing to clip here.': '這裡沒有可剪藏的內容。',
  'This clip is larger than a note can be.': '這則剪藏超過一則筆記能有的大小。',
  'Your account is out of space.': '你的帳號沒有儲存空間了。',
  'Could not reach nibeditor.': '無法連上 nibeditor。',
  'Could not reach the provider.': '無法連上供應商。',
  'The provider answered with something else.': '供應商回應了別的東西。',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': '請輸入有效的電子郵件地址',
  'that code is not right': '驗證碼不正確',
  'that code has expired - ask for a new one': '驗證碼已過期，請重新索取',
  'too many tries - ask for a new code': '嘗試次數過多，請重新索取驗證碼',
  'sign in first': '請先登入',
  'no such space': '沒有該空間',
  'that path is not usable': '該路徑無法使用',
  // A page as a task in the inbox
  'As a task': '作為任務',
}

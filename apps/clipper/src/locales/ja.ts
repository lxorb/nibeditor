import type { Dictionary } from '../lib/translate'

export const ja: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'ページ',
  Selection: '選択範囲',
  Link: 'リンク',
  // Saving one
  Save: '保存',
  Saving: '保存',
  Saved: '保存しました',
  // Where it goes
  Space: 'スペース',
  Folder: 'フォルダ',
  // The account
  Account: 'アカウント',
  'Sign out': 'サインアウト',
  // The language, and what the row under it says about the catalogue on screen
  Language: '言語',
  'Match the system': 'システムに合わせる',
  'Machine-translated. Corrections welcome.': '機械翻訳です。修正を歓迎します。',
  Appearance: '外観',
  Light: 'ライト',
  Dark: 'ダーク',
  Shortcuts: 'ショートカット',
  Open: '開く',
  // The interpreter, in the popup
  Template: 'テンプレート',
  Interpret: '解釈する',
  '{count} characters sent': '{count} 文字を送信',
  // And on the options page
  Interpreter: '解釈',
  Off: 'オフ',
  'Another server': '別のサーバー',
  'Ollama is running here': 'Ollama がここで動いています',
  'Use it': '使う',
  Address: 'アドレス',
  'API key': 'API キー',
  Model: 'モデル',
  Templates: 'テンプレート一覧',
  Reset: 'リセット',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'キーは暗号化されずにこのブラウザーに保存されます。拡張機能にはキーチェーンがありません。それぞれのキーは対応する提供元にのみ送られます。',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    '{line} 行目はテンプレートの書き方になっていません。',
  'Line {line} names a property the clip writes itself.':
    '{line} 行目のプロパティは取り込みが自分で書きます。',
  'The template on line {line} has no name.': '{line} 行目のテンプレートに名前がありません。',
  'Line {line} repeats a name that is already there.': '{line} 行目の名前はすでに使われています。',
  'There is no template in there.': 'テンプレートが入っていません。',
  // Signing in
  'Email address': 'メールアドレス',
  Continue: '続ける',
  Sending: '送信中',
  'Code sent to': 'コードの送信先',
  'Send a new code': '新しいコードを送る',
  'Resend in {seconds}s': '{seconds} 秒後に再送',
  'Digit {number}': '{number} 桁目',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'まず nibeditor にサインインしてください。',
  'Make a space in nibeditor first.': 'まず nibeditor でスペースを作ってください。',
  'This page cannot be clipped.': 'このページは取り込めません。',
  'There is nothing to clip here.': 'ここには取り込むものがありません。',
  'This clip is larger than a note can be.': 'この取り込みはノートの上限を超えています。',
  'Your account is out of space.': 'アカウントの空き容量がありません。',
  'Could not reach nibeditor.': 'nibeditor に接続できませんでした。',
  'Could not reach the provider.': '提供元に接続できませんでした。',
  'The provider answered with something else.': '提供元が別のものを返しました。',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': '有効なメールアドレスを入力してください',
  'that code is not right': 'コードが違います',
  'that code has expired - ask for a new one':
    'コードの有効期限が切れました - 新しいコードを取得してください',
  'too many tries - ask for a new code': '試行回数が多すぎます - 新しいコードを取得してください',
  'sign in first': 'まずサインインしてください',
  'no such space': 'そのスペースはありません',
  'that path is not usable': 'そのパスは使えません',
  // A page as a task in the inbox
  'As a task': 'タスクとして',
}

import type { Dictionary } from '../lib/translate'

export const zhHans: Dictionary = {
  // The three clips, in the order they are offered
  Page: '页面',
  Selection: '选中内容',
  Link: '链接',
  // Saving one
  Save: '保存',
  Saving: '保存',
  Saved: '已保存',
  // Where it goes
  Space: '空间',
  Folder: '文件夹',
  // The account
  Account: '账户',
  'Sign out': '退出登录',
  // The language, and what the row under it says about the catalogue on screen
  Language: '语言',
  'Match the system': '与系统一致',
  'Machine-translated. Corrections welcome.': '机器翻译，欢迎指正。',
  Appearance: '外观',
  Light: '浅色',
  Dark: '深色',
  Shortcuts: '快捷键',
  Open: '打开',
  // The interpreter, in the popup
  Template: '模板',
  Interpret: '解读',
  '{count} characters sent': '已发送 {count} 个字符',
  // And on the options page
  Interpreter: '解读器',
  Off: '关',
  'Another server': '另一个服务器',
  'Ollama is running here': 'Ollama 正在这里运行',
  'Use it': '就用它',
  Address: '地址',
  'API key': 'API密钥',
  Model: '模型',
  Templates: '模板',
  Reset: '重置',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    '密钥不加密地留在此浏览器中：扩展没有钥匙串。每个密钥只发给它自己的服务商，不发往别处。',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': '第 {line} 行不是模板会说的话。',
  'Line {line} names a property the clip writes itself.': '第 {line} 行指的是剪藏自己会写的属性。',
  'The template on line {line} has no name.': '第 {line} 行的模板没有名字。',
  'Line {line} repeats a name that is already there.': '第 {line} 行重复了已有的名字。',
  'There is no template in there.': '那里没有模板。',
  // Signing in
  'Email address': '邮箱地址',
  Continue: '继续',
  Sending: '发送中',
  'Code sent to': '验证码已发送至',
  'Send a new code': '重新发送验证码',
  'Resend in {seconds}s': '{seconds}秒后可重发',
  'Digit {number}': '第{number}位',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': '请先登录 nibeditor。',
  'Make a space in nibeditor first.': '请先在 nibeditor 中建一个空间。',
  'This page cannot be clipped.': '此页面无法剪藏。',
  'There is nothing to clip here.': '这里没有可剪藏的内容。',
  'This clip is larger than a note can be.': '这条剪藏超过一条笔记能有的大小。',
  'Your account is out of space.': '你的账户没有存储空间了。',
  'Could not reach nibeditor.': '无法连接 nibeditor。',
  'Could not reach the provider.': '无法连接服务商。',
  'The provider answered with something else.': '服务商返回了别的东西。',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': '请输入有效的邮箱地址',
  'that code is not right': '验证码不正确',
  'that code has expired - ask for a new one': '验证码已过期，请重新获取',
  'too many tries - ask for a new code': '尝试次数过多，请重新获取验证码',
  'sign in first': '请先登录',
  'no such space': '没有该空间',
  'that path is not usable': '该路径不可用',
}

import type { Dictionary } from '../lib/translate'

export const th: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'หน้า',
  Selection: 'สิ่งที่เลือก',
  Link: 'ลิงก์',
  // Saving one
  Save: 'บันทึก',
  Saving: 'การบันทึก',
  Saved: 'บันทึกแล้ว',
  // Where it goes
  Space: 'พื้นที่',
  Folder: 'โฟลเดอร์',
  // The account
  Account: 'บัญชี',
  'Sign out': 'ออกจากระบบ',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'ภาษา',
  'Match the system': 'ตามระบบ',
  'Machine-translated. Corrections welcome.': 'แปลด้วยเครื่อง ยินดีรับการแก้ไข',
  Appearance: 'การแสดงผล',
  Light: 'สว่าง',
  Dark: 'มืด',
  Shortcuts: 'ทางลัด',
  Open: 'เปิด',
  // The interpreter, in the popup
  Template: 'แม่แบบ',
  Interpret: 'ตีความ',
  '{count} characters sent': 'ส่งไปแล้ว {count} อักขระ',
  // And on the options page
  Interpreter: 'การตีความ',
  Off: 'ปิด',
  'Another server': 'เซิร์ฟเวอร์อื่น',
  'Ollama is running here': 'Ollama ทำงานอยู่ที่นี่',
  'Use it': 'ใช้อันนี้',
  Address: 'ที่อยู่',
  'API key': 'คีย์ API',
  Model: 'โมเดล',
  Templates: 'แม่แบบ',
  Reset: 'รีเซ็ต',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'คีย์อยู่ในเบราว์เซอร์นี้โดยไม่เข้ารหัส เพราะส่วนขยายไม่มีพวงกุญแจ แต่ละคีย์ส่งไปที่ผู้ให้บริการของตัวเองเท่านั้น ไม่ไปที่อื่น',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'บรรทัด {line} ไม่ได้พูดอย่างที่แม่แบบพูด',
  'Line {line} names a property the clip writes itself.':
    'บรรทัด {line} เรียกคุณสมบัติที่คลิปเขียนเอง',
  'The template on line {line} has no name.': 'แม่แบบที่บรรทัด {line} ไม่มีชื่อ',
  'Line {line} repeats a name that is already there.': 'บรรทัด {line} ซ้ำชื่อที่มีอยู่แล้ว',
  'There is no template in there.': 'ในนั้นไม่มีแม่แบบ',
  // Signing in
  'Email address': 'อีเมล',
  Continue: 'ต่อไป',
  Sending: 'กำลังส่ง',
  'Code sent to': 'ส่งรหัสไปที่',
  'Send a new code': 'ส่งรหัสใหม่',
  'Resend in {seconds}s': 'ส่งอีกใน {seconds} วิ',
  'Digit {number}': 'หลัก {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'เข้าสู่ระบบ nibeditor ก่อน',
  'Make a space in nibeditor first.': 'สร้างพื้นที่ใน nibeditor ก่อน',
  'This page cannot be clipped.': 'หน้านี้คลิปไม่ได้',
  'There is nothing to clip here.': 'ที่นี่ไม่มีอะไรให้คลิป',
  'This clip is larger than a note can be.': 'คลิปนี้ใหญ่กว่าที่โน้ตจะรับได้',
  'Your account is out of space.': 'บัญชีของคุณไม่มีที่เก็บเหลือ',
  'Could not reach nibeditor.': 'ติดต่อ nibeditor ไม่ได้',
  'Could not reach the provider.': 'ติดต่อผู้ให้บริการไม่ได้',
  'The provider answered with something else.': 'ผู้ให้บริการตอบอย่างอื่น',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'กรอกอีเมลที่ใช้ได้',
  'that code is not right': 'รหัสไม่ถูก',
  'that code has expired - ask for a new one': 'รหัสนั้นหมดอายุ - ขอรหัสใหม่',
  'too many tries - ask for a new code': 'ลองมากเกินไป - ขอรหัสใหม่',
  'sign in first': 'เข้าสู่ระบบก่อน',
  'no such space': 'ไม่มีพื้นที่นั้น',
  'that path is not usable': 'พาธนั้นใช้ไม่ได้',
  // A page as a task in the inbox
  'As a task': 'เป็นงาน',
}

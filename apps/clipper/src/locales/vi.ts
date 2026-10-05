import type { Dictionary } from '../lib/translate'

export const vi: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Trang',
  Selection: 'Vùng chọn',
  Link: 'Liên kết',
  // Saving one
  Save: 'Lưu',
  Saving: 'Lưu',
  Saved: 'Đã lưu',
  // Where it goes
  Space: 'Không gian',
  Folder: 'Thư mục',
  // The account
  Account: 'Tài khoản',
  'Sign out': 'Đăng xuất',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Ngôn ngữ',
  'Match the system': 'Theo hệ thống',
  'Machine-translated. Corrections welcome.': 'Dịch bằng máy. Rất mong được sửa.',
  Appearance: 'Giao diện',
  Light: 'Sáng',
  Dark: 'Tối',
  Shortcuts: 'Phím tắt',
  Open: 'Mở',
  // The interpreter, in the popup
  Template: 'Mẫu',
  Interpret: 'Diễn giải',
  '{count} characters sent': 'Đã gửi {count} ký tự',
  // And on the options page
  Interpreter: 'Bộ diễn giải',
  Off: 'Tắt',
  'Another server': 'Máy chủ khác',
  'Ollama is running here': 'Ollama đang chạy ở đây',
  'Use it': 'Dùng cái đó',
  Address: 'Địa chỉ',
  'API key': 'Khoá API',
  Model: 'Mô hình',
  Templates: 'Mẫu',
  Reset: 'Đặt lại',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Khoá nằm trong trình duyệt này mà không được mã hoá: một tiện ích không có chùm khoá. Mỗi khoá chỉ được gửi tới nhà cung cấp của nó và không đi đâu khác.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'Dòng {line} không nói điều mà một mẫu nói.',
  'Line {line} names a property the clip writes itself.':
    'Dòng {line} gọi tên một thuộc tính mà bản cắt tự viết.',
  'The template on line {line} has no name.': 'Mẫu ở dòng {line} không có tên.',
  'Line {line} repeats a name that is already there.': 'Dòng {line} lặp lại một tên đã có.',
  'There is no template in there.': 'Trong đó không có mẫu nào.',
  // Signing in
  'Email address': 'Địa chỉ email',
  Continue: 'Tiếp tục',
  Sending: 'Đang gửi',
  'Code sent to': 'Mã đã gửi tới',
  'Send a new code': 'Gửi mã mới',
  'Resend in {seconds}s': 'Gửi lại sau {seconds}s',
  'Digit {number}': 'Chữ số {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Hãy đăng nhập nibeditor trước.',
  'Make a space in nibeditor first.': 'Hãy tạo một không gian trong nibeditor trước.',
  'This page cannot be clipped.': 'Không cắt được trang này.',
  'There is nothing to clip here.': 'Ở đây không có gì để cắt.',
  'This clip is larger than a note can be.': 'Bản cắt này lớn hơn mức một ghi chú có thể chứa.',
  'Your account is out of space.': 'Tài khoản của bạn hết dung lượng.',
  'Could not reach nibeditor.': 'Không kết nối được nibeditor.',
  'Could not reach the provider.': 'Không kết nối được nhà cung cấp.',
  'The provider answered with something else.': 'Nhà cung cấp trả về thứ khác.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'nhập địa chỉ email hợp lệ',
  'that code is not right': 'mã đó không đúng',
  'that code has expired - ask for a new one': 'mã đó đã hết hạn - xin mã mới',
  'too many tries - ask for a new code': 'thử quá nhiều - xin mã mới',
  'sign in first': 'đăng nhập trước',
  'no such space': 'không có không gian đó',
  'that path is not usable': 'đường dẫn đó không dùng được',
  // A page as a task in the inbox
  'As a task': 'Thành việc cần làm',
}

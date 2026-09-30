import type { Dictionary } from '../lib/translate'

export const ko: Dictionary = {
  // The three clips, in the order they are offered
  Page: '페이지',
  Selection: '선택',
  Link: '링크',
  // Saving one
  Save: '저장',
  Saving: '저장 중',
  Saved: '저장됨',
  // Where it goes
  Space: '공간',
  Folder: '폴더',
  // The account
  Account: '계정',
  'Sign out': '로그아웃',
  // The language, and what the row under it says about the catalogue on screen
  Language: '언어',
  'Match the system': '시스템에 맞춤',
  'Machine-translated. Corrections welcome.': '기계 번역입니다. 수정을 환영합니다.',
  Appearance: '모양',
  Light: '밝게',
  Dark: '어둡게',
  Shortcuts: '바로 가기',
  Open: '열기',
  // The interpreter, in the popup
  Template: '템플릿',
  Interpret: '해석',
  '{count} characters sent': '{count}자 전송됨',
  // And on the options page
  Interpreter: '해석기',
  Off: '꺼짐',
  'Another server': '다른 서버',
  'Ollama is running here': 'Ollama가 여기서 실행 중입니다',
  'Use it': '사용하기',
  Address: '주소',
  'API key': 'API 키',
  Model: '모델',
  Templates: '템플릿',
  Reset: '초기화',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    '키는 암호화되지 않은 채 이 브라우저에 남습니다. 확장에는 키체인이 없습니다. 각 키는 자기 공급자에게만 전송되고 다른 곳으로는 가지 않습니다.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': '{line}행은 템플릿이 말하는 것이 아닙니다.',
  'Line {line} names a property the clip writes itself.':
    '{line}행은 클립이 스스로 쓰는 속성을 가리킵니다.',
  'The template on line {line} has no name.': '{line}행의 템플릿에 이름이 없습니다.',
  'Line {line} repeats a name that is already there.': '{line}행은 이미 있는 이름을 되풀이합니다.',
  'There is no template in there.': '거기에는 템플릿이 없습니다.',
  // Signing in
  'Email address': '이메일 주소',
  Continue: '계속',
  Sending: '보내는 중',
  'Code sent to': '코드를 보낸 곳',
  'Send a new code': '새 코드 보내기',
  'Resend in {seconds}s': '{seconds}초 후 다시 보내기',
  'Digit {number}': '{number}번째 자리',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': '먼저 nibeditor에 로그인하세요.',
  'Make a space in nibeditor first.': '먼저 nibeditor에서 공간을 만드세요.',
  'This page cannot be clipped.': '이 페이지는 클립할 수 없습니다.',
  'There is nothing to clip here.': '여기에는 클립할 것이 없습니다.',
  'This clip is larger than a note can be.': '이 클립은 노트가 담을 수 있는 크기를 넘습니다.',
  'Your account is out of space.': '계정의 저장 공간이 없습니다.',
  'Could not reach nibeditor.': 'nibeditor에 연결할 수 없습니다.',
  'Could not reach the provider.': '공급자에 연결할 수 없습니다.',
  'The provider answered with something else.': '공급자가 다른 것을 답했습니다.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': '올바른 이메일 주소를 입력하세요',
  'that code is not right': '그 코드가 맞지 않습니다',
  'that code has expired - ask for a new one': '그 코드는 만료되었습니다 - 새로 받으세요',
  'too many tries - ask for a new code': '시도가 너무 많습니다 - 새 코드를 받으세요',
  'sign in first': '먼저 로그인하세요',
  'no such space': '그런 공간이 없습니다',
  'that path is not usable': '그 경로는 쓸 수 없습니다',
}

import type { Dictionary } from '../lib/translate'

export const ru: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Страница',
  Selection: 'Выделение',
  Link: 'Ссылка',
  // Saving one
  Save: 'Сохранить',
  Saving: 'Сохранение',
  Saved: 'Сохранено',
  // Where it goes
  Space: 'Пространство',
  Folder: 'Папка',
  // The account
  Account: 'Аккаунт',
  'Sign out': 'Выйти',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Язык',
  'Match the system': 'Как в системе',
  'Machine-translated. Corrections welcome.': 'Машинный перевод. Исправления приветствуются.',
  Appearance: 'Оформление',
  Light: 'Светлая',
  Dark: 'Тёмная',
  Shortcuts: 'Горячие клавиши',
  Open: 'Открыть',
  // The interpreter, in the popup
  Template: 'Шаблон',
  Interpret: 'Истолковать',
  '{count} characters sent': {
    one: 'Отправлен {count} символ',
    few: 'Отправлено {count} символа',
    many: 'Отправлено {count} символов',
    other: 'Отправлено {count} символа',
  },
  // And on the options page
  Interpreter: 'Истолкование',
  Off: 'Выкл.',
  'Another server': 'Другой сервер',
  'Ollama is running here': 'Ollama работает здесь',
  'Use it': 'Взять его',
  Address: 'Адрес',
  'API key': 'Ключ API',
  Model: 'Модель',
  Templates: 'Шаблоны',
  Reset: 'Сбросить',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Ключи лежат в этом браузере без шифрования: у расширения нет связки ключей. Каждый уходит только к своему поставщику и больше никуда.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'Строка {line} говорит не то, что говорит шаблон.',
  'Line {line} names a property the clip writes itself.':
    'Строка {line} называет свойство, которое вырезка пишет сама.',
  'The template on line {line} has no name.': 'У шаблона в строке {line} нет имени.',
  'Line {line} repeats a name that is already there.':
    'Строка {line} повторяет имя, которое уже есть.',
  'There is no template in there.': 'Там нет ни одного шаблона.',
  // Signing in
  'Email address': 'Адрес почты',
  Continue: 'Продолжить',
  Sending: 'Отправка',
  'Code sent to': 'Код отправлен на',
  'Send a new code': 'Отправить новый код',
  'Resend in {seconds}s': 'Повтор через {seconds} с',
  'Digit {number}': 'Цифра {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Сначала войдите в nibeditor.',
  'Make a space in nibeditor first.': 'Сначала создайте пространство в nibeditor.',
  'This page cannot be clipped.': 'Эту страницу не вырезать.',
  'There is nothing to clip here.': 'Здесь нечего вырезать.',
  'This clip is larger than a note can be.': 'Эта вырезка больше, чем может быть заметка.',
  'Your account is out of space.': 'В вашем аккаунте нет места.',
  'Could not reach nibeditor.': 'Не удалось связаться с nibeditor.',
  'Could not reach the provider.': 'Не удалось связаться с поставщиком.',
  'The provider answered with something else.': 'Поставщик ответил чем-то другим.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'введите правильный адрес почты',
  'that code is not right': 'код неверный',
  'that code has expired - ask for a new one': 'срок кода истёк - запросите новый',
  'too many tries - ask for a new code': 'слишком много попыток - запросите новый код',
  'sign in first': 'сначала войдите',
  'no such space': 'такого пространства нет',
  'that path is not usable': 'этот путь не подходит',
  // A page as a task in the inbox
  'As a task': 'Как задачу',
}

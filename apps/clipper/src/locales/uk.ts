import type { Dictionary } from '../lib/translate'

export const uk: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Сторінка',
  Selection: 'Виділення',
  Link: 'Посилання',
  // Saving one
  Save: 'Зберегти',
  Saving: 'Збереження',
  Saved: 'Збережено',
  // Where it goes
  Space: 'Простір',
  Folder: 'Папка',
  // The account
  Account: 'Акаунт',
  'Sign out': 'Вийти',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Мова',
  'Match the system': 'Як у системі',
  'Machine-translated. Corrections welcome.': 'Машинний переклад. Виправлення вітаються.',
  Appearance: 'Оформлення',
  Light: 'Світла',
  Dark: 'Темна',
  Shortcuts: 'Гарячі клавіші',
  Open: 'Відкрити',
  // The interpreter, in the popup
  Template: 'Шаблон',
  Interpret: 'Витлумачити',
  '{count} characters sent': {
    one: 'Надіслано {count} символ',
    few: 'Надіслано {count} символи',
    many: 'Надіслано {count} символів',
    other: 'Надіслано {count} символа',
  },
  // And on the options page
  Interpreter: 'Тлумачення',
  Off: 'Вимк.',
  'Another server': 'Інший сервер',
  'Ollama is running here': 'Ollama працює тут',
  'Use it': 'Узяти його',
  Address: 'Адреса',
  'API key': 'Ключ API',
  Model: 'Модель',
  Templates: 'Шаблони',
  Reset: 'Скинути',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Ключі лежать у цьому браузері без шифрування: розширення не має зв’язки ключів. Кожен іде лише до свого постачальника й нікуди більше.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'Рядок {line} не каже того, що каже шаблон.',
  'Line {line} names a property the clip writes itself.':
    'Рядок {line} називає властивість, яку вирізка пише сама.',
  'The template on line {line} has no name.': 'Шаблон у рядку {line} не має назви.',
  'Line {line} repeats a name that is already there.': 'Рядок {line} повторює назву, яка вже є.',
  'There is no template in there.': 'Там немає жодного шаблону.',
  // Signing in
  'Email address': 'Адреса пошти',
  Continue: 'Продовжити',
  Sending: 'Надсилання',
  'Code sent to': 'Код надіслано на',
  'Send a new code': 'Надіслати новий код',
  'Resend in {seconds}s': 'Повтор через {seconds} с',
  'Digit {number}': 'Цифра {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Спершу увійдіть у nibeditor.',
  'Make a space in nibeditor first.': 'Спершу створіть простір у nibeditor.',
  'This page cannot be clipped.': 'Цю сторінку не вирізати.',
  'There is nothing to clip here.': 'Тут нічого вирізати.',
  'This clip is larger than a note can be.': 'Ця вирізка більша, ніж може бути нотатка.',
  'Your account is out of space.': 'У вашому акаунті немає місця.',
  'Could not reach nibeditor.': 'Не вдалося зв’язатися з nibeditor.',
  'Could not reach the provider.': 'Не вдалося зв’язатися з постачальником.',
  'The provider answered with something else.': 'Постачальник відповів чимось іншим.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'введіть правильну адресу пошти',
  'that code is not right': 'код неправильний',
  'that code has expired - ask for a new one': 'термін коду вийшов - запросіть новий',
  'too many tries - ask for a new code': 'надто багато спроб - запросіть новий код',
  'sign in first': 'спершу увійдіть',
  'no such space': 'такого простору немає',
  'that path is not usable': 'цей шлях не підходить',
  // A page as a task in the inbox
  'As a task': 'Як завдання',
}

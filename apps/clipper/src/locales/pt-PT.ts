import type { Dictionary } from '../lib/translate'

export const ptPT: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Página',
  Selection: 'Seleção',
  Link: 'Ligação',
  // Saving one
  Save: 'Guardar',
  Saving: 'A guardar',
  Saved: 'Guardada',
  // Where it goes
  Space: 'Espaço',
  Folder: 'Pasta',
  // The account
  Account: 'Conta',
  'Sign out': 'Terminar sessão',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Idioma',
  'Match the system': 'Como o sistema',
  'Machine-translated. Corrections welcome.': 'Traduzido automaticamente. Agradecem-se correções.',
  Appearance: 'Aspeto',
  Light: 'Claro',
  Dark: 'Escuro',
  Shortcuts: 'Atalhos',
  Open: 'Abrir',
  // The interpreter, in the popup
  Template: 'Molde',
  Interpret: 'Interpretar',
  '{count} characters sent': {
    one: '{count} carácter enviado',
    many: '{count} caracteres enviados',
    other: '{count} caracteres enviados',
  },
  // And on the options page
  Interpreter: 'Interpretação',
  Off: 'Desligado',
  'Another server': 'Outro servidor',
  'Ollama is running here': 'O Ollama está a correr aqui',
  'Use it': 'Usar isso',
  Address: 'Endereço',
  'API key': 'Chave de API',
  Model: 'Modelo',
  Templates: 'Moldes',
  Reset: 'Restaurar',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'As chaves ficam neste navegador sem cifra: uma extensão não tem porta-chaves. Cada uma é enviada apenas ao seu fornecedor e a mais ninguém.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.': 'A linha {line} não diz nada que um molde diga.',
  'Line {line} names a property the clip writes itself.':
    'A linha {line} nomeia uma propriedade que o recorte escreve por si.',
  'The template on line {line} has no name.': 'O molde da linha {line} não tem nome.',
  'Line {line} repeats a name that is already there.':
    'A linha {line} repete um nome que já existe.',
  'There is no template in there.': 'Não há molde aí.',
  // Signing in
  'Email address': 'Endereço de e-mail',
  Continue: 'Continuar',
  Sending: 'A enviar',
  'Code sent to': 'Código enviado para',
  'Send a new code': 'Enviar um novo código',
  'Resend in {seconds}s': 'Reenviar em {seconds} s',
  'Digit {number}': 'Dígito {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Inicie sessão no nibeditor primeiro.',
  'Make a space in nibeditor first.': 'Crie um espaço no nibeditor primeiro.',
  'This page cannot be clipped.': 'Esta página não pode ser recortada.',
  'There is nothing to clip here.': 'Não há nada para recortar aqui.',
  'This clip is larger than a note can be.': 'Este recorte é maior do que uma nota pode ser.',
  'Your account is out of space.': 'A sua conta ficou sem espaço.',
  'Could not reach nibeditor.': 'Não foi possível contactar o nibeditor.',
  'Could not reach the provider.': 'Não foi possível contactar o fornecedor.',
  'The provider answered with something else.': 'O fornecedor respondeu outra coisa.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'esse endereço de e-mail não é válido',
  'that code is not right': 'esse código não está certo',
  'that code has expired - ask for a new one': 'esse código expirou - pedir um novo',
  'too many tries - ask for a new code': 'demasiadas tentativas - pedir um novo código',
  'sign in first': 'iniciar sessão primeiro',
  'no such space': 'não há esse espaço',
  'that path is not usable': 'esse caminho não serve',
  // A page as a task in the inbox
  'As a task': 'Como tarefa',
}

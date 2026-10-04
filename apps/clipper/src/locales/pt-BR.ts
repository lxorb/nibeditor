import type { Dictionary } from '../lib/translate'

export const ptBR: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Página',
  Selection: 'Seleção',
  Link: 'Link',
  // Saving one
  Save: 'Salvar',
  Saving: 'Salvando',
  Saved: 'Salvo',
  // Where it goes
  Space: 'Espaço',
  Folder: 'Pasta',
  // The account
  Account: 'Conta',
  'Sign out': 'Sair',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Idioma',
  'Match the system': 'Como o sistema',
  'Machine-translated. Corrections welcome.': 'Traduzido automaticamente. Correções bem-vindas.',
  Appearance: 'Aparência',
  Light: 'Claro',
  Dark: 'Escuro',
  Shortcuts: 'Atalhos',
  Open: 'Abrir',
  // The interpreter, in the popup
  Template: 'Gabarito',
  Interpret: 'Interpretar',
  '{count} characters sent': {
    one: '{count} caractere enviado',
    many: '{count} caracteres enviados',
    other: '{count} caracteres enviados',
  },
  // And on the options page
  Interpreter: 'Interpretação',
  Off: 'Desativado',
  'Another server': 'Outro servidor',
  'Ollama is running here': 'O Ollama está rodando aqui',
  'Use it': 'Usar isso',
  Address: 'Endereço',
  'API key': 'Chave de API',
  Model: 'Modelo',
  Templates: 'Gabaritos',
  Reset: 'Redefinir',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'As chaves ficam neste navegador sem criptografia: uma extensão não tem chaveiro. Cada uma é enviada só ao seu provedor e a mais ninguém.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'A linha {line} não diz nada que um gabarito diga.',
  'Line {line} names a property the clip writes itself.':
    'A linha {line} nomeia uma propriedade que o recorte escreve por conta própria.',
  'The template on line {line} has no name.': 'O gabarito da linha {line} não tem nome.',
  'Line {line} repeats a name that is already there.':
    'A linha {line} repete um nome que já existe.',
  'There is no template in there.': 'Não há gabarito aí.',
  // Signing in
  'Email address': 'Endereço de e-mail',
  Continue: 'Continuar',
  Sending: 'Enviando',
  'Code sent to': 'Código enviado para',
  'Send a new code': 'Enviar um novo código',
  'Resend in {seconds}s': 'Reenviar em {seconds} s',
  'Digit {number}': 'Dígito {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Entre no nibeditor primeiro.',
  'Make a space in nibeditor first.': 'Crie um espaço no nibeditor primeiro.',
  'This page cannot be clipped.': 'Esta página não pode ser recortada.',
  'There is nothing to clip here.': 'Não há nada para recortar aqui.',
  'This clip is larger than a note can be.': 'Este recorte é maior do que uma nota pode ser.',
  'Your account is out of space.': 'Sua conta ficou sem espaço.',
  'Could not reach nibeditor.': 'Não foi possível falar com o nibeditor.',
  'Could not reach the provider.': 'Não foi possível falar com o provedor.',
  'The provider answered with something else.': 'O provedor respondeu outra coisa.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'esse endereço de e-mail não é válido',
  'that code is not right': 'esse código não está certo',
  'that code has expired - ask for a new one': 'esse código expirou - pedir um novo',
  'too many tries - ask for a new code': 'tentativas demais - pedir um novo código',
  'sign in first': 'entrar primeiro',
  'no such space': 'não há esse espaço',
  'that path is not usable': 'esse caminho não serve',
  // A page as a task in the inbox
  'As a task': 'Como tarefa',
}

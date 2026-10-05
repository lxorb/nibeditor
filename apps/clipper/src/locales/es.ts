import type { Dictionary } from '../lib/translate'

export const es: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Página',
  Selection: 'Selección',
  Link: 'Enlace',
  // Saving one
  Save: 'Guardar',
  Saving: 'Guardando',
  Saved: 'Guardado',
  // Where it goes
  Space: 'Espacio',
  Folder: 'Carpeta',
  // The account
  Account: 'Cuenta',
  'Sign out': 'Cerrar sesión',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Idioma',
  'Match the system': 'Como el sistema',
  'Machine-translated. Corrections welcome.':
    'Traducido automáticamente. Correcciones bienvenidas.',
  Appearance: 'Aspecto',
  Light: 'Claro',
  Dark: 'Oscuro',
  Shortcuts: 'Atajos',
  Open: 'Abrir',
  // The interpreter, in the popup
  Template: 'Plantilla',
  Interpret: 'Interpretar',
  '{count} characters sent': {
    one: '{count} carácter enviado',
    many: '{count} caracteres enviados',
    other: '{count} caracteres enviados',
  },
  // And on the options page
  Interpreter: 'Interpretación',
  Off: 'Desactivado',
  'Another server': 'Otro servidor',
  'Ollama is running here': 'Ollama está en marcha aquí',
  'Use it': 'Usarlo',
  Address: 'Dirección',
  'API key': 'Clave de API',
  Model: 'Modelo',
  Templates: 'Plantillas',
  Reset: 'Restablecer',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Las claves quedan en este navegador sin cifrar: una extensión no tiene llavero. Cada una se envía solo a su proveedor y a nadie más.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'La línea {line} no dice nada que diga una plantilla.',
  'Line {line} names a property the clip writes itself.':
    'La línea {line} nombra una propiedad que el recorte escribe por su cuenta.',
  'The template on line {line} has no name.': 'La plantilla de la línea {line} no tiene nombre.',
  'Line {line} repeats a name that is already there.':
    'La línea {line} repite un nombre que ya está.',
  'There is no template in there.': 'Ahí no hay ninguna plantilla.',
  // Signing in
  'Email address': 'Dirección de correo',
  Continue: 'Continuar',
  Sending: 'Enviando',
  'Code sent to': 'Código enviado a',
  'Send a new code': 'Enviar un código nuevo',
  'Resend in {seconds}s': 'Reenviar en {seconds} s',
  'Digit {number}': 'Dígito {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Inicia sesión en nibeditor primero.',
  'Make a space in nibeditor first.': 'Crea un espacio en nibeditor primero.',
  'This page cannot be clipped.': 'Esta página no se puede recortar.',
  'There is nothing to clip here.': 'Aquí no hay nada que recortar.',
  'This clip is larger than a note can be.':
    'Este recorte es más grande de lo que puede ser una nota.',
  'Your account is out of space.': 'Tu cuenta se ha quedado sin espacio.',
  'Could not reach nibeditor.': 'No se pudo conectar con nibeditor.',
  'Could not reach the provider.': 'No se pudo conectar con el proveedor.',
  'The provider answered with something else.': 'El proveedor respondió otra cosa.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'esa dirección de correo no es válida',
  'that code is not right': 'ese código no es correcto',
  'that code has expired - ask for a new one': 'ese código ha caducado - pedir uno nuevo',
  'too many tries - ask for a new code': 'demasiados intentos - pedir un código nuevo',
  'sign in first': 'iniciar sesión primero',
  'no such space': 'no hay ese espacio',
  'that path is not usable': 'esa ruta no se puede usar',
  // A page as a task in the inbox
  'As a task': 'Como tarea',
}

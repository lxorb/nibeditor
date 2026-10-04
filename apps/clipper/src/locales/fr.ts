import type { Dictionary } from '../lib/translate'

export const fr: Dictionary = {
  // The three clips, in the order they are offered
  Page: 'Page',
  Selection: 'Sélection',
  Link: 'Lien',
  // Saving one
  Save: 'Enregistrer',
  Saving: 'Enregistrement',
  Saved: 'Enregistré',
  // Where it goes
  Space: 'Espace',
  Folder: 'Dossier',
  // The account
  Account: 'Compte',
  'Sign out': 'Se déconnecter',
  // The language, and what the row under it says about the catalogue on screen
  Language: 'Langue',
  'Match the system': 'Comme le système',
  'Machine-translated. Corrections welcome.': 'Traduit automatiquement. Corrections bienvenues.',
  Appearance: 'Apparence',
  Light: 'Clair',
  Dark: 'Sombre',
  Shortcuts: 'Raccourcis',
  Open: 'Ouvrir',
  // The interpreter, in the popup
  Template: 'Gabarit',
  Interpret: 'Interpréter',
  '{count} characters sent': {
    one: '{count} caractère envoyé',
    many: '{count} caractères envoyés',
    other: '{count} caractères envoyés',
  },
  // And on the options page
  Interpreter: 'Interprétation',
  Off: 'Désactivé',
  'Another server': 'Un autre serveur',
  'Ollama is running here': 'Ollama tourne ici',
  'Use it': 'Utiliser',
  Address: 'Adresse',
  'API key': 'Clé API',
  Model: 'Modèle',
  Templates: 'Gabarits',
  Reset: 'Réinitialiser',
  'Keys are kept in this browser and are not encrypted: an extension has no keychain. Each one is sent to its own provider and nowhere else.':
    'Les clés restent dans ce navigateur, sans chiffrement: une extension n’a pas de porte-clés. Chacune est envoyée à son propre fournisseur et nulle part ailleurs.',
  // A template that will not read, by the line it goes wrong on
  'Line {line} is not something a template says.':
    'La ligne {line} ne dit rien qu’un gabarit puisse dire.',
  'Line {line} names a property the clip writes itself.':
    'La ligne {line} nomme une propriété que la capture écrit elle-même.',
  'The template on line {line} has no name.': 'Le gabarit de la ligne {line} n’a pas de nom.',
  'Line {line} repeats a name that is already there.':
    'La ligne {line} répète un nom déjà présent.',
  'There is no template in there.': 'Il n’y a aucun gabarit là-dedans.',
  // Signing in
  'Email address': 'Adresse e-mail',
  Continue: 'Continuer',
  Sending: 'Envoi',
  'Code sent to': 'Code envoyé à',
  'Send a new code': 'Envoyer un nouveau code',
  'Resend in {seconds}s': 'Renvoyer dans {seconds} s',
  'Digit {number}': 'Chiffre {number}',
  // What can go wrong, as one sentence each; see ../lib/problems.ts
  'Sign in to nibeditor first.': 'Connectez-vous d’abord à nibeditor.',
  'Make a space in nibeditor first.': 'Créez d’abord un espace dans nibeditor.',
  'This page cannot be clipped.': 'Cette page ne peut pas être capturée.',
  'There is nothing to clip here.': 'Il n’y a rien à capturer ici.',
  'This clip is larger than a note can be.': 'Cette capture dépasse la taille maximale d’une note.',
  'Your account is out of space.': 'Votre compte n’a plus d’espace disponible.',
  'Could not reach nibeditor.': 'Impossible de joindre nibeditor.',
  'Could not reach the provider.': 'Impossible de joindre le fournisseur.',
  'The provider answered with something else.': 'Le fournisseur a répondu autre chose.',
  // And what the sync service itself answers with, looked up like any other string
  'enter a valid email address': 'Entrez une adresse e-mail valide',
  'that code is not right': 'Ce code n’est pas le bon',
  'that code has expired - ask for a new one': 'Ce code a expiré - demandez-en un nouveau',
  'too many tries - ask for a new code': 'Trop de tentatives - demandez un nouveau code',
  'sign in first': 'Connectez-vous d’abord',
  'no such space': 'Cet espace n’existe pas',
  'that path is not usable': 'Ce chemin n’est pas utilisable',
  // A page as a task in the inbox
  'As a task': 'En tâche',
}

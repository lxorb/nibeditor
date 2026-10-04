/** The global quick add window.
 *
 *  Its own entry, as the presenter's window is, so the window that has to open in a
 *  blink over another app carries the field and none of the app: no workspace, no
 *  editor, no session. See lib/quick-add/Window.svelte. */

import '@nib/themes'
import { mount } from 'svelte'
import { i18n } from './lib/i18n.svelte'
import Window from './lib/quick-add/Window.svelte'

const target = document.getElementById('app')
if (!target) throw new Error('quick-add.html has no #app to mount into')

i18n.restore()

export default mount(Window, { target })

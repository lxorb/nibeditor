/** Which tab asked for Delete browsing data, while its dialog is up: the dots' row,
 *  Ctrl+Shift+Delete, the History page's link and the palette all ask here, and the pane
 *  of that tab draws the dialog. See WebClear.svelte. */

class ClearingAsked {
  tab = $state<string | null>(null)

  ask(tab: string) {
    this.tab = tab
  }

  close() {
    this.tab = null
  }
}

export const clearingAsked = new ClearingAsked()

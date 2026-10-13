/** Text selection held off an element for the length of a drag, and given back
 *  after it.
 *
 *  Both spellings, because WebKit - a Mac's, an iPhone's - reads only the prefixed
 *  one, and `style.userSelect` is a property it does not have: set on its own, the
 *  write is dropped, and a divider dragged on a Mac selected the note behind it. */
export function unselectable(element: HTMLElement, held: boolean): void {
  for (const name of ['-webkit-user-select', 'user-select']) {
    if (held) element.style.setProperty(name, 'none')
    else element.style.removeProperty(name)
  }
}

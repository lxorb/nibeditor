/** No text selection for the length of a drag. Both spellings: a Mac's WebKit reads
 *  only the prefixed one and drops `style.userSelect`. */
export function unselectable(element: HTMLElement, held: boolean): void {
  for (const name of ['-webkit-user-select', 'user-select']) {
    if (held) element.style.setProperty(name, 'none')
    else element.style.removeProperty(name)
  }
}

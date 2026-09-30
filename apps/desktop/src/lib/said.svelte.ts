/** What just happened, said out loud, once.
 *
 *  Half of what this app tells somebody it tells with a colour: the gear in the
 *  panel's foot is lit while a pass is running and red when the last one failed,
 *  the dot on a tab is amber until the note is on the disk, and a warning about
 *  storage arrives as a card in the corner. None of that reaches a reader who is
 *  listening rather than looking, and two of the three had no words anywhere in
 *  the page at all.
 *
 *  A live region is how a page says something that was not asked for, and the one
 *  thing every account of them agrees on is that the region has to be **on the
 *  page before the words are**: a region that arrives carrying its own text is a
 *  region most screen readers never announce, because there was nothing there to
 *  watch. So the region is one element in `App.svelte` that is always there and
 *  usually empty, and this is what writes into it.
 *
 *  One region and not one per notice, for the reason everything else in this app
 *  is one of a kind: three of them would be three chances to say two things at
 *  once, and a reader cannot listen to two.
 *
 *  Polite, always. Nothing this app has to say is worth cutting somebody off in
 *  the middle of a sentence they are reading: an assertive region is for a fire,
 *  and a note that has not been written down yet is not one. */

/** How long the words stay in the region before it is emptied again.
 *
 *  Emptied at all, because the same thing happening twice - a second pass that
 *  fails the same way - has to be two announcements, and a region whose text did
 *  not change is a region that says nothing. Long enough that the words are read
 *  before they go, which for a phrase is about this. */
const HELD = 4000

class Said {
  /** What the region is carrying. Empty is its resting state. */
  words = $state('')

  private clearing: ReturnType<typeof setTimeout> | undefined

  /** What was last written into the region, as a plain field rather than as
   *  state - and that is the whole of why this class has two of them.
   *
   *  `say` is called from an `$effect`: the sync light, and whatever else
   *  becomes words in App.svelte. A reactive read inside an effect is a
   *  dependency, so reading `words` here made every caller an effect that depends
   *  on the very state this writes - and the empty-then-restore below, which is
   *  what makes a live region repeat itself, then wrote that dependency twice per
   *  call. Svelte ran the effect again, it said the same thing again, and a
   *  thousand rounds later the whole batch was abandoned with
   *  `effect_update_depth_exceeded`: the page is drawn and never updates again,
   *  so a menu does not open and a space cannot be chosen. This field answers the
   *  same question - is that already what the region says - without being
   *  something anybody can depend on. */
  private showing = ''

  /** Which call is the current one, so a restore a beat late cannot put an older
   *  sentence back over a newer one. */
  private turn = 0

  say(words: string): void {
    const asked = words.trim()
    if (!asked) return

    clearTimeout(this.clearing)
    const mine = ++this.turn

    // The same thing again is the region emptied first and the words put back a
    // beat later, which is the only way to make a live region repeat itself.
    if (asked === this.showing) {
      this.write('')
      queueMicrotask(() => {
        if (mine === this.turn) this.write(asked)
      })
    } else {
      this.write(asked)
    }

    this.clearing = setTimeout(() => {
      if (mine === this.turn) this.write('')
    }, HELD)
  }

  /** The one place the region's text changes, so the plain copy above can never
   *  drift from the state the page reads. */
  private write(words: string): void {
    this.showing = words
    this.words = words
  }
}

export const said = new Said()

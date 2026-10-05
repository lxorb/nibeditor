/** The whole window, drawn once before a file's tests start.
 *
 *  A file that mounts App pays for everything the window fetches the first time it is
 *  drawn - the panes, the editor, the bars - inside its first test. On a machine running
 *  three gates that was more than a test's thirty seconds, and a fixed number of turns
 *  after a mount then found one pane where two were coming. Drawn here, at the top of
 *  the file, the fetching is done before any test counts its time, and every test
 *  meets a window whose parts have already arrived.
 *
 *  `draw` mounts what the file's tests mount and hands back how to take it down; `ready`
 *  says when everything has arrived. */
export async function warmWindow(draw: () => () => void, ready: () => boolean): Promise<void> {
  const takeDown = draw()
  const until = Date.now() + 300_000
  while (!ready() && Date.now() < until) await new Promise((done) => setTimeout(done, 50))
  takeDown()
}

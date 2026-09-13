//! The control, and the one number that decides the architecture.
//!
//! This is the spike with no CEF linked into it at all: it starts, says the same
//! two lines `nib-spike-browser --no-browser` says, and exits. Compare the two and
//! the difference is what it costs a program merely to *link* Chromium - the
//! loader mapping a 200 MB library, resolving its imports and running its static
//! initialisers - before one line of the program's own code runs.
//!
//! That number is the whole argument about where the engine goes. If linking
//! Chromium costs a launch nothing measurable, the engine can live in nib's own
//! process and the app can simply be a Chromium app. If it costs a hundred
//! milliseconds on every launch, then somebody who never opens a web tab is paying
//! for one, and the engine belongs in a process that only starts when a web tab
//! does. See docs/browser.md.

fn main() {
    let start = std::time::Instant::now();
    // The same two event names the other binary prints, so one harness reads both.
    println!(
        "{{\"at\":{},\"event\":\"window-shown\"}}",
        start.elapsed().as_millis()
    );
    println!(
        "{{\"at\":{},\"event\":\"no-browser\"}}",
        start.elapsed().as_millis()
    );
    println!(
        "{{\"at\":{},\"event\":\"check\",\"name\":\"a binary with no Chromium in it starts\",\"ok\":true,\"note\":\"the control\"}}",
        start.elapsed().as_millis()
    );
}

//! The subprocess, and nothing else.
//!
//! Chromium is several processes and one of them is this one, started again and
//! again with a `--type=` telling it what to be: a renderer, the GPU, the network
//! service, a utility. On Windows and Linux the browser binary can be its own
//! subprocess; macOS cannot, because a process in the Dock and a process that is a
//! background worker are different kinds of bundle, so CEF wants a second
//! executable inside four helper bundles. Shipping the same second executable on
//! all three is one fewer difference between the platforms, and it is what
//! `bundle-cef-app` expects.
//!
//! It must do nothing before `execute_process`. A subprocess that allocates, reads
//! an environment variable or starts a thread first is a subprocess that has
//! already lost: on macOS loading the framework replaces the process's malloc
//! zone, and anything allocated on another thread while that happens corrupts the
//! heap.

fn main() {
    let _library = nib_spike_browser::load_cef_helper();

    let args = cef::args::Args::new();
    let code = cef::execute_process(Some(args.as_main_args()), None, std::ptr::null_mut());
    std::process::exit(if code >= 0 { code } else { 0 });
}

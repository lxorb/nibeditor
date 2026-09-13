//! The browser process, and on Windows and Linux every subprocess of it too.
//!
//! No `windows_subsystem = "windows"`: the harness reads this program's stdout,
//! and a Windows GUI subsystem binary has none.

fn main() -> Result<(), &'static str> {
    let _library = nib_spike_browser::load_cef();

    let args = cef::args::Args::new();
    let Some(command_line) = args.as_cmd_line() else {
        return Err("the command line would not parse");
    };

    let code = nib_spike_browser::run(args.as_main_args(), &command_line, std::ptr::null_mut());
    std::process::exit(code);
}

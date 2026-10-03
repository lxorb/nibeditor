//! Nib, on a desktop and on a phone: the plugins it runs with, the commands the
//! window may call, and the window itself.
//!
//! Every command lives in the module that owns the thing it touches - `notes`,
//! `spaces`, `trash` and so on - and every path a command is given is judged by
//! `paths` before anything on disk is touched.
//!
//! A phone has no second window, no installer, no file dialog and no shell, so
//! the modules that are only about those are `#[cfg(desktop)]` and their commands
//! reach the handler only there. Everything about notes is the same on both: the
//! same folder under the documents directory, read and written by the same
//! commands.
//!
//! One rule about every command that waits for the disk: it says `async`.
//!
//! `#[tauri::command]` on a function that is not itself async runs the body *on
//! the main thread*, inside the webview's own request handler. On Windows that is
//! the thread with the message loop on it, so a command that reads a folder full
//! of notes stops the window repainting, stops it answering the mouse, and stops
//! the webview loading anything else for as long as the read takes - the app looks
//! wedged, and the wait is the disk's. `#[tauri::command(async)]` on the same
//! synchronous function runs it on a thread of the runtime's instead and answers
//! the window when it is done, which is the same command with the freeze taken
//! out. So everything that touches a file, walks a folder, starts a subprocess or
//! asks the machine's keychain says it.
//!
//! Four kinds of command deliberately do not. The ones that only read state this
//! builder manages, which is a mutex and no wait at all. `write_log`, whose lines
//! have to leave in the order they were written and would not if two could be in
//! the air at once; it hands each to the log's own thread, which is the one that
//! waits. The two that reach Windows through COM or the registry, since
//! an apartment belongs to the thread that made it. And `new_window`, which builds
//! a window.

#[cfg(desktop)]
mod agents;
// What a launch reads first, read while the webview starts; see ahead.rs.
#[cfg(desktop)]
mod ahead;
// Claude Code and Codex, run headless on this machine with the reader's own plan; see
// ai_cli.rs and docs/ai.md.
#[cfg(desktop)]
mod ai_cli;
// A ChatGPT plan through Sign in with ChatGPT; see chatgpt.rs and docs/ai.md.
#[cfg(desktop)]
mod appearance;
#[cfg(desktop)]
mod apple_notes;
#[cfg(desktop)]
mod chatgpt;
// Where the database holding the notes is, that is a Mac: SQLite, a group
// container and a permission no other system has, all of which is `apple_notes`.
// What is *on* a row is a gzipped protobuf, and unpacking one is arithmetic over
// bytes - so it is built everywhere, and every runner compiles and tests it. A
// thousand lines only one runner checked is a thousand lines nothing checked.
#[cfg_attr(
    not(target_os = "macos"),
    allow(
        dead_code,
        reason = "only the Mac's own store reader asks for any of this; it is built elsewhere to be checked, not to be called"
    )
)]
mod apple_text;
mod assets;
mod carry;
mod clock;
#[cfg(desktop)]
mod default_browser;
#[cfg(desktop)]
mod document_window;
#[cfg(desktop)]
mod downloads;
#[cfg(desktop)]
mod endpoint;
#[cfg(desktop)]
mod engine;
#[cfg(desktop)]
mod engine_switch;
#[cfg(desktop)]
mod extensions;
#[cfg(desktop)]
mod foreground;
mod front_matter;
mod fuzzy;
#[cfg(desktop)]
mod ground;
mod highlights;
mod history;
#[cfg(desktop)]
mod keyboard;
mod lane;
#[cfg(desktop)]
mod launch;
#[cfg(desktop)]
mod lifecycle;
#[cfg(target_os = "macos")]
mod lights;
mod links;
mod logs;
mod matcher;
// `nib mcp`, the server an agent's client runs; main.rs hands it the process before
// anything below starts.
#[cfg(desktop)]
pub mod mcp;
#[cfg(desktop)]
mod menu_bar;
mod notes;
#[cfg(desktop)]
mod pandoc;
mod papers;
mod paths;
#[cfg(desktop)]
mod pdf;
#[cfg(desktop)]
mod placement;
#[cfg(desktop)]
mod presence;
mod query;
mod regex;
mod search;
#[cfg(any(desktop, target_os = "ios"))]
mod secrets;
#[cfg(desktop)]
mod shell_menu;
mod space_watch;
mod spaces;
mod sync_store;
mod tags;
mod tasks;
#[cfg(desktop)]
mod terminal;
mod themes;
mod trace;
mod trash;
mod tree;
#[cfg(desktop)]
mod updates;
mod uris;
// Only where there is a cookie store to reach: the system's own engine on Windows and
// on a Mac.
#[cfg(all(any(windows, target_os = "macos"), not(feature = "cef")))]
mod web_cookies;
#[cfg(desktop)]
mod web_cut;
#[cfg(desktop)]
mod web_dialogs;
#[cfg(desktop)]
mod web_find;
#[cfg(desktop)]
mod web_follow;
#[cfg(desktop)]
mod web_handed;
#[cfg(desktop)]
mod web_icons;
#[cfg(desktop)]
mod web_keys;
#[cfg(desktop)]
mod web_opens;
#[cfg(desktop)]
mod web_page;
#[cfg(desktop)]
mod web_pause;
#[cfg(desktop)]
mod web_reload;
#[cfg(desktop)]
mod web_state;
#[cfg(desktop)]
mod web_stores;
#[cfg(desktop)]
mod web_tabs;
// Only where a page's input window is a window of another process: the system's own
// engine on Windows.
#[cfg(all(windows, not(feature = "cef")))]
mod web_wheel;
#[cfg(desktop)]
mod web_worlds;

use paths::Picked;
use tauri::Manager;

/// The commands the window may call, as one list. A builder takes a single
/// handler, so the desktop-only ones are passed in here rather than added
/// afterwards, and the names both builds share are written once.
macro_rules! commands {
    ($($desktop:tt)*) => {
        tauri::generate_handler![
            notes::read_note,
            notes::write_note,
            notes::write_bytes,
            notes::delete_note,
            notes::rename_note,
            notes::copy_path,
            notes::create_folder,
            notes::delete_folder,
            notes::remove_empty_folder,
            notes::file_stamp,
            tree::read_tree,
            assets::read_asset,
            assets::read_file,
            assets::save_asset,
            highlights::read_highlights,
            highlights::write_highlights,
            papers::read_paper_text,
            papers::write_paper_text,
            papers::list_paper_texts,
            search::search_space,
            search::space_tags,
            search::warm_search,
            links::scan_links,
            themes::theme_dir,
            themes::list_themes,
            themes::read_theme,
            themes::write_theme,
            themes::remove_theme,
            themes::custom_css_path,
            themes::read_custom_css,
            themes::snippets_path,
            themes::read_snippets,
            themes::scratchpad_path,
            history::snapshot_note,
            history::list_snapshots,
            history::read_snapshot,
            history::purge_snapshots,
            history::rehome_snapshots,
            logs::log_dir,
            logs::write_log,
            logs::read_log,
            spaces::spaces_root,
            spaces::list_spaces,
            spaces::create_space,
            spaces::rename_space,
            spaces::delete_space,
            trash::trash_item,
            trash::trash_words,
            trash::list_trash,
            trash::restore_trash,
            trash::purge_trash,
            trash::purge_trash_older_than,
            uris::take_startup_uris,
            trace::trace_startup,
            sync_store::sync_store_open,
            sync_store::sync_store_close,
            sync_store::sync_store_read,
            sync_store::sync_store_write,
            sync_store::sync_store_clean_exit,
            sync_store::sync_store_forget,
            space_watch::space_watch,
            space_watch::space_unwatch,
            space_watch::space_scan,
            space_watch::file_identity,
            $($desktop)*
        ]
    };
}

/// The desktop's own commands, with the ones both builds share: a list of its own
/// rather than a block inside `run_on`, which is about the order a launch happens in.
#[cfg(desktop)]
macro_rules! desktop_commands {
    () => {
        commands![
            endpoint::automation_result,
            agents::grants::agents_read,
            agents::grants::agents_write,
            agents::grants::agents_mint,
            agents::agents_stop,
            agents::agents_resume,
            agents::agents_answer,
            agents::agents_ask,
            agents::agents_state,
            agents::agents_log,
            agents::agents_log_days,
            agents::agents_log_clear,
            agents::agents_adopt,
            agents::agents_capture,
            agents::agents_test_reader_focus,
            agents::agents_pause,
            agents::watch::agents_watch,
            agents::shell::agents_shell,
            agents::shell::agents_hold,
            mcp::program::mcp_program,
            ai_cli::ai_cli_status,
            ai_cli::ai_cli_ask,
            ai_cli::ai_cli_stop,
            chatgpt::chatgpt_sign_in,
            chatgpt::chatgpt_account,
            chatgpt::chatgpt_token,
            chatgpt::chatgpt_sign_out,
            appearance::set_frame,
            appearance::set_translucency,
            ground::remember_ground,
            apple_notes::read_apple_notes,
            apple_notes::open_full_disk_access,
            launch::take_startup_pages,
            launch::new_window,
            launch::show_window,
            ahead::launch_ahead,
            ahead::remember_launch,
            default_browser::default_browser,
            default_browser::make_default_browser,
            engine_switch::engine_state,
            engine_switch::engine_choose,
            engine_switch::engine_relaunch,
            engine_switch::fetch::engine_fetch,
            engine_switch::fetch::engine_cancel,
            lifecycle::keep_running,
            document_window::show_document,
            menu_bar::hand_to_keyboard,
            placement::take_keyboard,
            placement::raise_window,
            pandoc::has_pandoc,
            pandoc::run_pandoc,
            pandoc::import_document,
            pdf::pdf_supported,
            pdf::print_pdf,
            pdf::print_page,
            secrets::secret_forget,
            secrets::secret_read,
            secrets::secret_write,
            shell_menu::new_menu_registered,
            shell_menu::set_new_menu,
            terminal::terminal_shells,
            terminal::pty_spawn,
            terminal::pty_write,
            terminal::pty_resize,
            terminal::pty_seen,
            terminal::pty_busy,
            terminal::pty_folder,
            terminal::pty_kill,
            terminal::history::terminal_history_read,
            terminal::history::terminal_history_write,
            terminal::history::terminal_history_forget,
            updates::check_update,
            web_tabs::web_open,
            // Chrome and Edge extensions in web tabs; see extensions.rs.
            extensions::extensions_list,
            extensions::extensions_install,
            extensions::extensions_set,
            extensions::extensions_remove,
            extensions::extensions_update,
            extensions::extensions_page,
            extensions::extensions_named,
            extensions::popup::extension_popup_open,
            extensions::popup::extension_popup_place,
            extensions::popup::extension_popup_close,
            web_tabs::web_place,
            keyboard::keyboard_watch,
            keyboard::keyboard_here,
            keyboard::keyboard_went,
            keyboard::keyboard_back,
            web_tabs::web_navigate,
            web_tabs::web_step,
            web_tabs::web_trail,
            web_tabs::web_clip,
            web_tabs::web_close,
            web_tabs::web_look,
            web_tabs::web_scroll,
            web_tabs::web_zoom,
            web_tabs::web_print,
            web_tabs::web_devtools,
            web_page::web_mute,
            web_page::web_unfill,
            web_pause::web_pause,
            web_find::web_find,
            web_find::web_find_stop,
            web_tabs::web_shot,
            web_tabs::web_answer,
            web_dialogs::web_dialog_answer,
            downloads::web_downloads,
            downloads::web_download_open,
            downloads::web_download_show,
            downloads::web_download_cancel,
            // A web login carried between computers; see web_state.rs.
            web_state::web_state_capture,
            web_state::web_state_restore,
            web_state::web_state_session,
            web_state::web_state_inbox,
            web_state::web_state_wants,
            web_state::web_state_file,
            web_state::web_state_put,
            web_state::web_key_device,
            web_state::web_key_digits,
            web_state::web_key_wrap,
            web_state::web_key_accept,
            web_state::web_key_rotate,
            web_state::web_key_current,
            web_state::web_key_lease,
            web_state::web_key_forget,
            // Whether somebody is at this computer, and what it is called; see
            // presence.rs.
            presence::input_idle,
            presence::device_name,
            agents::leases::web_lease_elsewhere,
        ]
    };
}

/// How a phone starts the app. The attribute writes the symbol the Android and
/// iOS projects load the library through, which a desktop does not have: there
/// the binary beside this library calls `run` itself.
///
/// In a module of its own so that the one item the macro writes without a doc
/// comment is excepted here rather than crate-wide. Everything of ours is still
/// documented, and the desktop builds hold the whole crate to that.
#[cfg(mobile)]
#[allow(
    missing_docs,
    reason = "the entry point is written by a macro, which cannot document it"
)]
mod entry {
    #[tauri::mobile_entry_point]
    fn start() {
        super::run();
    }
}

/// Which runtime every type in this crate is written against.
///
/// On the app that ships it is Tauri's own `Wry`, compiled in, and a bare
/// `AppHandle` or `Webview` means that - which is why nothing else in the crate
/// names a runtime at all. On nib's own Chromium the engine is chosen by the binary
/// rather than compiled in, so the type is Tauri's type-erased one and a bare
/// `AppHandle` means that instead. Every other signature in the crate is unchanged
/// either way, which is what makes one seam enough; see src/engine.rs.
#[cfg(not(feature = "cef"))]
pub type Engine = tauri::Wry;

/// Which runtime every type in this crate is written against: the type-erased one,
/// because the engine arrives from the binary. See above.
#[cfg(feature = "cef")]
pub type Engine = tauri::DynRuntime;

/// Starts the app on the engine this build ships with: the system's own, which is
/// what `tauri::Builder::default` gives - `WebView2` on Windows, `WKWebView` on a
/// Mac, `WebKitGTK` on Linux. Returns when the last window has closed.
pub fn run() {
    run_on(tauri::Builder::default());
}

/// Starts the app on an engine the binary chose, and exits with a message if the app
/// could not be built at all.
///
/// One seam, for one reason: `apps/desktop/src-tauri/cef` is a binary that links
/// Chromium through `tauri-runtime-cef` and hands the engine in here already
/// configured, so nib's own interface and every web tab are views in one browser
/// process. The engine is never named in this crate, which is what keeps three
/// hundred megabytes of Chromium out of the default build's dependency graph
/// entirely. See src/engine.rs and docs/browser.md.
pub fn run_on(builder: tauri::Builder<Engine>) {
    // Before the trace, because the gate's clock is the process's and a measurement
    // that starts late is a measurement that flatters. Nothing at all in the default
    // build: the module is behind the `cef` feature.
    #[cfg(feature = "cef")]
    engine::gate::begin();

    // First, so that the one step nothing inside the process can time - the
    // machine loading the binary before any of this ran - is on the trace as well;
    // see trace.rs. Off unless NIB_TRACE_STARTUP says otherwise.
    trace::begin();

    // A probe's process is held out of the foreground before anything in it can make a
    // window or start an engine; see foreground.rs. And said, so a drive knows which of
    // its probes started able to take the front.
    #[cfg(desktop)]
    if foreground::hold() {
        eprintln!(
            "nib: this probe started able to take the foreground; it is locked (see src-tauri/src/foreground.rs)"
        );
    }

    #[cfg_attr(
        not(desktop),
        allow(
            unused_mut,
            reason = "a phone has no window in the config to take out of it"
        )
    )]
    #[cfg(not(feature = "cef"))]
    let mut context = tauri::generate_context!();
    // The engine build compiles this file from a package of its own one folder down,
    // and the config it is built from is the app's; see cef/Cargo.toml.
    #[cfg(feature = "cef")]
    let mut context = tauri::generate_context!("../tauri.conf.json");

    // Which engine this launch belongs to, before anything of either engine starts: the
    // other build takes the launch over where it is the one chosen. See engine_switch.rs.
    #[cfg(desktop)]
    if engine_switch::handed_over(
        &context.config().identifier,
        &context.package_info().version.to_string(),
    ) {
        return;
    }
    #[cfg(desktop)]
    trace::mark("engine chosen");

    // A second launch belongs to the window that is already open: it raises it
    // and hands over whatever page it was asked to open. A phone launches an app
    // once, has no installer to run and no dialog to pick a file in.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(
            launch::second_launch_heard,
        ))
        .manage(launch::Pending::default());
    // Where the app is on its way out, and on a Mac where the window was; see
    // lifecycle.rs.
    #[cfg(desktop)]
    let builder = lifecycle::managed(builder);
    // What fetching nib's own Chromium keeps while it runs; see engine_switch.rs.
    #[cfg(desktop)]
    let builder = engine_switch::managed(builder);
    #[cfg(desktop)]
    trace::mark("plugins: updater, dialog, process, one instance");

    // The opener is how a link leaves the app anywhere, and the os plugin is how
    // the window knows which build it is running as.
    //
    // Without the script the opener puts in every webview by default, a web tab's
    // included. That script takes a Ctrl+click, a Shift+click and a `target="_blank"`
    // link away from the page and asks the opener to hand the link to the system
    // browser, which a site is never granted: so in a web tab those presses did
    // nothing at all, the commonest link on the web among them. Emil, 2026-09-30:
    // *"Ctrl + click to open a new web page doesn't work."* A page's links open the
    // way a browser opens them, and the engine asks this app for the window; see
    // web_opens.rs. The app's own links are pressed through its own code, and each
    // one says where it goes; see open-link.ts.
    //
    // Deep links come after single instance above, which is the order that plugin
    // asks for: on Windows and Linux a `nib://` link reaching an app that is
    // already open arrives as a second launch, and single instance is what hands
    // it over to be read as a link. See uris.rs.
    let builder = builder
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(Picked::default())
        .manage(uris::Pending::default());
    trace::mark("plugins: opener, os, deep link");

    // Sync's store and the watch on the space folders: two empty slots, filled when the
    // engine first asks, which is after the first paint. See sync_store.rs and
    // space_watch.rs.
    let builder = builder
        .manage(sync_store::Stores::default())
        .manage(space_watch::Watching::default());

    // What the `nib` command's requests wait in while the window answers them.
    // Managed here rather than where the socket opens, because a builder is the
    // one place state can be added; see endpoint.rs.
    #[cfg(desktop)]
    let builder = builder.manage(endpoint::Waiting::default());

    // Which page each web tab is on, so a back arrow is lit only where there is
    // something behind it, and a window with web tabs in it held, as it closes, until
    // their logins are made to last. A phone has no child webviews to keep a trail
    // for; see web_tabs.rs and docs/web-tabs.md. And where each window is, written
    // down as it closes so the next launch opens there; see placement.rs.
    #[cfg(desktop)]
    let builder = placement::managed(web_tabs::managed(builder));

    // The shells terminal tabs run, and the page load that lets go of a page's own; see
    // terminal.rs.
    #[cfg(desktop)]
    let builder = terminal::managed(builder);

    // The questions Claude Code and Codex are answering, and the ChatGPT plan's access
    // token of the hour; see ai_cli.rs and chatgpt.rs.
    #[cfg(desktop)]
    let builder = builder
        .manage(ai_cli::Asks::default())
        .manage(chatgpt::ChatGpt::default());

    #[cfg(desktop)]
    let builder = builder.invoke_handler(desktop_commands!());

    // An iPhone keeps a provider's key in its keychain the way a Mac does; Android keeps
    // it through the activity, so its page never calls these. See secrets.rs.
    #[cfg(target_os = "ios")]
    let builder = builder.invoke_handler(commands![
        secrets::secret_forget,
        secrets::secret_read,
        secrets::secret_write,
    ]);
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(commands![]);
    trace::mark("commands registered");

    // The window is taken out of the config on every desktop, and built by `ready`
    // instead. Two reasons, one per engine, and the config still says what the window
    // looks like either way; see engine.rs.
    //
    // On nib's own Chromium, because the interface needs a profile of its own and a
    // profile is asked for when a webview is built. On the system's, because a window
    // the runtime builds is built around its webview - so there is nothing on screen
    // until the webview runtime has started, which on Windows is between a third and
    // half of a launch with the screen empty for all of it. Built here, the window is up
    // in about twenty milliseconds and the webview starts behind it. See ground.rs.
    #[cfg(desktop)]
    let ui = engine::take_ui_window(&mut context);

    #[cfg(desktop)]
    let builder = builder.setup(move |app| {
        #[cfg(feature = "cef")]
        engine::gate::say("\"event\":\"cef-initialised\"");
        ready(app, ui.as_ref())
    });
    #[cfg(not(desktop))]
    let builder = builder.setup(|app| ready(app, None));

    builder
        .build(context)
        .unwrap_or_else(|error| {
            eprintln!("Nib could not start: {error}");
            std::process::exit(1);
        })
        .run(on_event);
}

/// What the system asks of the app as a whole, rather than of a window: a link
/// from another program, the Dock icon clicked, a quit. See lifecycle.rs; a phone has
/// none of the three.
fn on_event(app: &tauri::AppHandle<Engine>, event: tauri::RunEvent) {
    #[cfg(desktop)]
    lifecycle::on_event(app, event);
    #[cfg(not(desktop))]
    let _ = (app, event);
}

/// Everything that has to happen once, after the app is built and before the
/// window is seen: what the webview may load, what the app was launched with, and
/// then showing the window that was built hidden.
fn ready(
    app: &mut tauri::App,
    ui: Option<&tauri::utils::config::WindowConfig>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Everything between the last mark and this one is Tauri's own: the context,
    // the window and - on Windows, where it is most of a launch - the webview
    // runtime being started and pointed at the page.
    trace::mark("app built, window created");

    let handle = app.handle();

    // What the page will ask for first, read on a thread of its own from here, while
    // the webview below starts; see ahead.rs.
    #[cfg(desktop)]
    ahead::start(handle);

    // Before the page can put its menu strip up; see menu_bar.rs.
    #[cfg(target_os = "macos")]
    menu_bar::leave_out_system_rows();

    // A picture in a note is loaded by the webview itself, over the asset
    // protocol, which has a scope of its own. The spaces folder is in it from the
    // start, and the only other thing that ever is: a file the reader picked in the
    // system's own dialog, which the dialog adds. Heard from here on, so what an
    // export was pointed at may be written; see `Picked` in paths.rs.
    if let Ok(root) = paths::spaces_dir(handle) {
        let _ = handle.asset_protocol_scope().allow_directory(&root, true);
    }
    paths::hear_picks(handle);
    trace::mark("asset scope");

    // Links into the app, on every platform: the one the app was launched by, and
    // every one that arrives while it is running.
    uris::watch(handle);
    trace::mark("deep links");

    // And the socket the `nib` command drives the app through, which only a
    // desktop has. It comes up after the links above and a millisecond or two before
    // the window below, which is as close to "there is a window to ask" as the order
    // can be: the socket has to be listening early enough that a second launch and a
    // waiting script find it, and the window is the last thing this function does.
    #[cfg(desktop)]
    endpoint::start(handle);
    #[cfg(desktop)]
    trace::mark("automation endpoint");

    // A command line is a desktop's way of being handed a link, when nib is the
    // browser; never a note, since nib opens nothing from outside its spaces (see
    // launch.rs). A phone app is launched by tapping it, and there is nothing in
    // `args` worth reading.
    //
    // Added to, not replaced: on a Mac a link the system opened the app with may
    // already be waiting there; see lifecycle.rs. And the trace says which kind of
    // launch this was, because a link's is measured from the click to the page.
    #[cfg(desktop)]
    {
        let args: Vec<String> = std::env::args().collect();
        if let Some(pending) = handle.try_state::<launch::Pending>() {
            pending.hold(launch::Handed::Pages, launch::handed_by(&args));
        }
        trace::mark(if web_handed::for_a_link(&args) {
            "launch arguments, a link's"
        } else {
            "launch arguments"
        });
    }
    #[cfg(not(desktop))]
    trace::mark("launch arguments");

    // What the window's own page may be given: the microphone the moment somebody
    // presses Record, and nothing else. Before the window is shown, because a page that
    // asked before anything was listening waits for ever; see `hearing` in web_tabs.rs.
    #[cfg(desktop)]
    web_tabs::hearing(handle);
    // The browser's own chords in a web tab's page, which nib's own Chromium keeps from the
    // page and the app alike; see web_keys.rs.
    #[cfg(all(windows, feature = "cef"))]
    web_keys::chromium::start(handle);

    // And the window on screen, which is the last thing this does and the first thing
    // anybody sees. Everything above it costs under two milliseconds together and has to
    // be in place first: the microphone above all, because a page that asked before
    // anything was listening waits for ever.
    //
    // Built here rather than by the runtime, and opened in the colour it was last seen
    // in, which is what lets it be on screen before there is anything in it: the webview
    // runtime starts behind a window somebody can already see. A machine with no colour
    // remembered yet, and a reader whose ground is the platform's own material rather
    // than a colour, get what they always got - built hidden, shown once the webview is
    // there. See ground.rs, which says why that is right rather than merely careful.
    //
    // The window, not the webview window; see web_tabs.rs.
    //
    // Where it was left, too, put into the config rather than applied afterwards, so the
    // first frame is already in the right place; see placement.rs.
    #[cfg(desktop)]
    if let Some(config) = ui {
        let config = placement::restored(handle, config);
        trace::mark("window placement");
        // What the engine needs of the window - its developer tools, its switches, its
        // profile - is the engine's; see `engine::ui_window`.
        let building = engine::ui_window(app, &config)?;
        // A window sent somewhere of its own - a probe off the screen - is built hidden,
        // put there, and shown without coming forward; see `built_away` in placement.rs.
        // A place that was only remembered is in the config and needs none of that.
        //
        // Otherwise on screen at once, in the colour it was last seen in, except on a
        // Mac, where it is built hidden so its traffic lights are placed before anything
        // is drawn (see lights.rs). A Mac's webview starts in fourteen milliseconds, not
        // in the third of a second Windows needs, which is what showing it at once is for.
        //
        // And standing on the platform's material from the first frame where the page
        // last stood on it, which is the glass theme: see `wear_from_the_start`.
        let see_through = ground::see_through(handle);
        if let Some(at) = placement::away() {
            let window = placement::built_away(building, at)?;
            if see_through {
                appearance::wear_from_the_start(&window.as_ref().window());
            }
        } else {
            let colour = ground::remembered(handle);
            let at_once = colour.is_some() && !cfg!(target_os = "macos");
            let building = match colour {
                Some(colour) => building.background_color(colour),
                None => building,
            };
            let window = building.visible(at_once).build()?;
            if see_through {
                appearance::wear_from_the_start(&window.as_ref().window());
            }
            if !at_once {
                #[cfg(target_os = "macos")]
                lights::hold(&window);
                window.show()?;
            }
        }
    }

    // A phone's window is the activity's.
    #[cfg(not(desktop))]
    {
        let _ = ui;
        if let Some(window) = app.get_window("main") {
            window.show()?;
        }
    }

    // From here a link that finds no window at all is one that has to open one.
    #[cfg(desktop)]
    if let Some(pending) = handle.try_state::<launch::Pending>() {
        pending.launched();
    }

    trace::mark("window shown");
    // nib's own Chromium got as far as its window, so the next launch hands over to it
    // again; see engine_switch.rs.
    #[cfg(desktop)]
    engine_switch::window_shown(handle);
    // Written here as well as when the window reports in, so a launch that never
    // gets as far as a window still leaves behind what it did get through.
    trace::write(handle);

    // Nib listed among the browsers, put back if a portable copy moved or an install
    // never wrote it: after the window, on a thread of its own; see default_browser.rs.
    #[cfg(desktop)]
    default_browser::keep_registered(handle);

    // And, on a build that is being measured rather than used, the gate: it opens a
    // web tab and the engine's own pages, says what each cost and quits. Off unless
    // NIB_CEF_GATE says otherwise, and not in the default build at all.
    #[cfg(feature = "cef")]
    {
        engine::gate::say("\"event\":\"window-shown\"");
        engine::gate::start(handle);
    }

    Ok(())
}

/// The app's own folder, `src-tauri`, for a test that reads a file beside the crate.
///
/// Not always the manifest's folder: the engine build compiles this library from a
/// package one folder down (cef/Cargo.toml), and its tests read the same files.
#[cfg(test)]
pub(crate) fn app_dir() -> std::path::PathBuf {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    if cfg!(feature = "cef") {
        manifest.join("..")
    } else {
        manifest.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};
    use std::fs;

    /// The commands that run on the thread that called them although they reach a
    /// file, a subprocess or the registry, and the reason each may. The note at the
    /// top of this file is where they are explained; this is that list, held to.
    ///
    /// `write_log` hands its lines on in the order they were written, which two of
    /// them in the air at once would not; the disk is its own thread's, and this
    /// reader follows a call into a closure without knowing it runs on another
    /// thread. The other two reach Windows through the
    /// registry, and a key is opened and closed inside one call.
    const EXCEPTED: [&str; 3] = ["write_log", "new_menu_registered", "set_new_menu"];

    /// What a body that waits says itself, whichever module it is in: the
    /// filesystem, a subprocess, the machine's own keychain, and the system's shell,
    /// which opens a file or shows it in its folder in its own time - the opener's own
    /// commands are `async` for that reason.
    const WAITS: [&str; 9] = [
        "fs::",
        "File::",
        "OpenOptions",
        "Command::new",
        "get_password",
        "set_password",
        "delete_credential",
        "canonicalize",
        "tauri_plugin_opener::",
    ];

    /// One function of the crate: the name it is called by, and the body it runs.
    struct Function {
        name: String,
        body: String,
    }

    /// Every function in one module, however deeply it is nested, by where the
    /// signature is indented: rustfmt closes a body at the column its `fn` began at.
    fn functions(source: &str) -> Vec<Function> {
        let mut found = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (at, line) in lines.iter().enumerate() {
            let Some((indent, name)) = signature(line) else {
                continue;
            };

            let closes = format!("{}}}", " ".repeat(indent));
            let body = lines[at + 1..]
                .iter()
                .take_while(|held| **held != closes)
                .fold(String::new(), |mut body, held| {
                    body.push_str(held);
                    body.push('\n');
                    body
                });

            found.push(Function { name, body });
        }

        found
    }

    /// How far a signature is indented and what it names, or nothing where the line
    /// is not one.
    fn signature(line: &str) -> Option<(usize, String)> {
        let indent = line.len() - line.trim_start().len();
        let mut rest = line.trim_start();
        for said in ["pub(crate) ", "pub ", "async "] {
            rest = rest.strip_prefix(said).unwrap_or(rest);
        }

        let name = rest
            .strip_prefix("fn ")?
            .split(['(', '<'])
            .next()?
            .to_owned();
        Some((indent, name))
    }

    /// Every name a body calls. A name after a dot is a method on something else and
    /// not one of ours, and so is one after a type's path: `DispatchQueue::main()` is
    /// the queue's, and not the `main` that runs the app.
    fn calls(body: &str) -> HashSet<String> {
        let mut found = HashSet::new();
        let letters: Vec<char> = body.chars().collect();
        let mut at = 0;

        while at < letters.len() {
            if !letters[at].is_alphanumeric() && letters[at] != '_' {
                at += 1;
                continue;
            }

            let from = at;
            while at < letters.len() && (letters[at].is_alphanumeric() || letters[at] == '_') {
                at += 1;
            }

            let after_a_dot = from > 0 && letters[from - 1] == '.';
            if !after_a_dot && !after_a_type(&letters, from) && letters.get(at) == Some(&'(') {
                found.insert(letters[from..at].iter().collect());
            }
        }

        found
    }

    /// Whether the name starting at `from` follows `Type::`, a path whose last part is
    /// written with a capital, which is how a type is written and a module is not.
    fn after_a_type(letters: &[char], from: usize) -> bool {
        if from < 2 || letters[from - 1] != ':' || letters[from - 2] != ':' {
            return false;
        }

        let mut start = from - 2;
        while start > 0 && (letters[start - 1].is_alphanumeric() || letters[start - 1] == '_') {
            start -= 1;
        }
        letters[start].is_uppercase()
    }

    /// Every function that waits, by name: the ones that say so themselves, and then
    /// every one that calls one of those, to the end of the chain.
    fn waiting(functions: &[Function]) -> HashSet<String> {
        let mut waits: HashSet<String> = HashSet::new();
        let mut made_by: HashMap<String, HashSet<String>> = HashMap::new();

        for function in functions {
            if WAITS.iter().any(|said| function.body.contains(said)) {
                waits.insert(function.name.clone());
            }
            made_by
                .entry(function.name.clone())
                .or_default()
                .extend(calls(&function.body));
        }

        loop {
            let found: Vec<String> = made_by
                .iter()
                .filter(|(name, called)| {
                    !waits.contains(*name) && called.iter().any(|one| waits.contains(one))
                })
                .map(|(name, _)| name.clone())
                .collect();
            if found.is_empty() {
                return waits;
            }
            waits.extend(found);
        }
    }

    /// The name of every command that runs on the thread that called it, which is
    /// `#[tauri::command]` on a function that is not itself `async`.
    /// `#[tauri::command(async)]` and `async fn` both answer from a thread of the
    /// runtime's, and saying one of the two is what the rule below asks for.
    fn on_the_calling_thread(source: &str) -> Vec<String> {
        let mut found = Vec::new();
        let mut lines = source.lines();

        while let Some(line) = lines.next() {
            if line.trim() != "#[tauri::command]" {
                continue;
            }
            // Past anything written between the attribute and the signature.
            let Some(line) = lines.find(|one| one.contains("fn ")) else {
                break;
            };
            if line.contains("async fn ") {
                continue;
            }
            if let Some((_indent, name)) = signature(line) {
                found.push(name);
            }
        }

        found
    }

    /// The rule the top of this file states, held to. A command that is not `async`
    /// runs its body on the thread the message loop is on, so one that waits for a
    /// file there stops the window painting for as long as the disk takes - and how
    /// long the disk takes is the one thing nobody can predict. Followed through the
    /// crate's own helpers, because a command that waits usually does it one call
    /// down rather than in its own three lines.
    #[test]
    fn a_command_that_waits_says_async() {
        let src = crate::app_dir().join("src");
        let mut sources = Vec::new();

        for file in fs::read_dir(src).expect("the crate's own source").flatten() {
            let path = file.path();
            if path.extension().is_some_and(|one| one == "rs") {
                sources.push(fs::read_to_string(&path).expect("one module"));
            }
        }
        // The walk itself, in case the source ever stops being where this looks.
        assert!(
            sources.len() > 20,
            "only {} modules were read",
            sources.len()
        );

        let functions: Vec<Function> = sources.iter().flat_map(|one| functions(one)).collect();
        let waits = waiting(&functions);

        for name in sources.iter().flat_map(|one| on_the_calling_thread(one)) {
            assert!(
                !waits.contains(&name) || EXCEPTED.contains(&name.as_str()),
                "{name} waits without saying async",
            );
        }
    }

    /// The three shapes the reader has to tell apart, and the chain it follows.
    #[test]
    fn a_command_waits_when_what_it_calls_waits() {
        let source = concat!(
            "#[tauri::command]\npub fn here() -> bool {\n    asked()\n}\n\n",
            "fn asked() -> bool {\n    deeper()\n}\n\n",
            "fn deeper() -> bool {\n    fs::metadata(one).is_ok()\n}\n\n",
            "#[tauri::command(async)]\npub fn elsewhere() {\n    fs::read(two);\n}\n\n",
            "#[tauri::command]\npub async fn waited() {\n    fs::read(three);\n}\n",
        );

        assert_eq!(on_the_calling_thread(source), vec!["here".to_owned()]);

        let waits = waiting(&functions(source));
        assert!(waits.contains("here"), "the chain was not followed");
        assert!(waits.contains("deeper"));
        // A name read off a method call is not one of ours.
        assert!(!calls("one.read(two)").contains("read"));
        assert!(calls("read(two)").contains("read"));
        // Nor is one a type answers, though a module's is.
        assert!(!calls("DispatchQueue::main()").contains("main"));
        assert!(calls("crate::launch::main()").contains("main"));
    }
}

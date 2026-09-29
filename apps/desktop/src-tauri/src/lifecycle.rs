//! What the app does when the system, rather than a window, asks something of it:
//! a document to open, the Dock icon clicked, the app asked to quit.
//!
//! A Mac is a document app's platform in a way the other two are not, and every
//! answer here follows the Mac apps a reader already knows. The app stays in the
//! Dock with every window closed (`TextEdit`, VS Code, Obsidian), a click on the icon
//! brings a window back, and quitting asks each window about its unsaved notes the
//! way closing that window would (`TextEdit` reviews each document before it goes).
//! Windows and Linux end the app with its last window, as they always did, and
//! nothing here changes that.

use std::sync::atomic::{AtomicU8, Ordering};
use tauri::{AppHandle, Emitter, ExitRequestApi, Manager, RunEvent, WindowEvent};

use crate::launch;

/// What a window is told when the app is quitting: run the same question closing
/// it would ask, and close if the answer is yes.
const QUIT: &str = "nib://quit";

/// Where the app is on its way out, as one of the three values below.
#[derive(Default)]
pub struct Quitting(AtomicU8);

/// Running as usual.
const RUNNING: u8 = 0;
/// Asked to quit: every window is asking about its own unsaved notes.
const ASKING: u8 = 1;
/// Every window has gone and the app is ending. Nothing stops it now.
const LEAVING: u8 = 2;

impl Quitting {
    fn now(&self) -> u8 {
        self.0.load(Ordering::SeqCst)
    }

    fn set(&self, to: u8) {
        self.0.store(to, Ordering::SeqCst);
    }
}

/// The state this module keeps, added to the builder.
pub fn managed(builder: tauri::Builder<crate::Engine>) -> tauri::Builder<crate::Engine> {
    builder.manage(Quitting::default())
}

/// The app's own answer to everything the event loop reports; handed to
/// `App::run` in lib.rs.
pub fn on_event(app: &AppHandle, event: RunEvent) {
    match event {
        // The Finder handing over documents: a double click, Open With, a file
        // dropped on the Dock icon. A Mac never puts them on the command line.
        // `nib://` links arrive here too, and are the deep-link plugin's; see uris.rs.
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            let paths = urls
                .iter()
                .filter(|url| url.scheme() == "file")
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned());
            launch::hand_over(app, launch::markdown_files(paths));
        }

        // Once there is an application delegate to teach: tao sets it as the loop
        // is built, and this is the loop's first event.
        #[cfg(target_os = "macos")]
        RunEvent::Ready => asked_to_quit::listen(app),

        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => launch::reopen(app),

        // An iPad asked for a second window: New Window in the icon's menu, or a note
        // dragged out to the side. tao takes scenes only with multiple scenes on (see
        // Info.ios.plist), and the phone build is one window, so the scene is given
        // back rather than shown blank.
        #[cfg(target_os = "ios")]
        RunEvent::SceneRequested { scene, .. } => {
            if let Some(main) = objc2::MainThreadMarker::new() {
                objc2_ui_kit::UIApplication::sharedApplication(main)
                    .requestSceneSessionDestruction_options_errorHandler(
                        &scene.session(),
                        None,
                        None,
                    );
            }
        }

        RunEvent::ExitRequested { code, api, .. } => exit_requested(app, code, &api),

        // And nothing a terminal started is left running once the app has gone.
        RunEvent::Exit => crate::terminal::end_all(app),

        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } => {
            if let Some(pending) = app.try_state::<launch::Pending>() {
                pending.forget(&label);
            }
            // Its terminals go with it; see terminal.rs.
            crate::terminal::window_gone(app, &label);
            // The last window has answered yes. With the presenter's window still
            // open the loop would not end by itself, so it is ended here.
            if state(app).now() == ASKING && launch::document_windows(app).is_empty() {
                leave(app);
            }
        }

        _ => {}
    }
}

/// Quits the app the careful way: every window is asked to close as if its close
/// button had been pressed, which is where the question about unsaved notes lives,
/// and the app ends once all of them have. What Quit in the app's menu comes to,
/// and anything else that asks the app to end: see `asked_to_quit` for a Mac.
pub fn quit(app: &AppHandle) {
    let quitting = state(app);
    quitting.set(ASKING);

    // Before any window is asked, and so before any has gone.
    crate::placement::note_every_window(app);

    let windows = launch::document_windows(app);
    if windows.is_empty() {
        leave(app);
        return;
    }

    let pending = app.try_state::<launch::Pending>();
    for window in windows {
        let label = window.label().to_owned();
        let listening = pending
            .as_ref()
            .is_some_and(|pending| pending.is_listening(&label));

        // A page that has not come up yet has nothing unsaved and nothing to ask
        // with, and waiting for it would be a quit that never ends.
        let (app, going) = (app.clone(), window.clone());
        let ask = move || {
            if listening {
                let _ = app.emit_to(label.as_str(), QUIT, ());
            } else {
                let _ = going.destroy();
            }
        };

        // The window's web tab logins first, as its close button would keep them: a
        // window that answers yes is destroyed rather than closed, so the close
        // request that keeps them on the way out never comes. Kept before asking, so
        // there is still only the one question, and a Cancel after it leaves nothing
        // but a login that lasts, which every page load does anyway. See
        // web_cookies.rs.
        #[cfg(all(any(windows, target_os = "macos"), not(feature = "cef")))]
        crate::web_cookies::kept(&window, ask);
        #[cfg(not(all(any(windows, target_os = "macos"), not(feature = "cef"))))]
        ask();
    }
}

/// A window said no: somebody chose Cancel over an unsaved note. The app carries
/// on as it was, so closing the last window later keeps it in the Dock rather
/// than finishing a quit nobody still wants.
#[tauri::command]
pub fn keep_running(app: AppHandle) {
    let quitting = state(&app);
    if quitting.now() == ASKING {
        quitting.set(RUNNING);
    }
    // And whatever asked for the quit is told it is off: a logout or a restart
    // stops, where the system's own wording says Nib stopped it.
    #[cfg(target_os = "macos")]
    asked_to_quit::answer(&app, false);
}

/// A Mac's Quit, whichever way it is asked for.
///
/// Quit in the app's menu, Cmd+Q, Quit in the Dock's menu and logging out all
/// reach an app the same way: `AppKit` asks its application delegate whether it
/// may terminate, and ends the process at once if the delegate does not say. The
/// delegate is tao's, and it does not say - so without this a Cmd+Q never becomes
/// the `ExitRequested` the rest of this module answers, and no window is asked
/// anything. So the one method is added to it: the windows are asked (`quit`), and
/// `AppKit` is told to wait for their answer, which it is given once they have all
/// gone or one of them has said no.
///
/// Wait, not no. The answer goes back to whatever asked, and a logout, a restart
/// or a shutdown hears "no" as the app stopping it: it was, every time, with
/// nothing unsaved anywhere, and the reader had to start it again once Nib had quit
/// by itself a moment later. Only a Cancel over an unsaved note calls one off now,
/// which is what every Mac document app does.
#[cfg(target_os = "macos")]
mod asked_to_quit {
    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::{ffi, sel, MainThreadMarker};
    use objc2_app_kit::NSApplication;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use tauri::AppHandle;

    /// The app the method answers for. `AppKit` calls it with no way to hand
    /// anything along, so it is kept here, once.
    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// `NSTerminateNow` and `NSTerminateLater`.
    const NOW: usize = 1;
    const LATER: usize = 2;

    /// `AppKit` is waiting on the windows: set when a quit is held, and cleared by
    /// the one answer it is given.
    static WAITING: AtomicBool = AtomicBool::new(false);

    /// The method's shape: `- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender`.
    type ShouldTerminate = extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize;

    /// Teaches the application delegate to answer a quit.
    #[allow(
        unsafe_code,
        reason = "adding a method to a class AppKit owns is the Objective-C runtime's own call, which has no safe wrapper"
    )]
    pub fn listen(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        let Some(main) = MainThreadMarker::new() else {
            return;
        };
        let Some(delegate) = NSApplication::sharedApplication(main).delegate() else {
            return;
        };
        let object: &AnyObject = delegate.as_ref();
        let answer: ShouldTerminate = should_terminate;

        // SAFETY: the class is the live delegate's own, read off the object on the
        // main thread; the function has exactly the signature the type encoding
        // says (an unsigned integer back, the receiver, the selector and one object
        // in), which is the signature `AppKit` calls it with; and `class_addMethod`
        // leaves a class that already answers the selector as it was.
        unsafe {
            let class = ffi::object_getClass(std::ptr::from_ref(object)).cast_mut();
            let imp = std::mem::transmute::<ShouldTerminate, Imp>(answer);
            ffi::class_addMethod(
                class,
                sel!(applicationShouldTerminate:),
                imp,
                c"Q@:@".as_ptr(),
            );
        }
    }

    /// Now, when every window has already gone and this is the app ending;
    /// otherwise later, once the windows have been asked.
    extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: *mut AnyObject) -> usize {
        let Some(app) = APP.get() else {
            return NOW;
        };
        if super::state(app).now() == super::LEAVING {
            return NOW;
        }

        super::quit(app);
        // With no window to ask, the quit is already over.
        if super::state(app).now() == super::LEAVING {
            return NOW;
        }

        WAITING.store(true, Ordering::SeqCst);
        LATER
    }

    /// What the windows decided about a quit `AppKit` is waiting on: yes, and it
    /// ends the app; no, and whatever asked is told the quit is off. False when
    /// nothing was waiting - a quit from the app's own menu, or the last window
    /// going - which the caller ends the ordinary way.
    pub fn answer(app: &AppHandle, yes: bool) -> bool {
        if !WAITING.swap(false, Ordering::SeqCst) {
            return false;
        }

        let reply = move || {
            if let Some(main) = MainThreadMarker::new() {
                NSApplication::sharedApplication(main).replyToApplicationShouldTerminate(yes);
            }
        };
        if MainThreadMarker::new().is_some() {
            reply();
        } else {
            let _ = app.run_on_main_thread(reply);
        }
        true
    }
}

/// The one exit that is let through, once every window has gone.
fn leave(app: &AppHandle) {
    state(app).set(LEAVING);
    // A quit `AppKit` asked about is ended by `AppKit`, which is also what tells a
    // logout that Nib is out of its way.
    #[cfg(target_os = "macos")]
    if asked_to_quit::answer(app, true) {
        return;
    }
    app.exit(0);
}

fn exit_requested(app: &AppHandle, code: Option<i32>, api: &ExitRequestApi) {
    let quitting = state(app);
    match on_exit(code, quitting.now(), cfg!(target_os = "macos")) {
        // Ending: nothing asks again on the way out, whichever way the loop goes.
        Exit::Pass => quitting.set(LEAVING),
        Exit::Stay => api.prevent_exit(),
        Exit::Ask => {
            api.prevent_exit();
            quit(app);
        }
    }
}

fn state(app: &AppHandle) -> tauri::State<'_, Quitting> {
    app.state::<Quitting>()
}

/// What to do with a request to end the app.
#[derive(Debug, PartialEq, Eq)]
enum Exit {
    /// Let it end.
    Pass,
    /// Keep running with no window, in the Dock.
    Stay,
    /// Keep running, and ask every window first.
    Ask,
}

/// The decision behind `exit_requested`, apart from anything it acts on.
///
/// `code` is `None` when the request is the last window having closed and a
/// number when something asked for the app to end. A restart is never held: the
/// update that asked for it has already put its files in place, and Tauri would
/// not let it be held anyway. Nor is the exit that follows every window saying
/// yes, which is what stops the question going round for ever.
fn on_exit(code: Option<i32>, now: u8, mac: bool) -> Exit {
    if code == Some(tauri::RESTART_EXIT_CODE) || now == LEAVING {
        return Exit::Pass;
    }

    match code {
        // The last window has closed. On the way out of a quit that is the quit
        // done; otherwise a Mac app stays in the Dock, and elsewhere the app ends
        // with its last window as it always has.
        None if now == ASKING || !mac => Exit::Pass,
        None => Exit::Stay,
        // Asked to end. Asked again while the windows are still answering - Cmd+Q
        // pressed a second time - the question is put again, and a window already
        // asking ignores it.
        Some(_) if mac => Exit::Ask,
        Some(_) => Exit::Pass,
    }
}

#[cfg(test)]
mod tests {
    use super::{on_exit, Exit, ASKING, LEAVING, RUNNING};

    #[test]
    fn a_mac_app_outlives_its_last_window() {
        assert_eq!(on_exit(None, RUNNING, true), Exit::Stay);
    }

    #[test]
    fn elsewhere_the_last_window_still_ends_the_app() {
        assert_eq!(on_exit(None, RUNNING, false), Exit::Pass);
        assert_eq!(on_exit(Some(0), RUNNING, false), Exit::Pass);
    }

    #[test]
    fn quitting_on_a_mac_asks_every_window_first() {
        assert_eq!(on_exit(Some(0), RUNNING, true), Exit::Ask);
        // And again, for a second Cmd+Q while the first is still being answered.
        assert_eq!(on_exit(Some(0), ASKING, true), Exit::Ask);
    }

    #[test]
    fn the_exit_after_every_window_said_yes_goes_through() {
        // The last window closing during a quit is the quit finished.
        assert_eq!(on_exit(None, ASKING, true), Exit::Pass);
        // And the exit the app asks for itself once they have all gone.
        assert_eq!(on_exit(Some(0), LEAVING, true), Exit::Pass);
        assert_eq!(on_exit(None, LEAVING, true), Exit::Pass);
    }

    #[test]
    fn a_restart_is_never_held() {
        assert_eq!(
            on_exit(Some(tauri::RESTART_EXIT_CODE), RUNNING, true),
            Exit::Pass
        );
    }
}

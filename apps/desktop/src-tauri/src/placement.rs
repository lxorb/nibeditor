//! Where the window was, so the next launch opens it there.
//!
//! Every desktop app does this and nib did not: the window came up at 1180 by 760 in
//! the middle of the primary screen however it had been left. So the window's place
//! is written down as it closes, and `ready` in lib.rs puts it into the window's
//! config before the window is built - built there, not moved there afterwards, so
//! there is no frame in the old place and no jump. One small file read and one list
//! of screens, which is well under a millisecond of a launch.
//!
//! **What is kept.** The bounds a window has when it is neither maximised, minimised
//! nor full screen, and whether it was maximised. A maximised window's own bounds are
//! the screen's and say nothing about where it goes back to, so they are never
//! written down: the bounds before it was maximised are, which is what Windows itself
//! calls the normal placement. Minimised and full screen are not kept at all - a
//! window that reopened minimised would be an app that seemed not to start.
//!
//! **In the units the platform builds in.** Logical pixels, in the scale of the screen
//! the window was on. That is what `tauri.conf.json` says a window's size in, and it
//! is what tao turns back into pixels with the scale of the screen the position falls
//! on - so a window on a 150% laptop screen beside a 100% monitor reopens the size it
//! was on either.
//!
//! **Onto a screen that is still there.** A laptop that was docked last night is not
//! this morning, and a window placed where the second monitor used to be is a window
//! nobody can reach. So the place is judged against the screens there are before it
//! is used; see `onto`, which is the rule Chrome keeps: the window is made to fit the
//! screen it is mostly on, and at least a strip of it with the top edge stays on it.
//!
//! **The last window closed.** Several windows can be open; the one closed last is the
//! place the next launch opens in, which is what a browser does.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::utils::config::WindowConfig;
use tauri::{
    AppHandle, LogicalPosition, Manager, Monitor, Runtime, Webview, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};

use crate::paths::{config_dir, made, write_atomically};

/// What the file is called, beside the ground colour: something the app keeps about
/// itself.
const FILE: &str = "window.json";

/// How much of a window has to stay on a screen, in logical pixels, for somebody to
/// be able to take hold of it and pull the rest back. Chrome keeps a strip about
/// this size on screen for the same reason.
const STAYS: f64 = 64.0;

/// Anything longer than this is not a placement and is not read.
const MOST: u64 = 512;

/// The variable a drive sets to have every window of the run opened off the screen,
/// whatever the build's own config says; `scripts/probe_app.py` sets it on every
/// probe it starts.
const OFF_SCREEN: &str = "NIB_OFF_SCREEN";

/// Where off the screen: the corner Windows parks a minimised window in, well past
/// any desk of monitors.
const OFF: f64 = -32000.0;

/// Where this run's windows were sent, once the first of them was; see `away`.
static AWAY: OnceLock<(f64, f64)> = OnceLock::new();

/// Where a window is: its top left corner and its inner size, in logical pixels, and
/// whether it is maximised over them.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Placement {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: bool,
}

/// A screen's working area, the part the taskbar and the dock leave, in logical
/// pixels at that screen's own scale.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Area {
    /// How much of `placed` lies on this screen, as an area.
    fn overlap(&self, placed: &Placement) -> f64 {
        let wide = (self.x + self.width).min(placed.x + placed.width) - self.x.max(placed.x);
        let tall = (self.y + self.height).min(placed.y + placed.height) - self.y.max(placed.y);
        wide.max(0.0) * tall.max(0.0)
    }
}

/// Every open window's place as it stands, by label, so the one that closes can be
/// written down. Starts from what the file said, so a window that opened maximised
/// and closed without ever being made smaller still knows where it goes back to.
#[derive(Default)]
struct Placements {
    windows: Mutex<HashMap<String, Followed>>,
    remembered: Mutex<Option<Placement>>,
}

/// One window, followed: the bounds it has now, the bounds it had one move before,
/// and whether it is maximised.
///
/// The bounds before are what a maximise goes back to, because Windows says a window
/// has moved before it says the window is maximised: the move that arrives first
/// already carries the screen's bounds, and only the event after it says why. So
/// when a maximise is seen, the latest bounds are dropped for the ones before them.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Followed {
    latest: Option<Placement>,
    before: Option<Placement>,
    maximized: bool,
}

impl Followed {
    fn starting(remembered: Option<Placement>) -> Self {
        let normal = remembered.map(|was| Placement {
            maximized: false,
            ..was
        });
        Followed {
            latest: normal,
            before: normal,
            maximized: remembered.is_some_and(|was| was.maximized),
        }
    }

    /// A move or a resize, with the bounds as they are now and whether it is maximised.
    fn saw(&mut self, bounds: Option<Placement>, maximized: bool) {
        if maximized {
            if !self.maximized {
                self.latest = self.before;
            }
            self.maximized = true;
            return;
        }

        self.maximized = false;
        if let Some(bounds) = bounds {
            self.before = self.latest;
            self.latest = Some(bounds);
        }
    }

    /// What to write down: the bounds and, where it is maximised, that it is.
    fn placement(&self) -> Option<Placement> {
        self.latest.map(|was| Placement {
            maximized: self.maximized,
            ..was
        })
    }
}

/// The app's builder with what this keeps: every window's place, followed as it moves.
pub fn managed(builder: tauri::Builder<crate::Engine>) -> tauri::Builder<crate::Engine> {
    builder.manage(Placements::default()).on_window_event(noted)
}

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(FILE))
}

/// The main window's config with the last place put into it, or the config as it was
/// where there is no place yet, or where the config names a place of its own.
pub fn restored(app: &AppHandle, config: &WindowConfig) -> WindowConfig {
    let mut config = named(config, asked_away());
    if let (Some(x), Some(y)) = (config.x, config.y) {
        let _ = AWAY.set((x, y));
    }
    if names_its_place(&config) {
        return config;
    }
    let Some(placed) = last_place(app) else {
        return config;
    };

    config.x = Some(placed.x);
    config.y = Some(placed.y);
    config.width = placed.width;
    config.height = placed.height;
    config.maximized = placed.maximized;
    config.center = false;
    config
}

/// The main window's builder with the last place put into it, as `restored` puts it
/// into the config: for the main window built again after the last one closed, which
/// is the Dock icon clicked on a Mac (see `reopen` in launch.rs). Built there, as at
/// launch, so there is no frame in the default place first.
pub fn reopened<'a, R: tauri::Runtime, M: Manager<R>>(
    app: &AppHandle,
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    let Some(placed) = last_place(app) else {
        return builder;
    };
    builder
        .position(placed.x, placed.y)
        .inner_size(placed.width, placed.height)
        .maximized(placed.maximized)
}

/// The place the file says, made to fit the screens there are, and noted as where a
/// window that opens maximised goes back to. Nothing where there is no place yet.
fn last_place(app: &AppHandle) -> Option<Placement> {
    let placed = read(app)?;
    if let Some(kept) = app.try_state::<Placements>() {
        if let Ok(mut remembered) = kept.remembered.lock() {
            *remembered = Some(placed);
        }
    }
    Some(onto(placed, &areas(app)))
}

/// Whether the config says where the window goes, which the app's own config never
/// does. A build that says so meant it: a probe or a drive opens its window off the
/// screen on purpose, so that it never lands in front of somebody working, and a
/// remembered place would pull it back on.
pub fn names_its_place(config: &WindowConfig) -> bool {
    config.x.is_some() || config.y.is_some()
}

/// The config a window is built from, with what a drive asked for put into it: off the
/// screen where `NIB_OFF_SCREEN` says so, and - wherever the place is named, by the
/// switch or by the build's own config - never taking the keyboard. A window that
/// opens somewhere nobody is looking has no business taking the typing from whoever
/// is working in front of it.
fn named(config: &WindowConfig, away: bool) -> WindowConfig {
    let mut config = config.clone();
    if away {
        config.x = Some(OFF);
        config.y = Some(OFF);
    }
    if names_its_place(&config) {
        config.focus = false;
    }
    config
}

/// Whether the drive that started this run asked for every window off the screen.
/// Any value but `0`, as with the launch trace's switch.
pub(crate) fn asked_away() -> bool {
    std::env::var_os(OFF_SCREEN).is_some_and(|value| !value.is_empty() && value != "0")
}

/// Where this run's windows open, where a place was named for them: the first
/// window's, which `restored` notes, so that a second window a probe opens goes where
/// the first went rather than into the middle of the screen.
pub fn away() -> Option<(f64, f64)> {
    AWAY.get().copied()
}

/// Builds a window at a named place without a frame of it anywhere else.
///
/// Hidden, put there, and only then shown, whatever the config says about being
/// visible. Two reasons it cannot simply be built there: on Windows, tao keeps a
/// starting place only when it falls on a screen and hands any other to the system,
/// which cascades it onto the primary one - so a window built visible appeared there,
/// in the middle of somebody's work, and only then went where it was sent. Moving a
/// window that is still hidden is honoured wherever it goes. And it is shown without
/// being brought forward: built unfocused, tao shows it the way `SW_SHOWNOACTIVATE`
/// does, so the window that was in front stays in front.
///
/// And on Windows it is not even created in the cascade's place: see `created_away`,
/// which hands the system the place tao would have dropped. Hidden is a state a window
/// can leave by any road - one probe window in about twenty cold launches was once
/// seen on a screen at the cascade's corner before the drive had asked it anything -
/// and a window that has never had a pixel of itself on any screen has no frame there
/// to show, whichever road it took.
///
/// And under every other window, for as long as it is open. The system hands the
/// keyboard to the next window down when the one in front closes, and a probe that sat
/// above the reader's other windows could be that next window - an off-screen probe the
/// window in front, five seconds into a launch nothing had asked to come forward, was
/// seen on 2026-09-30 - with the typing going somewhere nobody could see. tao holds a
/// window that asks for the bottom there through every move.
pub fn built_away<R: Runtime, M: Manager<R>>(
    building: WebviewWindowBuilder<'_, R, M>,
    (x, y): (f64, f64),
) -> tauri::Result<WebviewWindow<R>> {
    // No taskbar button either, which tao and winit add to any window not asked to skip
    // it, whatever its style: a button is a way to bring the window forward. See
    // foreground.rs for the rest of what keeps a probe's window from ever being in front.
    let building = building
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .always_on_bottom(true);
    #[cfg(windows)]
    let window = created_away::during(|| building.build())?;
    #[cfg(not(windows))]
    let window = building.build()?;
    window.set_position(LogicalPosition::new(x, y))?;
    window.show()?;
    Ok(window)
}

/// Every top-level window this thread creates while `during` runs is created off the
/// screen, whatever place it asked for.
///
/// tao turns a starting place that is on no screen into `CW_USEDEFAULT`, so a window
/// sent away is born at the system's cascade - on the primary screen - and only moved
/// off it once the webview inside has been built, which on a cold profile is seconds.
/// A computer-based-training hook is the system's own seam for exactly this: it is
/// told of each window before it exists, with the structure the window will be
/// created from, and may change it. Here it changes the place and nothing else, for
/// the windows of this thread alone, and only while one build runs.
#[cfg(windows)]
mod created_away {
    use std::cell::Cell;

    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, SetWindowsHookExW, UnhookWindowsHookEx, CBT_CREATEWNDW, HCBT_CREATEWND,
        HHOOK, WH_CBT, WS_CHILD,
    };

    /// Off every screen, in the pixels `CreateWindowEx` takes: the corner a minimised
    /// window is parked in. The system clamps it nearer, and nearer is still far past
    /// any desk of monitors.
    const PARKED: i32 = -32_000;

    thread_local! {
        /// Whether a build on this thread is asking, so a window created by anything else
        /// on the thread - later, or by a build that was not sent away - is left alone.
        static ASKING: Cell<bool> = const { Cell::new(false) };
    }

    #[allow(
        unsafe_code,
        reason = "a window hook is a callback the system calls with pointers it owns"
    )]
    unsafe extern "system" fn creating(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if u32::try_from(code) == Ok(HCBT_CREATEWND) && ASKING.get() {
            // Safe: for `HCBT_CREATEWND` the system passes a live `CBT_CREATEWND` whose
            // `lpcs` is the structure the window is about to be created from, and it is
            // ours to change until this returns.
            unsafe {
                let told = lparam.0 as *const CBT_CREATEWNDW;
                if let Some(creating) = told.as_ref().and_then(|told| told.lpcs.as_mut()) {
                    // A child goes where its parent does; only a window of its own has a
                    // place on the screen.
                    if u32::from_ne_bytes(creating.style.to_ne_bytes()) & WS_CHILD.0 == 0 {
                        creating.x = PARKED;
                        creating.y = PARKED;
                    }
                }
            }
        }
        // Safe: handing the call on is what a hook owes the rest of the chain.
        unsafe { CallNextHookEx(HHOOK::default(), code, wparam, lparam) }
    }

    /// Runs `making` with every top-level window it creates on this thread created off
    /// the screen. Where the hook cannot be set, `making` runs as it always did, and the
    /// window is moved away after it is built as it always was.
    #[allow(
        unsafe_code,
        reason = "setting and removing a window hook is a Win32 call"
    )]
    pub fn during<T>(making: impl FnOnce() -> T) -> T {
        // Safe: a hook on this thread alone, with a procedure that lives for the whole
        // process, removed below before this returns.
        let hook = unsafe {
            SetWindowsHookExW(
                WH_CBT,
                Some(creating),
                HINSTANCE::default(),
                GetCurrentThreadId(),
            )
        };
        ASKING.set(true);
        let made = making();
        ASKING.set(false);
        if let Ok(hook) = hook {
            // Safe: the hook set above, removed once.
            let _ = unsafe { UnhookWindowsHookEx(hook) };
        }
        made
    }
}

/// Builds any window after the first where the first went: off the screen with it
/// where a drive sent it there, and as the builder says otherwise.
///
/// The one road every later window takes - a second window, a page's sign-in popup -
/// because each of them used to decide for itself, and the popup forgot: built as its
/// page asked, it was handed to the system at a place on no screen, which cascaded it
/// onto the primary one in front of whoever was working (2026-09-30, a probe's popup
/// at 0,0). A window that does not come through here is a window that can do that
/// again; the test below holds the crate to it.
pub fn built<R: Runtime, M: Manager<R>>(
    building: WebviewWindowBuilder<'_, R, M>,
) -> tauri::Result<WebviewWindow<R>> {
    match away() {
        Some(at) => built_away(building, at),
        None => building.build(),
    }
}

/// Brings a window forward because somebody asked for the app - a second launch, a
/// link - unless this run's windows were sent off the screen, where coming forward
/// would take the keyboard from whoever is working and show them nothing.
///
/// On Windows tao's own way forward, where the system says no, presses Alt for the
/// app - a key the window in front receives - and asks again, which no lock refuses: so
/// under the switch this must never be reached at all, and nothing else in the crate
/// asks a window for the keyboard; see the test below.
pub fn raised<R: Runtime>(window: &Window<R>) {
    if away().is_some() {
        return;
    }
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Gives the keyboard to one of the app's own webviews - the page taking it back from a
/// web tab's, a chord the app answers - unless this run's windows were sent off the
/// screen. A webview given the keyboard activates the window it is in, and in a process
/// that may take the foreground an activated window is the window in front, off the
/// screen or not: a key pressed inside a probe's page did exactly that on 2026-09-30,
/// by way of `web_keys.rs`.
pub fn keyboard_to<R: Runtime>(webview: &Webview<R>) {
    if away().is_some() {
        return;
    }
    let _ = webview.set_focus();
}

/// The keyboard back to the page that asks, from a web tab's page holding it: a site's
/// question, a pairing request, a row of a Mac's menu bar. The page's one way to it, so
/// it is `keyboard_to`'s answer as well.
#[tauri::command]
pub fn take_keyboard(webview: Webview) {
    keyboard_to(&webview);
}

/// One of the app's windows brought forward from the page - the presenter's, asked for
/// again while it is open. The page's one way to it, so it is `raised`'s answer as well.
#[tauri::command]
pub fn raise_window(app: AppHandle, label: String) {
    if let Some(window) = app.get_window(&label) {
        raised(&window);
    }
}

fn read(app: &AppHandle) -> Option<Placement> {
    let path = file(app).ok()?;
    if std::fs::metadata(&path).ok()?.len() > MOST {
        return None;
    }
    let placed: Placement = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    sane(&placed).then_some(placed)
}

/// Whether what the file said is a window at all: numbers that are numbers, and a
/// size with room in it. A disk keeps halves of things.
fn sane(placed: &Placement) -> bool {
    [placed.x, placed.y, placed.width, placed.height]
        .iter()
        .all(|one| one.is_finite())
        && placed.width >= 1.0
        && placed.height >= 1.0
}

/// The screens there are, the primary one first, as working areas in their own
/// logical pixels.
fn areas(app: &AppHandle) -> Vec<Area> {
    let mut screens = app.available_monitors().unwrap_or_default();
    if let Ok(Some(primary)) = app.primary_monitor() {
        if let Some(at) = screens
            .iter()
            .position(|one| one.position() == primary.position())
        {
            screens.swap(0, at);
        }
    }
    screens.iter().map(area_of).collect()
}

fn area_of(screen: &Monitor) -> Area {
    let scale = screen.scale_factor();
    let work = screen.work_area();
    Area {
        x: f64::from(work.position.x) / scale,
        y: f64::from(work.position.y) / scale,
        width: f64::from(work.size.width) / scale,
        height: f64::from(work.size.height) / scale,
    }
}

/// Where a window last placed at `placed` goes on these screens.
///
/// The screen it is mostly on, or - where it is on none of them any more - the first,
/// which the caller makes the primary one. It is made to fit that screen, then kept on
/// it: the top edge never above the screen's top, where the tab strip would be out of
/// reach, and at least `STAYS` of it inside every other edge. A window that is on no
/// screen at all is centred on the first rather than pushed against its edge.
///
/// No screens at all - a machine that could not say - leaves it where it was.
fn onto(placed: Placement, screens: &[Area]) -> Placement {
    let best = screens
        .iter()
        .map(|screen| (screen, screen.overlap(&placed)))
        .fold(None::<(&Area, f64)>, |best, (screen, overlap)| match best {
            Some((_, most)) if most >= overlap => best,
            _ => Some((screen, overlap)),
        });
    let Some((screen, overlap)) = best else {
        return placed;
    };

    let width = placed.width.min(screen.width);
    let height = placed.height.min(screen.height);

    let (x, y) = if overlap > 0.0 {
        (
            placed
                .x
                .min(screen.x + screen.width - STAYS)
                .max(screen.x + STAYS - width),
            placed.y.min(screen.y + screen.height - STAYS).max(screen.y),
        )
    } else {
        (
            screen.x + (screen.width - width) / 2.0,
            screen.y + (screen.height - height) / 2.0,
        )
    };

    Placement {
        x,
        y,
        width,
        height,
        maximized: placed.maximized,
    }
}

/// Follows every window as it moves, and writes the place down as one closes.
///
/// Read on every move and every resize, which is a handful of calls into the window
/// and no disk; written only on the way out.
fn noted(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => follow(window),
        // Both, because a close can be answered by the page destroying the window
        // itself, and a window can go without being asked. Writing twice is writing the
        // same few bytes twice.
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => keep(window),
        _ => {}
    }
}

/// Notes where every window is, now, while each of them still exists. What a quit does
/// before it asks any window to go (see `quit` in lifecycle.rs), because a window that
/// is being destroyed can no longer say where it is, and the last move it was heard
/// of is not where it is: on a Mac the resize a drag ends on is not reported, so the
/// place written was a step short of where the drag ended. The close that follows
/// writes it down as ever.
pub fn note_every_window(app: &AppHandle) {
    for window in app.windows().values() {
        follow(window);
    }
}

fn follow(window: &Window) {
    // Neither minimised nor full screen is a place to come back to; see the top of
    // this file. Nothing about the window is changed by either, so nothing is noted.
    if window.is_minimized().unwrap_or(true) || window.is_fullscreen().unwrap_or(true) {
        return;
    }
    let Some(kept) = window.try_state::<Placements>() else {
        return;
    };
    let Ok(mut windows) = kept.windows.lock() else {
        return;
    };

    let maximized = window.is_maximized().unwrap_or(false);
    let bounds = if maximized { None } else { bounds(window) };
    windows
        .entry(window.label().to_owned())
        .or_insert_with(|| Followed::starting(kept.remembered.lock().ok().and_then(|was| *was)))
        .saw(bounds, maximized);
}

/// The window's own bounds as it stands, in logical pixels at its screen's scale.
fn bounds(window: &Window) -> Option<Placement> {
    let scale = window.scale_factor().ok()?;
    let at = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    let placed = Placement {
        x: at.x,
        y: at.y,
        width: size.width,
        height: size.height,
        maximized: false,
    };
    sane(&placed).then_some(placed)
}

fn keep(window: &Window) {
    follow(window);
    let Some(kept) = window.try_state::<Placements>() else {
        return;
    };
    let placed = kept
        .windows
        .lock()
        .ok()
        .and_then(|windows| windows.get(window.label()).and_then(Followed::placement));
    let Some(placed) = placed else {
        return;
    };
    let Ok(text) = serde_json::to_string(&placed) else {
        return;
    };
    let Ok(path) = file(window.app_handle()) else {
        return;
    };
    if let Some(parent) = path.parent() {
        if made(parent).is_err() {
            return;
        }
    }
    // A place that could not be written costs the next launch its place and nothing
    // else, so there is nobody to tell.
    let _ = write_atomically(&path, text.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::{named, names_its_place, onto, sane, Area, Followed, Placement, OFF};
    use tauri::utils::config::WindowConfig;

    fn placed(x: f64, y: f64, width: f64, height: f64) -> Placement {
        Placement {
            x,
            y,
            width,
            height,
            maximized: false,
        }
    }

    const LAPTOP: Area = Area {
        x: 0.0,
        y: 0.0,
        width: 1440.0,
        height: 860.0,
    };

    /// A monitor to the right of the laptop, the way a desk has one.
    const MONITOR: Area = Area {
        x: 1440.0,
        y: -200.0,
        width: 2560.0,
        height: 1400.0,
    };

    #[test]
    fn a_window_on_a_screen_stays_where_it_was() {
        let was = placed(100.0, 80.0, 1180.0, 760.0);
        assert_eq!(onto(was, &[LAPTOP, MONITOR]), was);

        let there = placed(1800.0, 0.0, 1600.0, 1000.0);
        assert_eq!(onto(there, &[LAPTOP, MONITOR]), there);
    }

    /// The monitor it was on has gone: centred on the screen there is, and made to
    /// fit it.
    #[test]
    fn a_window_on_a_screen_that_has_gone_comes_back_to_the_first() {
        let was = placed(1800.0, 0.0, 1600.0, 1000.0);
        assert_eq!(
            onto(was, &[LAPTOP]),
            placed(0.0, 0.0, 1440.0, 860.0),
            "made to fit"
        );

        let small = placed(3000.0, 300.0, 800.0, 600.0);
        assert_eq!(onto(small, &[LAPTOP]), placed(320.0, 130.0, 800.0, 600.0));
    }

    /// Half off the edge is still reachable, and is left alone; almost all the way off
    /// is pulled back until a strip of it is on the screen.
    #[test]
    fn a_window_hanging_off_an_edge_keeps_a_strip_on_screen() {
        let half = placed(-500.0, 100.0, 1000.0, 600.0);
        assert_eq!(onto(half, &[LAPTOP]), half);

        let mostly_off = placed(1420.0, 100.0, 1000.0, 600.0);
        assert_eq!(
            onto(mostly_off, &[LAPTOP]),
            placed(1440.0 - 64.0, 100.0, 1000.0, 600.0)
        );

        let low = placed(100.0, 850.0, 1000.0, 600.0);
        assert_eq!(
            onto(low, &[LAPTOP]),
            placed(100.0, 860.0 - 64.0, 1000.0, 600.0)
        );
    }

    /// The top edge carries the tabs and is how a frameless window is dragged, so it is
    /// never left above the screen.
    #[test]
    fn the_top_edge_is_never_above_the_screen() {
        let high = placed(100.0, -300.0, 1000.0, 600.0);
        assert_eq!(onto(high, &[LAPTOP]), placed(100.0, 0.0, 1000.0, 600.0));
    }

    /// A screen with a lower resolution than last time.
    #[test]
    fn a_window_bigger_than_its_screen_is_made_to_fit() {
        let big = placed(0.0, 0.0, 2000.0, 1200.0);
        assert_eq!(onto(big, &[LAPTOP]), placed(0.0, 0.0, 1440.0, 860.0));
    }

    #[test]
    fn the_screen_it_is_mostly_on_is_the_one_it_is_kept_on() {
        // Mostly on the monitor, hanging off its bottom.
        let was = placed(1400.0, 1180.0, 1200.0, 800.0);
        assert_eq!(
            onto(was, &[LAPTOP, MONITOR]),
            placed(1400.0, -200.0 + 1400.0 - 64.0, 1200.0, 800.0)
        );
    }

    #[test]
    fn maximised_stays_maximised() {
        let was = Placement {
            maximized: true,
            ..placed(1800.0, 0.0, 1600.0, 1000.0)
        };
        assert!(onto(was, &[LAPTOP]).maximized);
    }

    #[test]
    fn no_screens_leaves_it_where_it_was() {
        let was = placed(-9000.0, 0.0, 800.0, 600.0);
        assert_eq!(onto(was, &[]), was);
    }

    /// What Windows says as a window is maximised: a move to the screen's corner at the
    /// screen's size, and only then that it is maximised. The bounds it goes back to
    /// are the ones before the move.
    #[test]
    fn a_maximise_goes_back_to_the_bounds_before_it() {
        let normal = placed(140.0, 120.0, 887.0, 612.0);
        let screen = placed(-6.5, -6.5, 1472.0, 919.5);

        let mut followed = Followed::starting(None);
        followed.saw(Some(normal), false);
        followed.saw(Some(normal), false);
        followed.saw(Some(screen), false);
        followed.saw(None, true);
        assert_eq!(
            followed.placement(),
            Some(Placement {
                maximized: true,
                ..normal
            })
        );

        // And back again.
        followed.saw(Some(normal), false);
        assert_eq!(followed.placement(), Some(normal));
    }

    /// A window that opened maximised and closed maximised keeps the bounds the file
    /// gave it, since it never had any of its own.
    #[test]
    fn opened_maximised_keeps_what_the_file_said() {
        let was = Placement {
            maximized: true,
            ..placed(100.0, 80.0, 1000.0, 700.0)
        };
        let mut followed = Followed::starting(Some(was));
        followed.saw(None, true);
        assert_eq!(followed.placement(), Some(was));

        followed.saw(Some(placed(100.0, 80.0, 1000.0, 700.0)), false);
        assert_eq!(
            followed.placement(),
            Some(placed(100.0, 80.0, 1000.0, 700.0))
        );
    }

    /// What a quit noted while the window was there is what its close writes, although
    /// a window being destroyed can no longer be read: bounds that cannot be had leave
    /// the last ones alone. See `note_every_window`.
    #[test]
    fn a_window_that_cannot_be_read_keeps_the_place_last_noted() {
        let dragged = placed(300.0, 140.0, 940.0, 640.0);

        let mut followed = Followed::starting(None);
        followed.saw(Some(placed(300.0, 140.0, 943.0, 642.0)), false);
        followed.saw(Some(dragged), false);
        followed.saw(None, false);
        assert_eq!(followed.placement(), Some(dragged));
    }

    /// The app's own config leaves the place to this file; a probe's puts the window
    /// off the screen and must keep it there.
    #[test]
    fn a_config_that_names_a_place_keeps_it() {
        assert!(!names_its_place(&WindowConfig::default()));
        let off = WindowConfig {
            x: Some(-32000.0),
            y: Some(-32000.0),
            ..WindowConfig::default()
        };
        assert!(names_its_place(&off));

        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("the app's config");
        let window = &config["app"]["windows"][0];
        assert!(window["x"].is_null() && window["y"].is_null());
    }

    /// `NIB_OFF_SCREEN` sends the window off the screen whatever the build said, and a
    /// window sent there never takes the keyboard.
    #[test]
    fn a_drive_that_asks_gets_its_window_off_the_screen_and_unfocused() {
        let away = named(&WindowConfig::default(), true);
        assert_eq!((away.x, away.y), (Some(OFF), Some(OFF)));
        assert!(!away.focus);
    }

    /// A build whose config names a place keeps it, and loses the keyboard with it.
    #[test]
    fn a_named_place_is_kept_and_never_focused() {
        let built = WindowConfig {
            x: Some(-20000.0),
            y: Some(-20000.0),
            ..WindowConfig::default()
        };
        let away = named(&built, false);
        assert_eq!((away.x, away.y), (Some(-20000.0), Some(-20000.0)));
        assert!(!away.focus);
    }

    /// Somebody who opened the app gets the window they opened, in front of them.
    #[test]
    fn nothing_named_and_nothing_asked_changes_nothing() {
        let plain = named(&WindowConfig::default(), false);
        assert_eq!(plain.x, None);
        assert!(plain.focus);
    }

    #[test]
    fn a_file_that_is_not_a_window_is_not_read_as_one() {
        assert!(!sane(&placed(f64::NAN, 0.0, 800.0, 600.0)));
        assert!(!sane(&placed(0.0, 0.0, 0.0, 600.0)));
        assert!(!sane(&placed(0.0, f64::INFINITY, 800.0, 600.0)));
        assert!(sane(&placed(-100.0, -20.0, 800.0, 600.0)));
        assert!(serde_json::from_str::<Placement>("{\"x\":1}").is_err());
    }

    /// Every window the crate builds is built where this run's windows go, or says
    /// why it need not be. Read off the source, because a window that forgets is only
    /// ever found by somebody it landed in front of: a page's popup did, until `built`.
    #[test]
    fn every_window_is_built_where_the_run_sends_them() {
        // Built hidden and never shown: a page printed and gone.
        // The CEF build's own two, which only its gate runs, placing each window on the
        // screen it photographs.
        let excused = ["pdf.rs", "engine.rs", "engine/gate.rs"];

        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut sources = vec![root.clone()];
        let mut unplaced = Vec::new();
        while let Some(at) = sources.pop() {
            for entry in std::fs::read_dir(&at)
                .expect("the crate's source")
                .flatten()
            {
                let path = entry.path();
                if path.is_dir() {
                    sources.push(path);
                    continue;
                }
                let name = path
                    .strip_prefix(&root)
                    .expect("under the source")
                    .to_string_lossy()
                    .replace('\\', "/");
                let text = std::fs::read_to_string(&path).unwrap_or_default();
                let builds = text.contains("WebviewWindowBuilder::new(")
                    || text.contains("WebviewWindowBuilder::from_config(");
                let placed =
                    text.contains("placement::built(") || text.contains("placement::built_away(");
                if builds && !placed && name != "placement.rs" && !excused.contains(&&*name) {
                    unplaced.push(name);
                }
            }
        }
        assert!(
            unplaced.is_empty(),
            "built past `placement::built`: {unplaced:?}"
        );
    }

    /// Nothing in the crate asks for the keyboard or the front but `raised` and
    /// `keyboard_to`, which both do nothing where a drive sent the windows away; and
    /// nothing asks Windows for the front at all. Read off the source for the same reason
    /// as the test above: a call that forgets is only ever found by the person whose
    /// typing it took. foreground.rs, which keeps a probe out of the front, is the one
    /// file that names the system's calls, and its test the one that makes them.
    #[test]
    fn nothing_takes_the_keyboard_or_the_front_past_the_guard() {
        let asks_the_system = [
            "SetForegroundWindow",
            "AllowSetForegroundWindow",
            "BringWindowToTop",
            "SetActiveWindow",
            "SwitchToThisWindow",
            "SetFocus",
            "SendInput",
            "keybd_event",
        ];
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut sources = vec![root.clone()];
        let mut found = Vec::new();
        while let Some(at) = sources.pop() {
            for entry in std::fs::read_dir(&at)
                .expect("the crate's source")
                .flatten()
            {
                let path = entry.path();
                if path.is_dir() {
                    sources.push(path);
                    continue;
                }
                let name = path
                    .strip_prefix(&root)
                    .expect("under the source")
                    .to_string_lossy()
                    .replace('\\', "/");
                if name == "placement.rs" || name == "foreground.rs" {
                    continue;
                }
                let text = std::fs::read_to_string(&path).unwrap_or_default();
                for (at, line) in text.lines().enumerate() {
                    let code = line.trim_start();
                    if code.starts_with("//") {
                        continue;
                    }
                    let named = asks_the_system.iter().any(|call| {
                        code.match_indices(call).any(|(from, _)| {
                            !code[..from].ends_with(|c: char| c.is_alphanumeric() || c == '_')
                        })
                    });
                    if code.contains(".set_focus()") || named {
                        found.push(format!("{name}:{}", at + 1));
                    }
                }
            }
        }
        assert!(
            found.is_empty(),
            "the keyboard or the front asked for past `raised` and `keyboard_to`: {found:?}"
        );
    }
}

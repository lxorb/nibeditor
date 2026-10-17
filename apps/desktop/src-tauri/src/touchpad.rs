//! How many fingers are on the precision touchpad, said to the window as they land and lift.
//!
//! Emil, 2026-10-12 (#209): *"the touchpad swipe still feels very unintuitive. e.g. it is
//! possible to swipe and trigger a "back" whilst not even released the touchpad"*. A page,
//! and the app's own page, hear two fingers on a touchpad as wheel events and nothing else:
//! nothing in them says when the fingers lift. So the swipe guessed - the wheel gone quiet
//! for a moment, or slowing the way a coast slows - and a hand held still past the distance,
//! or slowing down on the pad, was a hand let go of. Chrome never guesses: Windows hands it
//! the pad's own gesture, and it decides at the fling or the end that come as the fingers
//! leave. The window has no such gesture to be handed, because the pad's scroll reaches it
//! through the engine.
//!
//! What it can have is the pad's own reports. A precision touchpad is a HID digitizer,
//! and Windows hands any program that asks the raw reports of one (`RegisterRawInputDevices`
//! for the touch pad's collection, digitizer page 0x0D, usage 0x05): every frame says how
//! many contacts it holds, and for each whether it is touching (its tip switch). That is
//! read here, on a thread of its own with a window of its own that is never shown, into
//! one number - the fingers on the pad - and said as `nib://touchpad` each time it changes.
//! apps/desktop/src/lib/back-swipe/swipes.ts holds a touchpad's swipe to it: a gesture is
//! the time two fingers are down, and only their lift decides it.
//!
//! **Only while nib is in front.** The reports are the pad's whoever is in front, so a
//! finger landing while another program is is never said; a lift always is, once a landing
//! was. Nothing but the count leaves this file: not where the fingers are, not which.
//!
//! The reports are this process's and not the engine's. A pad that is not a precision one
//! sends no such reports, and a Mac and Linux have none of this; there the swipe ends when
//! the wheel goes quiet, as before.

// Elsewhere nothing but the tests reads any of it.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;

/// The event the window hears the fingers on.
const FINGERS: &str = "nib://touchpad";

/// What the window is told: how many fingers are on the pad now.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
pub struct Fingers {
    fingers: u32,
}

/// HID's digitizer page, and on it the touch pad's collection, a finger's collection in
/// it, the tip switch that says a finger is touching, and the contact count a frame starts
/// with.
const DIGITIZER: u16 = 0x0D;
const TOUCH_PAD: u16 = 0x05;
const FINGER: u16 = 0x22;
const TIP: u16 = 0x42;
const CONTACT_COUNT: u16 = 0x54;

/// The pad's reports, put back together into frames. A precision touchpad says a frame
/// either in one report with a collection for each finger, or over several, one finger
/// each ("hybrid"); either way the frame's first report carries its contact count and
/// the rest carry nought. A contact that is lifting is in its frame with its tip off.
#[derive(Debug, Default)]
pub struct Frames {
    /// How many contacts of the frame are still to come.
    left: u32,
    /// How many of those come so far are touching.
    down: u32,
}

impl Frames {
    /// One report: the contact count as it says it, and the tip switch of each finger
    /// collection in it, in order. Answers the fingers touching once a frame is whole,
    /// and nothing while one is still coming or for a report outside any frame.
    pub fn report(&mut self, count: u32, tips: &[bool]) -> Option<u32> {
        if count > 0 {
            self.left = count;
            self.down = 0;
        }
        if self.left == 0 {
            return None;
        }
        for &tip in tips.iter().take(self.left as usize) {
            self.down += u32::from(tip);
            self.left -= 1;
        }
        (self.left == 0).then_some(self.down)
    }
}

/// What to tell the window, if anything, when a frame says `fingers` and the window was
/// last told `told`: a change, and while nib is not in front (`ours` false) nothing but
/// a lift.
#[must_use]
pub fn telling(told: u32, fingers: u32, ours: bool) -> Option<u32> {
    let now = if ours { fingers } else { 0 };
    (now != told).then_some(now)
}

/// Starts reading the pad, from now until the app quits. Only the first call does
/// anything.
#[cfg(windows)]
pub fn start(app: &tauri::AppHandle) {
    raw::start(app);
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "a touchpad's own reports reach a program only as raw input, read through user32 and hid.dll"
)]
mod raw {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::OnceLock;

    use tauri::{AppHandle, Emitter};
    use windows::core::w;
    use windows::Win32::Devices::HumanInterfaceDevice::{
        HidP_GetCaps, HidP_GetLinkCollectionNodes, HidP_GetUsageValue, HidP_GetUsages, HidP_Input,
        HIDP_CAPS, HIDP_LINK_COLLECTION_NODE, HIDP_STATUS_SUCCESS, PHIDP_PREPARSED_DATA,
    };
    use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::Input::{
        GetRawInputData, GetRawInputDeviceInfoW, RegisterRawInputDevices, HRAWINPUT, RAWINPUT,
        RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK, RIDI_PREPARSEDDATA, RID_INPUT,
        RIM_TYPEHID,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetForegroundWindow, GetMessageW,
        GetWindowThreadProcessId, RegisterClassW, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_INPUT, WNDCLASSW,
    };

    use super::{
        telling, Fingers, Frames, CONTACT_COUNT, DIGITIZER, FINGER, FINGERS, TIP, TOUCH_PAD,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// One pad: what Windows says of the shape of its reports, which of their collections
    /// are fingers, and its frames so far.
    struct Pad {
        /// The pad's preparsed data, kept in `u64`s for the alignment hid.dll reads it with.
        shape: Vec<u64>,
        fingers: Vec<u16>,
        frames: Frames,
    }

    /// Everything the thread keeps: each pad by its handle, and what the window was last
    /// told.
    #[derive(Default)]
    struct Kept {
        pads: HashMap<isize, Option<Pad>>,
        told: u32,
    }

    thread_local! {
        static KEPT: RefCell<Kept> = RefCell::new(Kept::default());
    }

    pub fn start(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        let _ = std::thread::Builder::new()
            .name("touchpad".into())
            .spawn(listen);
    }

    /// The thread: a window of its own that is only ever a mailbox, the pad's reports asked
    /// for it, and its messages answered for the rest of the run.
    fn listen() {
        // Safe: every call is on this thread, about a window this thread makes and keeps
        // for as long as it lives.
        unsafe {
            let Ok(module) = GetModuleHandleW(None) else {
                return;
            };
            let class = WNDCLASSW {
                lpfnWndProc: Some(heard),
                hInstance: module.into(),
                lpszClassName: w!("nib-touchpad"),
                ..Default::default()
            };
            if RegisterClassW(&raw const class) == 0 {
                return;
            }
            let Ok(window) = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("nib-touchpad"),
                w!(""),
                WINDOW_STYLE::default(),
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                None,
                module,
                None,
            ) else {
                return;
            };
            // Whoever is in front, so a lift is heard after nib has gone behind; what is
            // said while it is behind is decided in `telling`.
            let pad = RAWINPUTDEVICE {
                usUsagePage: DIGITIZER,
                usUsage: TOUCH_PAD,
                dwFlags: RIDEV_INPUTSINK,
                hwndTarget: window,
            };
            let size = u32::try_from(size_of::<RAWINPUTDEVICE>()).unwrap_or(0);
            if RegisterRawInputDevices(&[pad], size).is_err() {
                return;
            }
            let mut message = MSG::default();
            while GetMessageW(&raw mut message, HWND::default(), 0, 0).as_bool() {
                DispatchMessageW(&raw const message);
            }
        }
    }

    unsafe extern "system" fn heard(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_INPUT {
            read(HRAWINPUT(lparam.0 as _));
        }
        // Safe: the message as it came, to the default handling, which also lets Windows
        // free what it kept for a `WM_INPUT`.
        unsafe { DefWindowProcW(window, message, wparam, lparam) }
    }

    /// One `WM_INPUT`: the reports in it, put into frames, and the window told of a change.
    fn read(input: HRAWINPUT) {
        let header = u32::try_from(size_of::<RAWINPUTHEADER>()).unwrap_or(0);
        let mut size = 0u32;
        // Safe: asks only how many bytes there are.
        if unsafe { GetRawInputData(input, RID_INPUT, None, &raw mut size, header) } != 0 {
            return;
        }
        let bytes = size as usize;
        if bytes < size_of::<RAWINPUT>() {
            return;
        }
        let mut buffer = vec![0u64; bytes.div_ceil(8)];
        // Safe: the buffer holds `size` bytes, aligned for a `RAWINPUT`.
        let wrote = unsafe {
            GetRawInputData(
                input,
                RID_INPUT,
                Some(buffer.as_mut_ptr().cast()),
                &raw mut size,
                header,
            )
        };
        if wrote == u32::MAX || wrote as usize > bytes {
            return;
        }
        // Safe: Windows wrote a `RAWINPUT` at the start of the buffer, which is big enough
        // for one and aligned for it.
        let raw = unsafe { &*buffer.as_ptr().cast::<RAWINPUT>() };
        if raw.header.dwType != RIM_TYPEHID.0 {
            return;
        }
        // Safe: a HID's input, as the type says.
        let hid = unsafe { raw.data.hid };
        let each = hid.dwSizeHid as usize;
        let count = hid.dwCount as usize;
        let start = std::mem::offset_of!(RAWINPUT, data)
            + std::mem::offset_of!(windows::Win32::UI::Input::RAWHID, bRawData);
        let Some(end) = each
            .checked_mul(count)
            .and_then(|all| all.checked_add(start))
        else {
            return;
        };
        if each == 0 || end > bytes {
            return;
        }
        // Safe: the reports follow the header inside what Windows wrote, as checked above.
        let all = unsafe {
            std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>().add(start), each * count)
        };
        let device = raw.header.hDevice;

        let said = KEPT.with_borrow_mut(|kept| {
            let pad = kept
                .pads
                .entry(device.0 as isize)
                .or_insert_with(|| shape_of(device))
                .as_mut()?;
            let mut fingers = None;
            for report in all.chunks_exact(each) {
                let (count, tips) = report_of(pad, report);
                if let Some(now) = pad.frames.report(count, &tips) {
                    fingers = Some(now);
                }
            }
            let now = telling(kept.told, fingers?, in_front())?;
            kept.told = now;
            Some(now)
        });
        if let (Some(fingers), Some(app)) = (said, APP.get()) {
            let _ = app.emit(FINGERS, Fingers { fingers });
        }
    }

    /// What Windows says of a pad's reports, or `None` for a device it says nothing of or
    /// that has no finger in it, which is then never asked again.
    fn shape_of(device: HANDLE) -> Option<Pad> {
        let mut size = 0u32;
        // Safe: asks only how many bytes there are.
        unsafe { GetRawInputDeviceInfoW(device, RIDI_PREPARSEDDATA, None, &raw mut size) };
        if size == 0 {
            return None;
        }
        let mut shape = vec![0u64; (size as usize).div_ceil(8)];
        // Safe: the buffer holds `size` bytes.
        let wrote = unsafe {
            GetRawInputDeviceInfoW(
                device,
                RIDI_PREPARSEDDATA,
                Some(shape.as_mut_ptr().cast()),
                &raw mut size,
            )
        };
        if wrote == u32::MAX || wrote == 0 {
            return None;
        }
        let parsed = PHIDP_PREPARSED_DATA(shape.as_ptr() as isize);
        let mut caps = HIDP_CAPS::default();
        // Safe: the preparsed data Windows just wrote, and a place for its answer.
        if unsafe { HidP_GetCaps(parsed, &raw mut caps) } != HIDP_STATUS_SUCCESS {
            return None;
        }
        let mut length = u32::from(caps.NumberLinkCollectionNodes);
        let mut nodes = vec![HIDP_LINK_COLLECTION_NODE::default(); length as usize];
        // Safe: room for as many nodes as the caps say there are.
        if unsafe { HidP_GetLinkCollectionNodes(nodes.as_mut_ptr(), &raw mut length, parsed) }
            != HIDP_STATUS_SUCCESS
        {
            return None;
        }
        let fingers: Vec<u16> = nodes
            .iter()
            .take(length as usize)
            .enumerate()
            .filter(|(_, node)| node.LinkUsagePage == DIGITIZER && node.LinkUsage == FINGER)
            .filter_map(|(at, _)| u16::try_from(at).ok())
            .collect();
        (!fingers.is_empty()).then(|| Pad {
            shape,
            fingers,
            frames: Frames::default(),
        })
    }

    /// One report's contact count, and each finger collection's tip switch, in order.
    fn report_of(pad: &Pad, report: &[u8]) -> (u32, Vec<bool>) {
        let parsed = PHIDP_PREPARSED_DATA(pad.shape.as_ptr() as isize);
        let mut count = 0u32;
        // Safe: the pad's own preparsed data and one of its reports. A report without the
        // count, one continuing a frame, leaves it nought.
        let found = unsafe {
            HidP_GetUsageValue(
                HidP_Input,
                DIGITIZER,
                0,
                CONTACT_COUNT,
                &raw mut count,
                parsed,
                report,
            )
        };
        if found != HIDP_STATUS_SUCCESS {
            count = 0;
        }
        let mut copy = report.to_vec();
        let tips = pad
            .fingers
            .iter()
            .map(|&link| {
                let mut usages = [0u16; 16];
                let mut length = u32::try_from(usages.len()).unwrap_or(0);
                // Safe: room for `length` usages, and the report copied so hid.dll may
                // write over it as its signature allows.
                let status = unsafe {
                    HidP_GetUsages(
                        HidP_Input,
                        DIGITIZER,
                        link,
                        usages.as_mut_ptr(),
                        &raw mut length,
                        parsed,
                        &mut copy,
                    )
                };
                status == HIDP_STATUS_SUCCESS
                    && usages.iter().take(length as usize).any(|&one| one == TIP)
            })
            .collect();
        (count, tips)
    }

    /// Whether the window in front is one of nib's own.
    fn in_front() -> bool {
        // Safe: a window handle out, and the process that owns it.
        unsafe {
            let front = GetForegroundWindow();
            let mut owner = 0u32;
            GetWindowThreadProcessId(front, Some(&raw mut owner));
            owner != 0 && owner == GetCurrentProcessId()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{telling, Fingers, Frames};

    #[test]
    fn a_frame_in_one_report_is_its_fingers_touching() {
        let mut frames = Frames::default();
        // Five finger collections a report, two contacts, both touching.
        assert_eq!(
            frames.report(2, &[true, true, false, false, false]),
            Some(2)
        );
        // Lifting: both in the frame, tips off.
        assert_eq!(
            frames.report(2, &[false, false, false, false, false]),
            Some(0)
        );
    }

    #[test]
    fn a_frame_over_several_reports_is_whole_only_at_its_last() {
        let mut frames = Frames::default();
        assert_eq!(frames.report(3, &[true]), None);
        assert_eq!(frames.report(0, &[true]), None);
        assert_eq!(frames.report(0, &[false]), Some(2));
        // A report outside any frame says nothing.
        assert_eq!(frames.report(0, &[true]), None);
    }

    #[test]
    fn a_report_beyond_its_frame_s_count_is_not_read() {
        let mut frames = Frames::default();
        // One contact, though the report has room for three and junk in the rest.
        assert_eq!(frames.report(1, &[true, true, true]), Some(1));
    }

    #[test]
    fn the_window_hears_changes_and_only_a_lift_while_nib_is_behind() {
        assert_eq!(telling(0, 2, true), Some(2));
        assert_eq!(telling(2, 2, true), None);
        assert_eq!(telling(2, 0, true), Some(0));
        // Behind: a landing is not said, and a lift is.
        assert_eq!(telling(0, 2, false), None);
        assert_eq!(telling(2, 2, false), Some(0));
    }

    #[test]
    fn the_window_is_told_in_its_own_words() {
        assert_eq!(
            serde_json::to_value(Fingers { fingers: 2 }).expect("fingers are said as JSON"),
            serde_json::json!({ "fingers": 2 })
        );
    }
}

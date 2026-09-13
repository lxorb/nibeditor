//! The one requirement that decides the whole architecture.
//!
//! CEF on macOS insists that the process's `NSApplication` be an instance of a
//! subclass conforming to `CefAppProtocol`, so that Chromium can tell whether it
//! is inside `-sendEvent:` - it needs that to run nested event loops without
//! reentering itself. There is no way to add the conformance to an
//! `NSApplication` that already exists, and `NSApp` is created by whichever code
//! touches AppKit first.
//!
//! So in a process where anything else has already made an `NSApplication` - a
//! window toolkit, say - CEF cannot start. Tauri's own CEF runtime hit exactly
//! this and had to close a pull request over it: *"Native recovery dialogs can
//! create an NSApplication object before the CEF runtime starts. CEF then rejects
//! the incompatible application class and stops startup."*
//! (<https://github.com/tauri-apps/tauri/pull/15990>)
//!
//! Which is why the choice in docs/browser.md is between *the whole app being a
//! CEF app* and *CEF living in a process of its own*, and is never "add CEF to the
//! process nib already has". The assertion at the bottom of this file is that
//! decision, written as code.
//!
//! Ported from cef-rs's `cefsimple` example (Apache-2.0 OR MIT),
//! <https://github.com/tauri-apps/cef-rs/tree/dev/examples/cefsimple/src/mac>,
//! with the menu bar and the application delegate left out: the spike has no menu
//! and quits itself when its last browser closes.

use cef::application_mac::{CefAppProtocol, CrAppControlProtocol, CrAppProtocol};
use objc2::runtime::Bool;
use objc2::{define_class, extern_methods, msg_send, rc::Retained, ClassType, DefinedClass};
use objc2_app_kit::{NSApp, NSApplication, NSEvent};
use objc2_foundation::MainThreadMarker;
use std::cell::Cell;

/// Whether this application is inside `-sendEvent:` right now. That single bit is
/// the whole of what `CefAppProtocol` is for.
#[derive(Default)]
pub struct SpikeApplicationIvars {
    handling_send_event: Cell<Bool>,
}

define_class!(
    /// An `NSApplication` that CEF will accept.
    #[unsafe(super(NSApplication))]
    #[ivars = SpikeApplicationIvars]
    pub struct SpikeApplication;

    impl SpikeApplication {
        #[unsafe(method(sendEvent:))]
        unsafe fn send_event(&self, event: &NSEvent) {
            let was_sending = self.ivars().handling_send_event.get();
            if !was_sending.as_bool() {
                self.ivars().handling_send_event.set(Bool::YES);
            }

            let _: () = msg_send![super(self), sendEvent: event];

            if !was_sending.as_bool() {
                self.ivars().handling_send_event.set(Bool::NO);
            }
        }
    }

    unsafe impl CrAppControlProtocol for SpikeApplication {
        #[unsafe(method(setHandlingSendEvent:))]
        unsafe fn _set_handling_send_event(&self, handling_send_event: Bool) {
            self.ivars().handling_send_event.set(handling_send_event);
        }
    }

    unsafe impl CrAppProtocol for SpikeApplication {
        #[unsafe(method(isHandlingSendEvent))]
        unsafe fn _is_handling_send_event(&self) -> Bool {
            self.ivars().handling_send_event.get()
        }
    }

    unsafe impl CefAppProtocol for SpikeApplication {}
);

impl SpikeApplication {
    extern_methods!(
        #[unsafe(method(sharedApplication))]
        fn shared_application() -> Retained<Self>;
    );
}

/// Make the shared application, and prove nothing else made one first.
pub fn install_application() {
    let _ = SpikeApplication::shared_application();

    let mtm = MainThreadMarker::new().expect("CEF has to be set up on the main thread");
    assert!(
        NSApp(mtm).isKindOfClass(SpikeApplication::class()),
        "something made an NSApplication before CEF did, and CEF will not accept it"
    );
}

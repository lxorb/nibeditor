//! Printing a note to a PDF file without a print dialog.
//!
//! The finished page is loaded into a window nobody sees and printed from there: no
//! dialog, no browser header and footer, and the paper from the app's own settings.
//! Each engine is asked in its own words. `WebView2` can print a page straight to a
//! file. `WKWebView` hands out an `NSPrintOperation` for its page, and an operation
//! told to save rather than print, with its panels switched off, is the same thing:
//! the paper, the margins and the page breaks are the ones a print would have, which
//! is what a PDF of a note is for. `WebKitGTK` offers only its print panel, so on
//! Linux this says it cannot help and the window falls back to that panel.
//!
//! And on nib's own Chromium - the `cef` feature, off in everything that ships -
//! neither system engine is there any more, so the one call this module makes into
//! it is not there to make: the printer here says no and the window falls back to
//! the panel, exactly as it does on Linux. Chromium's own `PrintToPDF` is the answer
//! and it is batch 6's; see docs/browser.md.

use serde::Deserialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

use crate::clock;
use crate::paths::cannot;

/// How long the page is given to lay itself out before it is measured for paper.
/// Fonts and pictures are already inside it; this is the layout settling.
const SETTLE: Duration = Duration::from_millis(300);

/// How long a print may take before the window gives up and says so.
const PATIENCE: Duration = Duration::from_secs(45);

/// Two prints in the same millisecond still get their own window and their own
/// temp file.
static PRINTS: AtomicU32 = AtomicU32::new(0);

/// The sheet a PDF is laid out on, in inches. Given upright; the printer turns it
/// when the page is landscape.
///
/// Only the two system engines that can print to a file read the fields; elsewhere
/// `print_pdf` is a stub, so the Linux runner's clippy would otherwise refuse them as
/// dead code.
#[cfg_attr(
    any(not(any(windows, target_os = "macos")), feature = "cef"),
    allow(dead_code)
)]
#[derive(Clone, Deserialize)]
pub struct PdfPage {
    /// The width of the sheet, in inches.
    pub width: f64,
    /// The height of the sheet, in inches.
    pub height: f64,
    /// The margin on all four sides, in inches.
    pub margin: f64,
    /// Whether the sheet is turned on its side.
    pub landscape: bool,
}

/// Whether `print_pdf` can write a file here. `WebView2` can print to a file
/// without a dialog, and so can `WKWebView` from macOS 11, where it first hands out
/// a print operation; `WebKitGTK` only offers its print panel.
#[tauri::command]
pub fn pdf_supported() -> bool {
    printer::available()
}

/// One inch in the unit `AppKit` measures paper in, the `PostScript` point.
#[cfg(any(test, all(target_os = "macos", not(feature = "cef"))))]
const POINTS_PER_INCH: f64 = 72.0;

/// The sheet as `AppKit` is handed it: width, height and the margin, in points, with
/// the sheet already turned for a landscape page. `NSPrintInfo` takes the paper as it
/// lies rather than upright plus a flag, and a landscape note given an upright sheet
/// comes out as a portrait page with its lines cut off at the side.
#[cfg(any(test, all(target_os = "macos", not(feature = "cef"))))]
fn sheet_in_points(page: &PdfPage) -> (f64, f64, f64) {
    // A sheet that already lies on its side - a plane on its own paper, as wide as
    // the drawing - was never upright, so there is nothing to turn.
    let (width, height) = if page.landscape && page.width < page.height {
        (page.height, page.width)
    } else {
        (page.width, page.height)
    };

    (
        width * POINTS_PER_INCH,
        height * POINTS_PER_INCH,
        page.margin.max(0.0) * POINTS_PER_INCH,
    )
}

/// Loads a finished page in a window nobody sees and asks the webview's own print
/// engine for a PDF. The page comes in complete, pictures and fonts inside it, so
/// nothing has to be fetched. It goes through a temporary file because the webview
/// will not take a page this size as a string.
#[tauri::command]
pub async fn print_pdf(
    app: AppHandle,
    html: String,
    output: String,
    page: PdfPage,
) -> Result<(), String> {
    if !pdf_supported() {
        return Err("printing to a file is not available here".into());
    }

    let job = format!(
        "{}-{}-{}",
        std::process::id(),
        clock::now(),
        PRINTS.fetch_add(1, Ordering::Relaxed)
    );
    let path = std::env::temp_dir().join(format!("nib-print-{job}.html"));
    std::fs::write(&path, html).map_err(|error| cannot("write", &path, &error))?;

    // Every road out from here takes the temp file with it. The file is the whole
    // note, pictures and all, and the temp folder is not where a note belongs a
    // moment longer than the print needs it.
    let Ok(url) = tauri::Url::from_file_path(&path) else {
        let _ = std::fs::remove_file(&path);
        return Err(format!("could not address {}", path.display()));
    };

    let (done, waited) = mpsc::channel::<Result<(), String>>();
    // The load event can come more than once; the page is printed once.
    let printed = Arc::new(AtomicBool::new(false));

    let window = WebviewWindowBuilder::new(&app, format!("print-{job}"), WebviewUrl::External(url))
        .title("Nib")
        .visible(false)
        .inner_size(900.0, 1200.0)
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished || printed.swap(true, Ordering::SeqCst) {
                return;
            }

            let done = done.clone();
            let output = output.clone();
            let page = page.clone();

            std::thread::spawn(move || {
                std::thread::sleep(SETTLE);

                let failed = done.clone();
                let asked = window.with_webview(move |webview| {
                    if let Err(error) = printer::print(&webview, &output, &page, done) {
                        let _ = failed.send(Err(error));
                    }
                });

                if let Err(error) = asked {
                    give_up(&window, &error.to_string());
                }
            });
        })
        .build();

    let window = match window {
        Ok(window) => window,
        Err(error) => {
            let _ = std::fs::remove_file(&path);
            return Err(format!("could not open a window to print in: {error}"));
        }
    };

    let waiting = tauri::async_runtime::spawn_blocking(move || waited.recv_timeout(PATIENCE)).await;

    let _ = window.destroy();
    let _ = std::fs::remove_file(&path);

    waiting
        .map_err(|error| format!("the print was interrupted: {error}"))?
        .unwrap_or_else(|_| Err("the PDF took too long to write".into()))
}

/// A failure before the printer was even reached cannot use the channel the
/// closure took with it; closing the window makes the wait give up instead.
fn give_up(window: &tauri::WebviewWindow, error: &str) {
    eprintln!("print_pdf: {error}");
    let _ = window.destroy();
}

#[cfg(all(windows, not(feature = "cef")))]
mod printer {
    use super::PdfPage;
    use std::sync::mpsc::Sender;
    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, HSTRING};

    /// `WebView2` can always print to a file; it is the reason this module exists.
    pub fn available() -> bool {
        true
    }

    /// A Windows error as a sentence.
    fn describe(error: windows_core::Error) -> String {
        error.to_string()
    }

    /// Asks `WebView2` for the PDF. The answer arrives later, on the channel.
    #[allow(
        unsafe_code,
        reason = "WebView2's print engine is reached through its COM interfaces"
    )]
    pub fn print(
        webview: &PlatformWebview,
        output: &str,
        page: &PdfPage,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        // Safe: every handle comes from the webview this window owns, and the
        // handler below outlives the call because WebView2 holds it.
        unsafe {
            let controller = webview.controller();
            // A hidden window leaves its webview asleep, and a sleeping webview
            // never finishes a print.
            controller.SetIsVisible(true).map_err(describe)?;

            let core = controller.CoreWebView2().map_err(describe)?;
            let printer: ICoreWebView2_7 = core.cast().map_err(describe)?;
            let environment: ICoreWebView2Environment6 =
                webview.environment().cast().map_err(describe)?;

            let settings = environment.CreatePrintSettings().map_err(describe)?;
            settings
                .SetOrientation(if page.landscape {
                    COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                } else {
                    COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                })
                .map_err(describe)?;
            settings.SetPageWidth(page.width).map_err(describe)?;
            settings.SetPageHeight(page.height).map_err(describe)?;
            settings.SetMarginTop(page.margin).map_err(describe)?;
            settings.SetMarginBottom(page.margin).map_err(describe)?;
            settings.SetMarginLeft(page.margin).map_err(describe)?;
            settings.SetMarginRight(page.margin).map_err(describe)?;
            settings.SetScaleFactor(1.0).map_err(describe)?;
            // Tinted code and callouts are part of the page; the browser's own
            // title and URL lines are not.
            settings.SetShouldPrintBackgrounds(true).map_err(describe)?;
            settings
                .SetShouldPrintHeaderAndFooter(false)
                .map_err(describe)?;

            let target = HSTRING::from(output);
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, written| {
                let _ = done.send(match result {
                    Err(error) => Err(error.to_string()),
                    Ok(()) if !written => Err("the PDF could not be written".into()),
                    Ok(()) => Ok(()),
                });
                Ok(())
            }));

            printer
                .PrintToPdf(&target, &settings, &handler)
                .map_err(describe)
        }
    }
}

/// `WKWebView`'s printing, told to save a file instead of printing one.
///
/// Two ways in were weighed. `createPDFWithConfiguration:completionHandler:` is the
/// simpler call and the wrong one: it draws the page as one sheet as tall as the
/// document, with no paper, no margins and no page breaks - a screenshot in a PDF
/// rather than a printed note. `printOperationWithPrintInfo:` is the engine's own
/// print path, the one Safari's File > Export as PDF goes through: it lays the page
/// out on the paper it is given, honours `break-before` and the print stylesheet, and
/// writes one PDF page per sheet. So the operation it is, with its two panels
/// switched off and `NSPrintSaveJob` as what to do with the result.
///
/// Two things it needs that are not in its documentation, both well known from
/// everybody else who has done this. It must be run with
/// `runOperationModalForWindow:...` and not `runOperation`: the engine lays out the
/// pages in another process and answers asynchronously, and the synchronous call
/// comes back with blank sheets. And the view the operation prints through has to be
/// given the webview's frame, or it has none and every page is blank as well.
#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod printer {
    use super::{sheet_in_points, PdfPage};
    use std::cell::{Cell, RefCell};
    use std::ffi::c_void;
    use std::sync::mpsc::Sender;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject};
    use objc2::{define_class, msg_send, sel, ClassType, DefinedClass, MainThreadOnly};
    use objc2_app_kit::{
        NSPaperOrientation, NSPrintHeaderAndFooter, NSPrintInfo, NSPrintJobSavingURL,
        NSPrintOperation, NSPrintSaveJob, NSPrintingPaginationMode, NSWindow,
    };
    use objc2_foundation::{MainThreadMarker, NSNumber, NSObjectProtocol, NSSize, NSString, NSURL};
    use objc2_web_kit::WKWebView;
    use tauri::webview::PlatformWebview;

    /// Whether this `WebKit` can print a page it holds: macOS 11 and later. Asked of
    /// the class rather than of the system's version, because the method is the
    /// thing that has to be there.
    pub fn available() -> bool {
        WKWebView::class().responds_to(sel!(printOperationWithPrintInfo:))
    }

    /// What the operation reports back to: where the file was to go, and the one
    /// answer the caller is waiting for.
    struct Waiting {
        output: String,
        done: Cell<Option<Sender<Result<(), String>>>>,
    }

    define_class!(
        /// The operation's delegate, which is how `AppKit` says a modal print is over.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "NibPdfPrinted"]
        #[ivars = Waiting]
        struct Printed;

        impl Printed {
            /// `AppKit` calls this once the operation has finished, whether it wrote
            /// anything or not.
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn did_run(
                &self,
                _operation: &NSPrintOperation,
                success: bool,
                _context: *mut c_void,
            ) {
                let Some(done) = self.ivars().done.take() else {
                    return;
                };

                // A job that says it succeeded and left no file behind did not, and
                // the caller is about to tell somebody their PDF is where they asked.
                let written = std::path::Path::new(&self.ivars().output).is_file();
                let _ = done.send(if success && written {
                    Ok(())
                } else {
                    Err("the PDF could not be written".into())
                });
            }
        }
    );

    impl Printed {
        #[allow(
            unsafe_code,
            reason = "an Objective-C object is initialised through its superclass"
        )]
        fn new(
            mtm: MainThreadMarker,
            output: &str,
            done: Sender<Result<(), String>>,
        ) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Waiting {
                output: output.to_owned(),
                done: Cell::new(Some(done)),
            });
            // SAFETY: `init` is `NSObject`'s own initialiser, called once on an object
            // that has just been allocated and given its instance variables.
            unsafe { msg_send![super(this), init] }
        }

        /// Whether `AppKit` has reported back yet.
        fn answered(&self) -> bool {
            let done = self.ivars().done.take();
            let answered = done.is_none();
            self.ivars().done.set(done);
            answered
        }
    }

    thread_local! {
        /// The delegates of the prints in the air. `AppKit` does not keep an
        /// operation's delegate alive, so something here has to until it has been
        /// called - and a delegate cannot be let go of from inside its own callback,
        /// so the ones already answered are cleared as the next print starts. The main
        /// thread's only, like everything else `AppKit` hands out.
        static PRINTING: RefCell<Vec<Retained<Printed>>> = const { RefCell::new(Vec::new()) };
    }

    /// Sets the operation going. The answer arrives later, on the channel, once the
    /// engine has laid out every page and `AppKit` has written them.
    #[allow(
        unsafe_code,
        reason = "WKWebView's print operation is reached through the Objective-C runtime, from the pointer wry hands out"
    )]
    pub fn print(
        webview: &PlatformWebview,
        output: &str,
        page: &PdfPage,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let mtm =
            MainThreadMarker::new().ok_or("the print was not asked for on the main thread")?;

        // SAFETY: both pointers are the ones wry built for the print window, which is
        // alive until `print_pdf` has its answer; retaining them keeps them so for as
        // long as this holds them. `with_webview` runs this on the main thread, which
        // is where both of them belong.
        let (view, window) = unsafe {
            (
                Retained::retain(webview.inner().cast::<WKWebView>()),
                Retained::retain(webview.ns_window().cast::<NSWindow>()),
            )
        };
        let (Some(view), Some(window)) = (view, window) else {
            return Err("there was no page to print".into());
        };

        let (width, height, margin) = sheet_in_points(page);

        // A print info of its own rather than the shared one, which is the app's and
        // which a print dialog elsewhere would then open on this paper.
        let info = NSPrintInfo::new();
        // Orientation before the paper: `AppKit` turns the paper when the orientation
        // changes, and the paper given here is already the way it lies.
        info.setOrientation(if page.landscape {
            NSPaperOrientation::Landscape
        } else {
            NSPaperOrientation::Portrait
        });
        info.setPaperSize(NSSize::new(width, height));
        info.setTopMargin(margin);
        info.setBottomMargin(margin);
        info.setLeftMargin(margin);
        info.setRightMargin(margin);
        info.setScalingFactor(1.0);
        info.setHorizontallyCentered(false);
        info.setVerticallyCentered(false);
        info.setHorizontalPagination(NSPrintingPaginationMode::Automatic);
        info.setVerticalPagination(NSPrintingPaginationMode::Automatic);

        // SAFETY: the keys are `AppKit`'s own and each value is the type its key is
        // documented to take - a file URL, a boolean number. The job disposition is
        // `AppKit`'s own constant.
        unsafe {
            info.setJobDisposition(NSPrintSaveJob);
            let settings = info.dictionary();
            let target = NSURL::fileURLWithPath(&NSString::from_str(output));
            settings.insert(NSPrintJobSavingURL, target.as_ref() as &AnyObject);
            // The browser's own title and URL lines are not part of a note, as on
            // Windows.
            settings.insert(
                NSPrintHeaderAndFooter,
                NSNumber::new_bool(false).as_ref() as &AnyObject,
            );
        }

        // SAFETY: the webview is alive and on its own thread, and every object below is
        // used here and nowhere else.
        let operation = unsafe {
            // Tinted code and callouts are part of the page, as on Windows. The print
            // stylesheet already asks for its colours to be kept exactly; this is the
            // engine's own switch for the same thing, which it has from macOS 13.3.
            let preferences = view.configuration().preferences();
            if preferences.respondsToSelector(sel!(setShouldPrintBackgrounds:)) {
                preferences.setShouldPrintBackgrounds(true);
            }

            view.printOperationWithPrintInfo(&info)
        };

        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        // Without a frame the operation's view prints nothing at all; see above.
        if let Some(printing) = operation.view() {
            printing.setFrame(view.frame());
        }

        let printed = Printed::new(mtm, output, done);
        PRINTING.with_borrow_mut(|held| {
            held.retain(|one| !one.answered());
            held.push(printed.clone());
        });

        // SAFETY: the delegate is an object this thread keeps alive until it has been
        // called, the selector is the one it implements with the signature `AppKit`
        // documents for it, and there is no context to pass. The window is the print
        // window's own, hidden, and no sheet is shown on it: both panels are off.
        unsafe {
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                &window,
                Some(printed.as_ref() as &AnyObject),
                Some(sel!(printOperationDidRun:success:contextInfo:)),
                std::ptr::null_mut(),
            );
        }

        Ok(())
    }
}

#[cfg(any(not(any(windows, target_os = "macos")), feature = "cef"))]
mod printer {
    use super::PdfPage;
    use std::sync::mpsc::Sender;
    use tauri::webview::PlatformWebview;

    /// Nothing here prints to a file; the window's print panel is the way.
    pub fn available() -> bool {
        false
    }

    /// Never reached: `print_pdf` says no before it gets this far.
    pub fn print(
        _webview: &PlatformWebview,
        _output: &str,
        _page: &PdfPage,
        _done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        Err("printing to a file is not available here".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{sheet_in_points, PdfPage};

    fn page(width: f64, height: f64, margin: f64, landscape: bool) -> PdfPage {
        PdfPage {
            width,
            height,
            margin,
            landscape,
        }
    }

    /// A4 upright, in points, with an inch of margin: the numbers `AppKit` expects.
    #[test]
    fn an_upright_sheet_is_measured_in_points() {
        let (width, height, margin) = sheet_in_points(&page(8.27, 11.69, 1.0, false));
        assert!((width - 595.44).abs() < 0.01);
        assert!((height - 841.68).abs() < 0.01);
        assert!((margin - 72.0).abs() < f64::EPSILON);
    }

    /// A landscape page is the same sheet on its side, because `NSPrintInfo` takes the
    /// paper the way it lies.
    #[test]
    fn a_landscape_sheet_is_turned() {
        let (width, height, _) = sheet_in_points(&page(8.5, 11.0, 0.5, true));
        assert!((width - 792.0).abs() < f64::EPSILON);
        assert!((height - 612.0).abs() < f64::EPSILON);
    }

    /// A plane's own paper is already as wide as the drawing, and turning it again
    /// would stand it upright.
    #[test]
    fn a_sheet_that_already_lies_on_its_side_is_left_alone() {
        let (width, height, margin) = sheet_in_points(&page(10.0, 5.0, 0.0, true));
        assert!((width - 720.0).abs() < f64::EPSILON);
        assert!((height - 360.0).abs() < f64::EPSILON);
        assert!(margin.abs() < f64::EPSILON);
    }

    /// A margin below nothing is no margin, not a page drawn off its own edge.
    #[test]
    fn a_negative_margin_is_none() {
        let (_, _, margin) = sheet_in_points(&page(8.5, 11.0, -1.0, false));
        assert!(margin.abs() < f64::EPSILON);
    }
}

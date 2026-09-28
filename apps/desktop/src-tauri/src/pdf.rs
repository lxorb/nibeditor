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
//! On a Mac the print dialog itself comes through here as well, because the window's
//! own road to it - `print()` in a frame - is one `WKWebView` ignores; see
//! `print_page`.
//!
//! And on nib's own Chromium - the `cef` feature, off in everything that ships -
//! neither system engine is there any more, so the one call this module makes into
//! it is not there to make: the printer here says no and the window falls back to
//! the panel, exactly as it does on Linux. Chromium's own `PrintToPDF` is the answer
//! and it is batch 6's; see docs/browser.md.

use serde::Deserialize;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::webview::{PageLoadEvent, PlatformWebview};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

use crate::clock;
use crate::paths::{cannot, chosen};

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

/// Whether the sheet, as `sheet_in_points` lays it, is wider than it is tall, which is
/// what `AppKit`'s orientation has to say. Not the page's own `landscape`: a deck's
/// sheet is sixteen by nine as it stands and says nothing about lying down, and told
/// "portrait" beside a paper wider than it is tall, `AppKit` stood the paper upright
/// and every slide came out small in the corner of a tall page.
#[cfg(any(test, all(target_os = "macos", not(feature = "cef"))))]
fn on_its_side(width: f64, height: f64) -> bool {
    width > height
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
    // Wherever the reader chose to save it, judged the way every writer of such a
    // choice judges it; see `chosen`.
    let output = chosen(&output)?.to_string_lossy().into_owned();

    in_hidden_window(&app, html, PATIENCE, move |webview, done| {
        printer::print(webview, &output, &page, done)
    })
    .await
    .map_err(|error| {
        if error == TOO_LONG {
            "the PDF took too long to write".into()
        } else {
            error
        }
    })
}

/// How long the system's print dialog may stay open before the hidden page behind it
/// is taken away. Somebody choosing a printer takes their time; an hour is the point at
/// which the dialog has been forgotten rather than considered.
#[cfg(all(target_os = "macos", not(feature = "cef")))]
const DIALOG_PATIENCE: Duration = Duration::from_secs(60 * 60);

/// What the wait says when the clock ran out before the engine answered.
const TOO_LONG: &str = "the print took too long";

/// The system's own print dialog for a finished page, on a Mac.
///
/// `window.print()` inside a frame is what the other desktops use for this, and
/// `WKWebView` ignores it: a frame's print goes to a UI delegate method wry does not
/// have, so nothing opened and the caller waited five minutes for an `afterprint` that
/// never came. The page is loaded into the same hidden window a PDF is written from,
/// and the print operation `WebKit` hands out for it is run with its panel showing, as
/// a sheet on the window that asked - the File > Print of `TextEdit` and Safari, with the
/// paper, the printer, the preview and the PDF menu the reader knows. `page` is the
/// paper the dialog opens on, from the app's settings; the dialog can change it.
#[tauri::command]
#[cfg_attr(
    not(all(target_os = "macos", not(feature = "cef"))),
    allow(
        clippy::unused_async,
        reason = "one signature for every platform; only a Mac has a dialog to wait for"
    )
)]
pub async fn print_page(
    webview: tauri::Webview,
    html: String,
    page: Option<PdfPage>,
) -> Result<(), String> {
    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    {
        use tauri::Manager as _;

        let app = webview.app_handle().clone();
        let parent = webview.window();
        in_hidden_window(&app, html, DIALOG_PATIENCE, move |view, done| {
            printer::dialog(view, &parent, page.as_ref(), done)
        })
        .await
    }

    #[cfg(not(all(target_os = "macos", not(feature = "cef"))))]
    {
        let _ = (webview, html, page);
        Err("the print dialog here is the page's own".into())
    }
}

/// Loads a finished page into a window nobody sees, and once it has laid itself out
/// hands its webview to `print`, which answers on the channel it is given. Waits at
/// most `patience` for that answer, then takes the window and the page away however
/// it went.
async fn in_hidden_window<F>(
    app: &AppHandle,
    html: String,
    patience: Duration,
    print: F,
) -> Result<(), String>
where
    F: FnOnce(&PlatformWebview, mpsc::Sender<Result<(), String>>) -> Result<(), String>
        + Send
        + 'static,
{
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
    // The load event can come more than once; the page is printed once, which is also
    // why the printer is held where the first load can take it.
    let print = Arc::new(Mutex::new(Some(print)));

    let building =
        WebviewWindowBuilder::new(app, format!("print-{job}"), WebviewUrl::External(url));

    // The same switches as the app's own window, which is running on the same user data
    // folder and would refuse a webview started any other way; see `engine::BROWSER_ARGS`.
    #[cfg(all(windows, not(feature = "cef")))]
    let building = building.additional_browser_args(crate::engine::BROWSER_ARGS);

    let window = building
        .title("Nib")
        .visible(false)
        .inner_size(900.0, 1200.0)
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let Some(print) = print.lock().ok().and_then(|mut held| held.take()) else {
                return;
            };

            let done = done.clone();

            std::thread::spawn(move || {
                std::thread::sleep(SETTLE);

                let failed = done.clone();
                let asked = window.with_webview(move |webview| {
                    if let Err(error) = print(&webview, done) {
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

    let waiting = tauri::async_runtime::spawn_blocking(move || waited.recv_timeout(patience)).await;

    let _ = window.destroy();
    let _ = std::fs::remove_file(&path);

    waiting
        .map_err(|error| format!("the print was interrupted: {error}"))?
        .unwrap_or_else(|_| Err(TOO_LONG.into()))
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
    use super::{on_its_side, sheet_in_points, PdfPage};
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
    use objc2_foundation::{
        MainThreadMarker, NSCopying as _, NSNumber, NSObjectProtocol, NSSize, NSString, NSURL,
    };
    use objc2_web_kit::WKWebView;
    use tauri::webview::PlatformWebview;

    /// Whether this `WebKit` can print a page it holds: macOS 11 and later. Asked of
    /// the class rather than of the system's version, because the method is the
    /// thing that has to be there.
    pub fn available() -> bool {
        WKWebView::class().responds_to(sel!(printOperationWithPrintInfo:))
    }

    /// What the operation reports back to: where the file was to go - nowhere, for a
    /// print dialog, where the reader chose - and the one answer the caller is waiting
    /// for.
    struct Waiting {
        output: Option<String>,
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

                let _ = done.send(match &self.ivars().output {
                    // A job that says it succeeded and left no file behind did not, and
                    // the caller is about to tell somebody their PDF is where they
                    // asked.
                    Some(output) if !(success && std::path::Path::new(output).is_file()) => {
                        Err("the PDF could not be written".into())
                    }
                    // A dialog somebody cancelled is a dialog answered: nothing went
                    // wrong, and there is nothing to say about it.
                    _ => Ok(()),
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
            output: Option<&str>,
            done: Sender<Result<(), String>>,
        ) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Waiting {
                output: output.map(str::to_owned),
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

    /// The print window's webview and window, held for as long as the print needs them.
    #[allow(
        unsafe_code,
        reason = "wry hands the webview and its window out as bare Objective-C pointers"
    )]
    fn held(
        webview: &PlatformWebview,
    ) -> Result<(Retained<WKWebView>, Retained<NSWindow>), String> {
        // SAFETY: both pointers are the ones wry built for the print window, which is
        // alive until the caller has its answer; retaining them keeps them so for as
        // long as this holds them. `with_webview` runs this on the main thread, which
        // is where both of them belong.
        let (view, window) = unsafe {
            (
                Retained::retain(webview.inner().cast::<WKWebView>()),
                Retained::retain(webview.ns_window().cast::<NSWindow>()),
            )
        };
        view.zip(window)
            .ok_or_else(|| "there was no page to print".into())
    }

    /// The paper from the app's settings, on a print info.
    fn lay_out(info: &NSPrintInfo, page: &PdfPage) {
        let (width, height, margin) = sheet_in_points(page);

        // Orientation before the paper: `AppKit` turns the paper when the orientation
        // changes, and the paper given here is already the way it lies.
        info.setOrientation(if on_its_side(width, height) {
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
    }

    /// The engine's print operation for the page, with backgrounds and without the
    /// browser's header and footer, and with the frame it needs to print anything.
    #[allow(
        unsafe_code,
        reason = "WKWebView's print operation is reached through the Objective-C runtime"
    )]
    fn operation(view: &WKWebView, info: &NSPrintInfo) -> Retained<NSPrintOperation> {
        // SAFETY: the key is `AppKit`'s own and the value the boolean number it takes;
        // the webview is alive and on its own thread, and every object below is used
        // here and nowhere else.
        let operation = unsafe {
            // The browser's own title and URL lines are not part of a note, as on
            // Windows.
            info.dictionary().insert(
                NSPrintHeaderAndFooter,
                NSNumber::new_bool(false).as_ref() as &AnyObject,
            );

            // Tinted code and callouts are part of the page, as on Windows. The print
            // stylesheet already asks for its colours to be kept exactly; this is the
            // engine's own switch for the same thing, which it has from macOS 13.3.
            let preferences = view.configuration().preferences();
            if preferences.respondsToSelector(sel!(setShouldPrintBackgrounds:)) {
                preferences.setShouldPrintBackgrounds(true);
            }

            view.printOperationWithPrintInfo(info)
        };

        // Without a frame the operation's view prints nothing at all; see above.
        if let Some(printing) = operation.view() {
            printing.setFrame(view.frame());
        }
        operation
    }

    /// Runs the operation as a sheet on `window` - which, with both panels off, shows
    /// nothing at all - and says on the channel when it is over.
    #[allow(
        unsafe_code,
        reason = "a modal print reports back through an Objective-C selector"
    )]
    fn run(
        operation: &NSPrintOperation,
        window: &NSWindow,
        output: Option<&str>,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let mtm =
            MainThreadMarker::new().ok_or("the print was not asked for on the main thread")?;

        let printed = Printed::new(mtm, output, done);
        PRINTING.with_borrow_mut(|held| {
            held.retain(|one| !one.answered());
            held.push(printed.clone());
        });

        // SAFETY: the delegate is an object this thread keeps alive until it has been
        // called, the selector is the one it implements with the signature `AppKit`
        // documents for it, and there is no context to pass.
        unsafe {
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                window,
                Some(printed.as_ref() as &AnyObject),
                Some(sel!(printOperationDidRun:success:contextInfo:)),
                std::ptr::null_mut(),
            );
        }
        Ok(())
    }

    /// Sets the operation going, saving to `output`. The answer arrives later, on the
    /// channel, once the engine has laid out every page and `AppKit` has written them.
    #[allow(
        unsafe_code,
        reason = "a print info's save settings are an Objective-C dictionary"
    )]
    pub fn print(
        webview: &PlatformWebview,
        output: &str,
        page: &PdfPage,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let (view, window) = held(webview)?;

        // A print info of its own rather than the shared one, which is the app's and
        // which a print dialog elsewhere would then open on this paper.
        let info = NSPrintInfo::new();
        lay_out(&info, page);

        // SAFETY: the key is `AppKit`'s own and the value the file URL it takes; the
        // job disposition is `AppKit`'s own constant.
        unsafe {
            info.setJobDisposition(NSPrintSaveJob);
            let target = NSURL::fileURLWithPath(&NSString::from_str(output));
            info.dictionary()
                .insert(NSPrintJobSavingURL, target.as_ref() as &AnyObject);
        }

        let operation = operation(&view, &info);
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);

        // The print window's own, hidden: no sheet is shown on it, both panels are off.
        run(&operation, &window, Some(output), done)
    }

    /// The system's print dialog for the page, as a sheet on `parent`. The answer
    /// arrives on the channel when the dialog has closed, printed or cancelled.
    pub fn dialog(
        webview: &PlatformWebview,
        parent: &tauri::Window,
        page: Option<&PdfPage>,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let (view, _) = held(webview)?;
        let parent = parent
            .ns_window()
            .ok()
            .and_then(|pointer| {
                // SAFETY: the pointer is the `NSWindow` tauri built for the window
                // that asked, alive while it is, and retaining it keeps it so.
                #[allow(unsafe_code, reason = "tauri hands a window out as a bare pointer")]
                unsafe {
                    Retained::retain(pointer.cast::<NSWindow>())
                }
            })
            .ok_or("there is no window to show the print dialog on")?;

        // The shared print info is where the dialog remembers the reader's printer and
        // paper between prints, so it opens on a copy of that - with the app's own paper
        // over it where the caller knows it, which is what the page was laid out for.
        let info = NSPrintInfo::sharedPrintInfo().copy();
        if let Some(page) = page {
            lay_out(&info, page);
        }

        let operation = operation(&view, &info);
        operation.setShowsPrintPanel(true);
        operation.setShowsProgressPanel(true);

        run(&operation, &parent, None, done)
    }

    /// The system's print dialog for a page that is already on screen - a web tab's -
    /// as a sheet on the window it is in. Nobody waits for the answer: the dialog is
    /// the reader's from here.
    pub fn sheet(webview: &PlatformWebview) -> Result<(), String> {
        let (view, window) = held(webview)?;
        let operation = operation(&view, &NSPrintInfo::sharedPrintInfo().copy());
        operation.setShowsPrintPanel(true);
        operation.setShowsProgressPanel(true);

        let (done, _) = std::sync::mpsc::channel();
        run(&operation, &window, None, done)
    }
}

/// The system's print dialog for a page already on screen; see `printer::sheet`. A
/// web tab's Print row reaches it, because the page's own `window.print()` is Tauri's
/// on a Mac - a call into the app that a site's origin is refused.
#[cfg(all(target_os = "macos", not(feature = "cef")))]
pub(crate) fn print_sheet(webview: &PlatformWebview) -> Result<(), String> {
    printer::sheet(webview)
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
    use super::{on_its_side, sheet_in_points, PdfPage};

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

    /// A deck's sheet is sixteen by nine without saying it lies down, and it is still
    /// on its side, as is any turned sheet; an upright one is not.
    #[test]
    fn a_wide_sheet_is_on_its_side_whatever_the_page_says() {
        let (width, height, _) = sheet_in_points(&page(1280.0 / 96.0, 720.0 / 96.0, 0.0, false));
        assert!((width - 960.0).abs() < 0.01);
        assert!((height - 540.0).abs() < 0.01);
        assert!(on_its_side(width, height));

        let (width, height, _) = sheet_in_points(&page(8.5, 11.0, 0.5, true));
        assert!(on_its_side(width, height));

        let (width, height, _) = sheet_in_points(&page(8.27, 11.69, 1.0, false));
        assert!(!on_its_side(width, height));
    }

    /// A margin below nothing is no margin, not a page drawn off its own edge.
    #[test]
    fn a_negative_margin_is_none() {
        let (_, _, margin) = sheet_in_points(&page(8.5, 11.0, -1.0, false));
        assert!(margin.abs() < f64::EPSILON);
    }
}

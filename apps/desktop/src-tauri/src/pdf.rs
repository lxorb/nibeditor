//! Printing a note to a PDF file without a print dialog.
//!
//! `WebView2` can print a page straight to a file, so on Windows the finished
//! page is loaded into a window nobody sees and printed from there: no dialog, no
//! browser header and footer, and the paper from the app's own settings. `WebKit`
//! offers only its print panel, so everywhere else this says it cannot help and
//! the window falls back to that panel.
//!
//! And on nib's own Chromium - the `cef` feature, off in everything that ships -
//! `WebView2` is not the engine any more, so the one call this module makes into it
//! is not there to make: the printer here says no and the window falls back to the
//! panel, exactly as it does on a Mac. Chromium's own `PrintToPDF` is the answer and
//! it is batch 6's; see docs/browser.md.

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
/// Only `WebView2` reads the fields; elsewhere `print_pdf` is a stub, so the
/// Linux runner's clippy would otherwise refuse them as dead code.
#[cfg_attr(any(not(windows), feature = "cef"), allow(dead_code))]
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
/// without a dialog; `WebKit` only offers its print panel.
#[tauri::command]
pub fn pdf_supported() -> bool {
    cfg!(all(windows, not(feature = "cef")))
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

#[cfg(any(not(windows), feature = "cef"))]
mod printer {
    use super::PdfPage;
    use std::sync::mpsc::Sender;
    use tauri::webview::PlatformWebview;

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

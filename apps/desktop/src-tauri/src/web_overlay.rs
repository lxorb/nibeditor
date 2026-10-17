//! Places Linux web-tab pages over the app's webview instead of beside it in GTK's box.
//!
//! `Window::add_child` puts every child in one GTK box. When the app adds a browser page,
//! GTK shares the box's height between the app and the page, ignoring the page's bounds.
//! The page therefore appears in the lower half of the window. Move it into an overlay
//! that wraps the box and size it there in the window's own layout pixels.

/// Puts a page over the window's app webview at GTK's own pixel coordinates, on GTK's
/// event-loop thread.
pub fn page_over(view: &tauri::Webview, (left, top, width, height): (i32, i32, u32, u32)) {
    let _ = view.with_webview(move |platform| {
        use gtk::glib::object::Cast as _;
        let page: gtk::Widget = platform.inner().upcast();
        over(&page, left, top, width, height);
    });
}

fn over(page: &gtk::Widget, left: i32, top: i32, width: u32, height: u32) {
    use gtk::glib::object::{Cast as _, ObjectExt as _};
    use gtk::prelude::{ContainerExt as _, OverlayExt as _, WidgetExt as _};

    let Some(parent) = page.parent() else {
        return;
    };
    if !parent.is::<gtk::Overlay>() {
        let Ok(column) = parent.downcast::<gtk::Box>() else {
            return;
        };
        let Some(overlay) = overlay_round(&column) else {
            return;
        };
        column.remove(page);
        // Bounds are measured from the window's top left, even in right-to-left locales.
        page.set_direction(gtk::TextDirection::Ltr);
        page.set_halign(gtk::Align::Start);
        page.set_valign(gtk::Align::Start);
        overlay.add_overlay(page);
    }
    page.set_margin_start(left.max(0));
    page.set_margin_top(top.max(0));
    page.set_size_request(
        i32::try_from(width).unwrap_or(i32::MAX),
        i32::try_from(height).unwrap_or(i32::MAX),
    );
}

/// Wraps the box that owns the window's main webview in an overlay, once.
fn overlay_round(column: &gtk::Box) -> Option<gtk::Overlay> {
    use gtk::glib::object::Cast as _;
    use gtk::prelude::{ContainerExt as _, WidgetExt as _};

    let holder = column.parent()?;
    if let Ok(overlay) = holder.clone().downcast::<gtk::Overlay>() {
        return Some(overlay);
    }
    let holder = holder.downcast::<gtk::Container>().ok()?;
    let overlay = gtk::Overlay::new();
    holder.remove(column);
    overlay.add(column);
    holder.add(&overlay);
    overlay.show();
    Some(overlay)
}

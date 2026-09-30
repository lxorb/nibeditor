//! Web pages another program hands nib, because nib is the browser.
//!
//! A link clicked in a mail, a chat, a PDF or a terminal goes to whichever program the
//! system keeps for `http` and `https`. When that is nib (see `default_browser.rs`), the
//! address arrives on a command line on Windows and Linux - a launch of its own, or a
//! second launch handed to the one already open - and as the system's "open these" on
//! a Mac. This module says which of what arrived is a page; launch.rs says which window
//! shows it.
//!
//! Only a page. The system hands over whatever string the other program wrote, and nib
//! opens no file from outside its spaces: a path, a `file:` address, `javascript:`,
//! another program's scheme and the app's own origins are all refused here, before any
//! window hears of them. What is left is judged again by the tab on every navigation;
//! see `allowed` in `web_tabs.rs`.

use tauri::Url;

/// What a launch Windows makes for a link says in front of the address: the command
/// nib registers for its links is `"nib.exe" --url "%1"`; see `default_browser.rs`.
pub const LINK_FLAG: &str = "--url";

/// The longest address taken, which is the longest command line Windows can start a
/// program with. Nothing somebody clicked is longer.
const LONGEST: usize = 32 * 1024;

/// Whether a command line is one Windows made for a link. Such a launch is about that
/// address and nothing else, so nothing else on it is ever read as a note to open:
/// the guard Chrome's `--single-argument` is, against a link that smuggles a quote
/// into its address to add an argument of its own.
pub fn for_a_link(args: &[String]) -> bool {
    args.iter().skip(1).any(|one| one == LINK_FLAG)
}

/// The pages a command line asks for.
///
/// After the flag, the rest is one address. The single instance plugin hands a second
/// launch's arguments over joined with `|` and splits them again, so an address with
/// a `|` in it arrives in pieces, and so does one somebody smuggled a quote into.
/// Joined back, the first is the address the other program wrote, and the second is
/// an address on the same site rather than a path on this disk.
///
/// Without the flag - a Linux handler's `%u`, somebody typing `nib https://...` in a
/// terminal - every argument that is a page is one, in the order given.
pub fn pages_in(args: &[String]) -> Vec<String> {
    let given = args.get(1..).unwrap_or_default();
    if let Some(at) = given.iter().position(|one| one == LINK_FLAG) {
        return page(&given[at + 1..].join("|")).into_iter().collect();
    }

    given.iter().filter_map(|one| page(one)).collect()
}

/// The pages among what a Mac was asked to open. A `file:` address among them is a
/// document, which takes the files' road; see lifecycle.rs.
#[cfg_attr(
    not(target_os = "macos"),
    allow(
        dead_code,
        reason = "only a Mac hands addresses over as addresses; the rule is tested everywhere"
    )
)]
pub fn pages_among(urls: &[Url]) -> Vec<String> {
    urls.iter().filter_map(|url| page(url.as_str())).collect()
}

/// The address as a tab opens it, or `None` for anything that is not a page on the
/// web: `http` or `https`, somewhere, and not the app itself.
fn page(said: &str) -> Option<String> {
    if said.len() > LONGEST {
        return None;
    }

    let url = Url::parse(said).ok()?;
    let web = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| !host.is_empty());

    (web && crate::web_tabs::allowed(&url)).then(|| url.to_string())
}

#[cfg(test)]
mod tests {
    use super::{for_a_link, pages_among, pages_in, LINK_FLAG};
    use tauri::Url;

    fn line(args: &[&str]) -> Vec<String> {
        std::iter::once("nib.exe")
            .chain(args.iter().copied())
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn a_link_windows_hands_over_is_one_page() {
        let args = line(&[LINK_FLAG, "https://example.com/a?b=1#c"]);
        assert_eq!(pages_in(&args), vec!["https://example.com/a?b=1#c"]);
        assert!(for_a_link(&args));
    }

    #[test]
    fn a_terminal_may_name_several_in_order() {
        let args = line(&["https://one.example", "--verbose", "http://two.example/x"]);
        assert_eq!(
            pages_in(&args),
            vec!["https://one.example/", "http://two.example/x"]
        );
        assert!(!for_a_link(&args));
    }

    #[test]
    fn only_a_page_on_the_web_is_taken() {
        for refused in [
            r"C:\Users\me\Notes\Idea.md",
            "/home/me/Notes/Idea.md",
            "file:///C:/Users/me/Notes/Idea.md",
            "FILE:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>1</script>",
            "nib://open?path=Idea.md",
            "mailto:me@example.com",
            "view-source:https://example.com",
            "ms-settings:defaultapps",
            "smb://server/share",
            "https://tauri.localhost/",
            "http://ipc.localhost/plugin",
            "http://",
            "https:",
            "example.com",
            "",
        ] {
            assert!(
                pages_in(&line(&[refused])).is_empty(),
                "{refused} was taken"
            );
            assert!(
                pages_in(&line(&[LINK_FLAG, refused])).is_empty(),
                "{refused} was taken after the flag"
            );
        }
    }

    #[test]
    fn a_scheme_in_capitals_is_still_the_web() {
        assert_eq!(
            pages_in(&line(&["HTTPS://Example.COM/Path"])),
            vec!["https://example.com/Path"]
        );
    }

    #[test]
    fn a_bar_in_the_address_survives_the_hand_over() {
        // What the single instance plugin makes of `https://example.com/?q=a|b`.
        let args = line(&[LINK_FLAG, "https://example.com/?q=a", "b"]);
        assert_eq!(pages_in(&args), vec!["https://example.com/?q=a|b"]);
    }

    #[test]
    fn a_smuggled_argument_stays_part_of_the_address() {
        // `https://example.com/" "C:\secret.md`, split by Windows at the quotes.
        let args = line(&[LINK_FLAG, "https://example.com/", r"C:\secret.md"]);
        let pages = pages_in(&args);

        assert_eq!(pages.len(), 1);
        assert!(pages[0].starts_with("https://example.com/"));
        // And nothing else on a link's command line is read as a note.
        assert!(for_a_link(&args));
    }

    #[test]
    fn nothing_after_the_flag_is_nothing() {
        assert!(pages_in(&line(&[LINK_FLAG])).is_empty());
        assert!(pages_in(&["nib.exe".to_owned()]).is_empty());
        assert!(pages_in(&[]).is_empty());
    }

    #[test]
    fn an_address_longer_than_a_command_line_is_refused() {
        let long = format!("https://example.com/{}", "a".repeat(40 * 1024));
        assert!(pages_in(&line(&[&long])).is_empty());
    }

    #[test]
    fn a_mac_hands_over_its_pages_and_keeps_its_files() {
        let urls = [
            Url::parse("file:///Users/me/Notes/Idea.md").expect("an address"),
            Url::parse("https://example.com/").expect("an address"),
            Url::parse("nib://search").expect("an address"),
            Url::parse("http://example.org/x").expect("an address"),
        ];
        assert_eq!(
            pages_among(&urls),
            vec!["https://example.com/", "http://example.org/x"]
        );
    }
}

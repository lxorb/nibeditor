//! Nib as the default browser: listed among the browsers, one press to become the
//! default, and whether it is.
//!
//! Emil, 2026-09-30: *"I would like to use nib as my default browser, so it should
//! definitely be possible to set it up with a single click in settings, without any
//! annoying manual configuration (you can do the same in Chrome already)."*
//!
//! No system lets a program make itself the default quietly, and each asks in its own
//! way, so the press does what Chrome's does on each:
//!
//! - **Windows** seals the choice with a hash only its own Settings writes, and a
//!   driver guards the keys, so the press registers nib and opens nib's own page under
//!   Settings > Default apps, where Windows asks. What that page lists is the
//!   registration below, written by both installers and put back at launch.
//! - **A Mac** asks with a dialog of its own when a program asks to open `http` and
//!   `https`, which the bundle declares; see tauri.macos.conf.json.
//! - **Linux** asks nobody: the press writes nib's handler and makes it the default
//!   for the two schemes.
//!
//! Only the two schemes, everywhere. Not `.htm`, `.html`, `public.html` or `text/html`,
//! which a browser usually claims as well, because nib opens no file from outside its
//! spaces and a saved page is one. What that costs on Windows 11: its one-press Set
//! default button is for programs that claim all four, so nib's page may ask for HTTP
//! and HTTPS one at a time instead.
//!
//! A build that is not the one shipped - a development build, a probe under an
//! identifier of its own - never registers and never asks. It would list a copy of nib
//! that is about to be deleted, over the one somebody installed.

use tauri::AppHandle;

/// The identifier of the app that ships; see `ships`.
const SHIPPED: &str = "ch.emilvinu.nib";

/// What `http` and `https` point at on Windows: the kind of document a web address is
/// to nib, which says how to start it.
#[cfg_attr(
    not(any(windows, test)),
    allow(dead_code, reason = "only Windows keeps a registry of programs")
)]
const PROG_ID: &str = "NibURL";

/// What Default apps says about nib, beside its name.
#[cfg_attr(
    not(any(windows, test)),
    allow(dead_code, reason = "only Windows keeps a registry of programs")
)]
const DESCRIPTION: &str = "Notes and the web in one window.";

/// Whether nib opens `http` and `https` links now. Both, because a system with only
/// one of the two sends half of every link somewhere else.
#[tauri::command(async)]
pub fn default_browser(app: AppHandle) -> bool {
    platform::is_default(&app)
}

/// Asks the system to make nib the default browser, the way that system asks; see the
/// top of this file. Answers once the question is up, not once it is answered: the
/// window asks `default_browser` again when it has the keyboard back.
#[tauri::command(async)]
pub fn make_default_browser(app: AppHandle) -> Result<(), String> {
    if !ships(&app) {
        return Err("only the installed app can be the default browser".into());
    }

    platform::make_default(&app)
}

/// Puts nib back among the browsers when the registration is missing or names a copy
/// that is gone: a portable copy moved, Scoop's new version in a new folder, an MSI
/// installed by another person on this machine. On a thread of its own, after the
/// window is up, so it costs a launch nothing. Windows only: a Mac's is in the bundle,
/// and Linux's is written by the press.
pub fn keep_registered(app: &AppHandle) {
    #[cfg(windows)]
    if ships(app) {
        let name = app.package_info().name.clone();
        let _ = std::thread::Builder::new()
            .name("browser registration".into())
            .spawn(move || platform::repair(&name));
    }
    #[cfg(not(windows))]
    let _ = app;
}

/// Whether this is the app somebody installed: a release, under the shipped
/// identifier, and not a probe sent off the screen.
fn ships(app: &AppHandle) -> bool {
    !cfg!(debug_assertions)
        && app.config().identifier == SHIPPED
        && crate::placement::away().is_none()
}

/// One value the registration writes: under which key, by which name (empty is the
/// key's own), and what.
#[cfg_attr(
    not(any(windows, test)),
    allow(dead_code, reason = "only Windows keeps a registry of programs")
)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct Value {
    key: String,
    name: String,
    data: String,
}

/// Everything Windows reads to list nib among the browsers, for the copy at `exe`,
/// under the product's name `app`.
///
/// Chrome's shape, read off an installed Chrome: a client under `StartMenuInternet`
/// whose capabilities say which schemes it takes and under which `ProgID`, the `ProgID`
/// saying how to start it, and `RegisteredApplications` pointing Default apps at the
/// capabilities. Two differences. The schemes are the web's two and there is no file
/// type at all. And the command marks the launch as a link's, so nothing else on its
/// command line is read (see `for_a_link` in `web_handed.rs`), which is the job Chrome's
/// `--single-argument` does.
#[cfg_attr(
    not(any(windows, test)),
    allow(dead_code, reason = "only Windows keeps a registry of programs")
)]
fn registration(app: &str, exe: &str) -> Vec<Value> {
    let client = format!(r"Software\Clients\StartMenuInternet\{app}");
    let capabilities = format!(r"{client}\Capabilities");
    let class = format!(r"Software\Classes\{PROG_ID}");
    let icon = format!("{exe},0");
    let link = crate::web_handed::LINK_FLAG;

    [
        (client.clone(), "", app.to_owned()),
        (format!(r"{client}\DefaultIcon"), "", icon.clone()),
        (
            format!(r"{client}\shell\open\command"),
            "",
            format!("\"{exe}\""),
        ),
        (capabilities.clone(), "ApplicationName", app.to_owned()),
        (
            capabilities.clone(),
            "ApplicationDescription",
            DESCRIPTION.to_owned(),
        ),
        (capabilities.clone(), "ApplicationIcon", icon.clone()),
        (
            format!(r"{capabilities}\Startmenu"),
            "StartMenuInternet",
            app.to_owned(),
        ),
        (
            format!(r"{capabilities}\URLAssociations"),
            "http",
            PROG_ID.to_owned(),
        ),
        (
            format!(r"{capabilities}\URLAssociations"),
            "https",
            PROG_ID.to_owned(),
        ),
        (class.clone(), "", format!("{app} URL")),
        (
            format!(r"{class}\Application"),
            "ApplicationName",
            app.to_owned(),
        ),
        (
            format!(r"{class}\Application"),
            "ApplicationIcon",
            icon.clone(),
        ),
        (format!(r"{class}\DefaultIcon"), "", icon),
        (
            format!(r"{class}\shell\open\command"),
            "",
            format!("\"{exe}\" {link} \"%1\""),
        ),
        (
            r"Software\RegisteredApplications".to_owned(),
            app,
            capabilities,
        ),
    ]
    .into_iter()
    .map(|(key, name, data)| Value {
        key,
        name: name.to_owned(),
        data,
    })
    .collect()
}

/// The program a registered command starts: the quoted path at its front.
#[cfg_attr(
    not(any(windows, test)),
    allow(dead_code, reason = "only Windows keeps a registry of programs")
)]
fn exe_of(command: &str) -> Option<String> {
    let rest = command.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_owned()).filter(|exe| !exe.is_empty())
}

/// The names nib's desktop entry has, whichever package put it there: the handler the
/// press writes (named by the deep link plugin after the binary), Tauri's own package,
/// and the Flathub, Snap, AUR and Nix ones under packaging/.
#[cfg_attr(
    not(any(target_os = "linux", test)),
    allow(dead_code, reason = "only Linux names a program by its desktop entry")
)]
const ENTRIES: [&str; 4] = [
    "nib-handler.desktop",
    "nib.desktop",
    "ch.emilvinu.nib.desktop",
    "nib_nib.desktop",
];

/// Whether a desktop entry the system named is nib's.
#[cfg_attr(
    not(any(target_os = "linux", test)),
    allow(dead_code, reason = "only Linux names a program by its desktop entry")
)]
fn is_ours(entry: &str) -> bool {
    ENTRIES
        .iter()
        .any(|one| one.eq_ignore_ascii_case(entry.trim()))
}

#[cfg(windows)]
mod platform {
    use super::{exe_of, registration, Value, PROG_ID};
    use std::path::Path;
    use tauri::AppHandle;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::UI::Shell::{AssocQueryStringW, ASSOCF_IS_PROTOCOL, ASSOCSTR_PROGID};
    use windows_registry::{Key, CURRENT_USER};

    /// Whether the shell opens both schemes with nib's `ProgID`.
    pub fn is_default(_app: &AppHandle) -> bool {
        ["http", "https"]
            .into_iter()
            .all(|scheme| handler_of(scheme).as_deref() == Some(PROG_ID))
    }

    /// Registers this copy - the person pressed the button in it, so it is the one they
    /// mean - and opens its page under Default apps. On the window's own thread, where
    /// the shell's objects can be made: Settings is a packaged app, and the shell
    /// reaches one through COM.
    pub fn make_default(app: &AppHandle) -> Result<(), String> {
        let exe =
            std::env::current_exe().map_err(|error| format!("could not find nib: {error}"))?;
        let name = app.package_info().name.clone();
        write(CURRENT_USER, &registration(&name, &exe.to_string_lossy()))?;

        let page = format!("ms-settings:defaultapps?registeredAppUser={name}");
        app.run_on_main_thread(move || {
            // Nothing to say if Windows will not open it: the row stays as it is, which
            // is the truth, and the press can be tried again.
            let _ = tauri_plugin_opener::open_url(page, None::<&str>);
        })
        .map_err(|error| format!("could not open Settings: {error}"))
    }

    /// Writes the registration for this copy unless one is whole already.
    pub fn repair(name: &str) {
        if whole(CURRENT_USER, name) {
            return;
        }
        if let Ok(exe) = std::env::current_exe() {
            let _ = write(CURRENT_USER, &registration(name, &exe.to_string_lossy()));
        }
    }

    /// Whether every value is there and the program it starts still exists. Another
    /// copy's whole registration counts: somebody may have chosen it on purpose.
    pub(super) fn whole(root: &Key, name: &str) -> bool {
        let Some(exe) = registered_exe(root) else {
            return false;
        };

        Path::new(&exe).is_file()
            && registration(name, &exe)
                .iter()
                .all(|value| read(root, value).as_deref() == Some(value.data.as_str()))
    }

    /// The program the registered `ProgID` starts.
    fn registered_exe(root: &Key) -> Option<String> {
        let command = root
            .open(format!(r"Software\Classes\{PROG_ID}\shell\open\command"))
            .ok()?
            .get_string("")
            .ok()?;
        exe_of(&command)
    }

    fn read(root: &Key, value: &Value) -> Option<String> {
        root.open(&value.key).ok()?.get_string(&value.name).ok()
    }

    pub(super) fn write(root: &Key, values: &[Value]) -> Result<(), String> {
        for value in values {
            root.create(&value.key)
                .and_then(|key| key.set_string(&value.name, &value.data))
                .map_err(|error| format!("could not register nib: {error}"))?;
        }
        Ok(())
    }

    /// The `ProgID` the shell opens a scheme with, as it resolves it: the choice Settings
    /// sealed wherever this version of Windows keeps it (`UserChoiceLatest` since 25H2,
    /// `UserChoice` before), then the machine's defaults. Asked rather than read out of
    /// the registry, because the key has moved once already.
    #[allow(
        unsafe_code,
        reason = "the shell's association query has no safe wrapper in the windows crate"
    )]
    pub(super) fn handler_of(scheme: &str) -> Option<String> {
        let asked: Vec<u16> = scheme.encode_utf16().chain(Some(0)).collect();
        let mut out = [0u16; 256];
        let mut room = u32::try_from(out.len()).ok()?;

        // SAFETY: `asked` is a null-terminated string that outlives the call, no extra
        // string is passed, and `out` holds `room` characters, which the call is told.
        let answer = unsafe {
            AssocQueryStringW(
                ASSOCF_IS_PROTOCOL,
                ASSOCSTR_PROGID,
                PCWSTR(asked.as_ptr()),
                PCWSTR::null(),
                PWSTR(out.as_mut_ptr()),
                &raw mut room,
            )
        };
        if answer.is_err() {
            return None;
        }

        let end = out.iter().position(|&one| one == 0).unwrap_or(out.len());
        Some(String::from_utf16_lossy(&out[..end])).filter(|id| !id.is_empty())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
    use objc2_foundation::{NSBundle, NSString, NSURL};
    use std::time::Duration;
    use tauri::AppHandle;

    /// The process that puts the system's questions on screen. A Mac does not always
    /// bring it forward itself, and a question behind the window is a question nobody
    /// answers; Chrome brings it forward for the same reason.
    const ASKER: &str = "com.apple.coreservices.uiagent";

    /// Whether the program the system opens both schemes with is this one.
    pub fn is_default(_app: &AppHandle) -> bool {
        let Some(ours) = NSBundle::mainBundle().bundleIdentifier() else {
            return false;
        };
        let ours = ours.to_string();
        let workspace = NSWorkspace::sharedWorkspace();

        ["http:", "https:"].into_iter().all(|scheme| {
            NSURL::URLWithString(&NSString::from_str(scheme))
                .and_then(|url| workspace.URLForApplicationToOpenURL(&url))
                .and_then(|app| NSBundle::bundleWithURL(&app))
                .and_then(|bundle| bundle.bundleIdentifier())
                .is_some_and(|id| id.to_string() == ours)
        })
    }

    /// Asks for both schemes, which the system turns into its one question: use nib, or
    /// keep the browser there is. Only from an app bundle, which is what the system
    /// files a handler under; a bare binary has nothing to name.
    pub fn make_default(_app: &AppHandle) -> Result<(), String> {
        let main = NSBundle::mainBundle();
        if main.bundleIdentifier().is_none() {
            return Err("only the installed app can be the default browser".into());
        }
        let workspace = NSWorkspace::sharedWorkspace();
        let bundle = main.bundleURL();
        for scheme in ["http", "https"] {
            workspace.setDefaultApplicationAtURL_toOpenURLsWithScheme_completionHandler(
                &bundle,
                &NSString::from_str(scheme),
                None,
            );
        }

        // The question comes up a moment later, in another process.
        let _ = std::thread::Builder::new()
            .name("browser question".into())
            .spawn(|| {
                std::thread::sleep(Duration::from_millis(300));
                let askers = NSRunningApplication::runningApplicationsWithBundleIdentifier(
                    &NSString::from_str(ASKER),
                );
                for asker in &askers {
                    let _ = asker
                        .activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows);
                }
            });
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::is_ours;
    use std::process::Command;
    use tauri::AppHandle;
    use tauri_plugin_deep_link::DeepLinkExt as _;

    /// Whether the desktop entry the system opens both schemes with is nib's.
    pub fn is_default(_app: &AppHandle) -> bool {
        ["http", "https"]
            .into_iter()
            .all(|scheme| handler_of(scheme).is_some_and(|entry| is_ours(&entry)))
    }

    /// Writes nib's handler for both schemes and makes it their default: the deep link
    /// plugin's own registration, which is a desktop entry with `%u` and the schemes as
    /// its types, then `xdg-mime default`. Not `xdg-settings set default-web-browser`,
    /// which hands the browser `text/html` files as well.
    pub fn make_default(app: &AppHandle) -> Result<(), String> {
        for scheme in ["http", "https"] {
            app.deep_link()
                .register(scheme)
                .map_err(|error| format!("could not become the default browser: {error}"))?;
        }
        Ok(())
    }

    fn handler_of(scheme: &str) -> Option<String> {
        let out = Command::new("xdg-mime")
            .args(["query", "default", &format!("x-scheme-handler/{scheme}")])
            .output()
            .ok()?;
        let entry = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        (!entry.is_empty()).then_some(entry)
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
mod platform {
    use tauri::AppHandle;

    pub fn is_default(_app: &AppHandle) -> bool {
        false
    }

    pub fn make_default(_app: &AppHandle) -> Result<(), String> {
        Err("this system has no default browser to be".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{exe_of, is_ours, registration, Value, PROG_ID};

    const EXE: &str = r"C:\Users\me\AppData\Local\Nib\nib.exe";

    fn values_under<'a>(table: &'a [Value], key: &str) -> Vec<&'a Value> {
        table.iter().filter(|one| one.key.ends_with(key)).collect()
    }

    #[test]
    fn nib_takes_the_two_web_schemes_and_nothing_else() {
        let table = registration("Nib", EXE);

        let schemes: Vec<&str> = values_under(&table, r"\URLAssociations")
            .iter()
            .map(|one| one.name.as_str())
            .collect();
        assert_eq!(schemes, ["http", "https"]);
        assert!(values_under(&table, r"\URLAssociations")
            .iter()
            .all(|one| one.data == PROG_ID));

        // No file type at all: a local page is a local file, which nib does not open.
        assert!(table
            .iter()
            .all(|one| !one.key.contains("FileAssociations")));
        assert!(table.iter().all(|one| !one.key.contains(".htm")));
    }

    #[test]
    fn a_link_starts_this_copy_and_says_it_is_a_link() {
        let table = registration("Nib", EXE);
        let command = table
            .iter()
            .find(|one| one.key == format!(r"Software\Classes\{PROG_ID}\shell\open\command"))
            .expect("a command for the ProgID");

        assert_eq!(command.data, format!("\"{EXE}\" --url \"%1\""));
        assert_eq!(exe_of(&command.data).as_deref(), Some(EXE));
    }

    #[test]
    fn default_apps_is_pointed_at_the_capabilities() {
        let table = registration("Nib", EXE);
        let listed = table
            .iter()
            .find(|one| one.key == r"Software\RegisteredApplications")
            .expect("an entry in RegisteredApplications");

        assert_eq!(listed.name, "Nib");
        assert_eq!(
            listed.data,
            r"Software\Clients\StartMenuInternet\Nib\Capabilities"
        );
        assert!(table.iter().any(|one| one.key == listed.data));
    }

    #[test]
    fn a_command_names_its_program_at_the_front() {
        assert_eq!(
            exe_of(r#""C:\a b\nib.exe" --url "%1""#).as_deref(),
            Some(r"C:\a b\nib.exe")
        );
        assert_eq!(exe_of(r"C:\nib.exe %1"), None);
        assert_eq!(exe_of(r#""" --url"#), None);
        assert_eq!(exe_of(r#""C:\nib.exe"#), None);
    }

    #[test]
    fn a_desktop_entry_is_ours_by_its_known_names() {
        assert!(is_ours("nib-handler.desktop\n"));
        assert!(is_ours("Nib.desktop"));
        assert!(is_ours("ch.emilvinu.nib.desktop"));
        assert!(!is_ours("firefox.desktop"));
        assert!(!is_ours("nibbles.desktop"));
        assert!(!is_ours(""));
    }

    /// The app's table in an installer's words: its name and its program written the
    /// way that installer writes them, and each value in its own syntax.
    fn in_words(app: &str, exe: &str, line: impl Fn(&Value) -> String) -> Vec<String> {
        registration(app, exe).iter().map(line).collect()
    }

    fn source(relative: &str) -> String {
        std::fs::read_to_string(crate::app_dir().join(relative)).expect("a file beside the crate")
    }

    #[test]
    fn the_installer_writes_what_the_app_writes() {
        let script = source("installer.nsh");
        let lines = in_words(
            r"${PRODUCTNAME}",
            r"$INSTDIR\${MAINBINARYNAME}.exe",
            |one| {
                // NSIS quotes with whichever quote the value does not hold.
                let data = if one.data.contains('"') {
                    format!("'{}'", one.data)
                } else {
                    format!("\"{}\"", one.data)
                };
                format!("WriteRegStr SHCTX \"{}\" \"{}\" {data}", one.key, one.name)
            },
        );

        for line in lines {
            assert!(script.contains(&line), "installer.nsh does not say: {line}");
        }
    }

    #[test]
    fn and_its_uninstaller_takes_all_of_it_away() {
        let script = source("installer.nsh");
        let uninstall = script
            .split("!macro NSIS_HOOK_POSTUNINSTALL")
            .nth(1)
            .expect("an uninstall hook");

        for line in [
            r#"DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}""#,
            &format!(r#"DeleteRegKey SHCTX "Software\Classes\{PROG_ID}""#),
            r#"DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}""#,
        ] {
            assert!(
                uninstall.contains(line),
                "the uninstaller does not say: {line}"
            );
        }
    }

    /// The product's name as tauri.conf.json says it, which is the name the app registers
    /// under at run time and the one the MSI's fragment has to spell out.
    fn product_name(config: &str) -> String {
        let parsed: serde_json::Value = serde_json::from_str(config).expect("the config");
        parsed["productName"]
            .as_str()
            .expect("a product name")
            .to_owned()
    }

    #[test]
    fn the_msi_writes_what_the_app_writes() {
        let fragment = source("wix/browser.wxs");
        let config = source("tauri.conf.json");
        let product = product_name(&config);
        let lines = in_words(&product, "[!Path]", |one| {
            let name = if one.name.is_empty() {
                String::new()
            } else {
                format!(" Name=\"{}\"", one.name)
            };
            format!(
                "<RegistryValue Root=\"HKCU\" Key=\"{}\"{name} Type=\"string\" Value=\"{}\"",
                one.key,
                one.data.replace('"', "&quot;")
            )
        });

        for line in lines {
            assert!(fragment.contains(&line), "browser.wxs does not say: {line}");
        }

        // And the bundle builds it into the MSI.
        assert!(config.contains(r#""fragmentPaths": ["wix/browser.wxs"]"#));
        assert!(config.contains(r#""componentRefs": ["NibBrowser"]"#));
        assert!(fragment.contains(r#"<Component Id="NibBrowser""#));
    }

    #[test]
    fn a_mac_bundle_asks_for_the_two_web_schemes() {
        let config = source("tauri.macos.conf.json");
        assert!(config.contains(r#""schemes": ["http", "https"]"#));
        assert!(config.contains(r#""schemes": ["nib"]"#));
        // Never HTML documents, which would be local files.
        assert!(!config.contains("public.html"));
        assert!(!config.contains("fileAssociations"));
    }

    /// The registration written and read back where nothing reads it: a key of its own
    /// under this person's hive, deleted afterwards whatever happened. Never the real
    /// one.
    #[cfg(windows)]
    #[test]
    fn a_registration_is_whole_until_a_value_or_its_program_goes() {
        use super::platform::{whole, write};
        use windows_registry::CURRENT_USER;

        /// The test's own key, gone with the test, passed or failed.
        struct Scratch(&'static str);
        impl Drop for Scratch {
            fn drop(&mut self) {
                let _ = CURRENT_USER.remove_tree(self.0);
            }
        }

        let scratch = Scratch(r"Software\nib-tests");
        let at = format!(r"{}\default-browser-{}", scratch.0, std::process::id());
        let root = CURRENT_USER.create(&at).expect("a test key");
        let exe = std::env::current_exe().expect("this test's own program");
        let exe = exe.to_string_lossy();

        assert!(!whole(&root, "Nib"), "an empty key was whole");

        write(&root, &registration("Nib", &exe)).expect("written");
        assert!(whole(&root, "Nib"));

        // One value gone: the https row.
        root.create(r"Software\Clients\StartMenuInternet\Nib\Capabilities\URLAssociations")
            .and_then(|key| key.remove_value("https"))
            .expect("a value removed");
        assert!(!whole(&root, "Nib"));

        // Whole again, for a program that is not there.
        write(&root, &registration("Nib", r"C:\nowhere\nib.exe")).expect("written");
        assert!(!whole(&root, "Nib"));
    }

    /// The shell answers which program opens a scheme: the one a scheme of the test's own
    /// names, and nothing for a scheme nothing registered. Asked of a scheme the test
    /// writes rather than of `https`, whose answer is the machine's - nib, on a machine
    /// where somebody made it the default browser.
    #[cfg(windows)]
    #[test]
    fn the_shell_is_asked_which_program_opens_the_web() {
        use super::platform::handler_of;
        use windows_registry::CURRENT_USER;

        /// The test's own scheme, gone with the test, passed or failed.
        struct Scratch(String);
        impl Drop for Scratch {
            fn drop(&mut self) {
                let _ = CURRENT_USER.remove_tree(format!(r"Software\Classes\{}", self.0));
            }
        }

        let scheme = format!("nib-test-{}", std::process::id());
        let scratch = Scratch(scheme.clone());
        assert_eq!(handler_of(&scheme), None, "a scheme nothing registered");

        let key = CURRENT_USER
            .create(format!(r"Software\Classes\{scheme}"))
            .expect("a test scheme");
        key.set_string("URL Protocol", "").expect("a protocol");
        key.create(r"shell\open\command")
            .and_then(|command| command.set_string("", r#""C:\nowhere\nib.exe" "%1""#))
            .expect("a command");
        assert_eq!(handler_of(&scheme), Some(scheme.clone()));

        drop(scratch);
        assert_eq!(handler_of(&scheme), None, "a scheme taken away");
        assert_eq!(handler_of("no-such-scheme-anywhere"), None);
    }
}

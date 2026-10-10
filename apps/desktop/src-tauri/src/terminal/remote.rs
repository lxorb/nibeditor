//! Another machine's shell in a tab: the system's own `ssh`, in the pty a local shell
//! would have, so keys, the agent, `ProxyJump`, a second factor and `known_hosts` all
//! work the way they do in any other terminal, and nib keeps no password and speaks no
//! SSH of its own. See docs/terminal.md, _Another machine_.
//!
//! **A host is an id to the window**, as a shell is (see shells.rs): `ssh:pi` names a
//! host of the reader's `~/.ssh/config` (`ssh_config.rs`) and `ssh:n-...` one made in nib,
//! and the program, its arguments and the destination are this module's. A host made in
//! nib is a name, a user, an address and a port, each held to what a destination can be
//! before it is kept and again before it is used, and handed to `ssh` after `--`, so
//! nothing the window keeps can be read as an option.
//!
//! **The config is never written.** Its hosts are mirrors, re-read each time the list
//! is asked for, so an edit shows at once; what nib knows besides - a colour, a group, a
//! pin, when one was last connected to, and the hosts made in nib - is one file in the
//! app's local data folder, `remote/hosts.json`, which never syncs: which machines a
//! person reaches is this computer's business.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, Webview};

use super::shells::Launch;
use super::ssh_config::{self, ConfigHost};

/// What a host's id starts with in a terminal's words, in place of a shell's id.
pub const PREFIX: &str = "ssh:";

/// What the id of a host made in nib starts with, so it can never be read as a name in
/// the config.
const OWN: &str = "n-";

/// How much the file may hold: far more than anybody has hosts, and a bound on what a
/// window can make the crate write.
const MOST_HOSTS: usize = 500;
const MOST_WORDS: usize = 200;

/// A host made in nib.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Own {
    pub id: String,
    pub name: String,
    pub hostname: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

/// What nib knows about one host, from the config or its own.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct About {
    /// One of the canvas's six colours, `1` to `6`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colour: Option<String>,
    /// The group it was put in here, which goes before the one the config says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    /// When it was last connected to, in milliseconds since 1970.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<u64>,
}

/// The file: the hosts made here, what is known about each host, the order Settings
/// put them in and the groups in theirs.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Kept {
    #[serde(default)]
    pub own: Vec<Own>,
    #[serde(default)]
    pub about: BTreeMap<String, About>,
    #[serde(default)]
    pub order: Vec<String>,
    #[serde(default)]
    pub groups: Vec<String>,
}

/// What the window is told: the config's hosts, what is kept, and where the config is,
/// for Settings' Open config - None where there is no file to open.
#[derive(Serialize)]
pub struct Hosts {
    config: Vec<ConfigHost>,
    kept: Kept,
    file: Option<String>,
}

/// The id a terminal's shell names a host by, or None for a shell.
pub fn host_id(shell: &str) -> Option<&str> {
    shell.strip_prefix(PREFIX).filter(|one| !one.is_empty())
}

/// Whether a word is fit to be in the file: not too long, no control characters.
fn plain(word: &str) -> bool {
    !word.trim().is_empty()
        && word.chars().count() <= MOST_WORDS
        && !word.chars().any(char::is_control)
}

/// An address `ssh` can be handed as a destination: a name or an IP address, v6 with
/// its zone, and never anything that starts like an option.
pub fn is_address(address: &str) -> bool {
    !address.is_empty()
        && address.len() <= 253
        && !address.starts_with('-')
        && address.bytes().all(|one| {
            one.is_ascii_alphanumeric() || matches!(one, b'.' | b'-' | b'_' | b':' | b'%')
        })
}

/// A user name `ssh -l` can be handed: what an account name is made of on the three
/// systems, a domain's `\` and an `@` among them, and never an option.
pub fn is_user(user: &str) -> bool {
    !user.is_empty()
        && user.len() <= 64
        && !user.starts_with('-')
        && user.bytes().all(|one| {
            one.is_ascii_alphanumeric() || matches!(one, b'.' | b'-' | b'_' | b'@' | b'\\' | b'$')
        })
}

/// Whether an id is one nib makes for its own hosts.
fn is_own_id(id: &str) -> bool {
    id.starts_with(OWN)
        && id.len() <= 64
        && id[OWN.len()..]
            .bytes()
            .all(|one| one.is_ascii_alphanumeric() || one == b'-' || one == b'_')
        && id.len() > OWN.len()
}

/// What the window asked to keep, held to what the file may hold, or why not.
pub fn checked(kept: Kept) -> Result<Kept, String> {
    if kept.own.len() > MOST_HOSTS || kept.about.len() > MOST_HOSTS * 2 {
        return Err("too many hosts".to_owned());
    }
    for own in &kept.own {
        let fits = is_own_id(&own.id)
            && plain(&own.name)
            && is_address(&own.hostname)
            && own.user.as_deref().is_none_or(is_user)
            && own.port.is_none_or(|port| port > 0);
        if !fits {
            return Err(format!("{:?} is not a host", own.name));
        }
    }
    for (id, about) in &kept.about {
        let fits = plain(id)
            && about
                .colour
                .as_deref()
                .is_none_or(|one| matches!(one, "1" | "2" | "3" | "4" | "5" | "6"))
            && about.group.as_deref().is_none_or(plain);
        if !fits {
            return Err(format!("{id:?} is not a host"));
        }
    }
    let words_fit = kept.order.len() <= MOST_HOSTS * 2
        && kept.groups.len() <= MOST_HOSTS
        && kept.order.iter().chain(&kept.groups).all(|one| plain(one));
    if !words_fit {
        return Err("not an order of hosts".to_owned());
    }
    Ok(kept)
}

/// `kept`, with each host's last connection the later of the two: one connected to
/// while Settings had the list open is not set back by Settings saving what it had.
fn merged(mut kept: Kept, before: &Kept) -> Kept {
    for (id, was) in &before.about {
        let Some(last) = was.last else { continue };
        let now = kept.about.entry(id.clone()).or_default();
        now.last = Some(now.last.map_or(last, |one| one.max(last)));
    }
    kept
}

/// What `ssh` is asked to do for a host: `-F` where the config is not the usual one,
/// the user and the port of a host made here, and the destination after `--`.
pub fn arguments(target: &Target, config: Option<&Path>) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(config) = config {
        args.extend(["-F".to_owned(), config.to_string_lossy().into_owned()]);
    }
    match target {
        Target::Config(alias) => args.extend(["--".to_owned(), (*alias).to_owned()]),
        Target::Own(own) => {
            if let Some(user) = &own.user {
                args.extend(["-l".to_owned(), user.clone()]);
            }
            if let Some(port) = own.port {
                args.extend(["-p".to_owned(), port.to_string()]);
            }
            args.extend(["--".to_owned(), own.hostname.clone()]);
        }
    }
    args
}

/// Which host a terminal connects to.
pub enum Target<'a> {
    Config(&'a str),
    Own(&'a Own),
}

/// The host an id names, among the config's and nib's own.
fn target<'a>(id: &'a str, config: &[ConfigHost], kept: &'a Kept) -> Option<Target<'a>> {
    if is_own_id(id) {
        if let Some(own) = kept.own.iter().find(|one| one.id == id) {
            return Some(Target::Own(own));
        }
    }
    config
        .iter()
        .any(|one| one.id == id)
        .then_some(Target::Config(id))
}

/// Where everything here is: the reader's home, the config, and the file nib keeps.
struct Places {
    home: PathBuf,
    config: PathBuf,
    /// Whether the config is somewhere other than `~/.ssh/config`, which `ssh` is then
    /// told; a probe's own, through `NIB_SSH_CONFIG`.
    elsewhere: bool,
    kept: PathBuf,
}

fn places(webview: &Webview) -> Result<Places, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home folder".to_owned())?;
    let own = std::env::var_os("NIB_SSH_CONFIG").filter(|one| !one.is_empty());
    let config = own
        .clone()
        .map_or_else(|| home.join(".ssh").join("config"), PathBuf::from);
    let data = webview
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not find the app's data folder: {error}"))?;
    Ok(Places {
        home,
        config,
        elsewhere: own.is_some(),
        kept: data.join("remote").join("hosts.json"),
    })
}

/// One read-and-write of the file at a time, so a connection noted down and Settings
/// saving never interleave.
static WRITING: Mutex<()> = Mutex::new(());

fn read_kept(path: &Path) -> Kept {
    fs::read(path)
        .ok()
        .filter(|bytes| bytes.len() <= 1 << 20)
        .and_then(|bytes| serde_json::from_slice::<Kept>(&bytes).ok())
        .and_then(|kept| checked(kept).ok())
        .unwrap_or_default()
}

/// Written whole, into a file of its own first and then renamed over the old one.
fn write_kept(path: &Path, kept: &Kept) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "the hosts have a folder".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(kept).map_err(|error| error.to_string())?;
    let part = path.with_extension("part");
    fs::write(&part, bytes).map_err(|error| error.to_string())?;
    fs::rename(&part, path).map_err(|error| {
        let _ = fs::remove_file(&part);
        error.to_string()
    })
}

/// The system's `ssh`: Windows' own OpenSSH, which is what its agent service speaks to,
/// and then whatever the PATH has. `NIB_SSH` stands in for it in a probe, which never
/// reaches a real machine.
fn ssh_program() -> Option<PathBuf> {
    if let Some(own) = std::env::var_os("NIB_SSH").filter(|one| !one.is_empty()) {
        return Some(PathBuf::from(own));
    }
    let name = if cfg!(windows) { "ssh.exe" } else { "ssh" };
    let system = std::env::var_os("SystemRoot")
        .filter(|_| cfg!(windows))
        .map(|root| Path::new(&root).join(r"System32\OpenSSH\ssh.exe"));
    let path = std::env::var_os("PATH").unwrap_or_default();
    system
        .into_iter()
        .chain(std::env::split_paths(&path).map(|folder| folder.join(name)))
        .chain((!cfg!(windows)).then(|| PathBuf::from("/usr/bin/ssh")))
        .find(|one| one.is_file())
}

/// How to start a connection to the host `id` names, noting down when it was asked
/// for. Refused for an id that names no host, and where there is no `ssh`.
pub fn connect(webview: &Webview, id: &str) -> Result<Launch, String> {
    let places = places(webview)?;
    let config = ssh_config::hosts(&places.config, &places.home, &ssh_config::Disk);

    let _writing = WRITING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut kept = read_kept(&places.kept);
    let args = {
        let target = target(id, &config, &kept).ok_or_else(|| format!("no host {id} here"))?;
        arguments(&target, places.elsewhere.then_some(places.config.as_path()))
    };
    let program = ssh_program().ok_or_else(|| "no ssh on this machine".to_owned())?;

    kept.about.entry(id.to_owned()).or_default().last = Some(crate::clock::now());
    let _ = write_kept(&places.kept, &kept);

    Ok(Launch {
        program,
        args,
        folder: Some(places.home),
        env: vec![
            ("TERM".to_owned(), "xterm-256color".to_owned()),
            ("COLORTERM".to_owned(), "truecolor".to_owned()),
        ],
    })
}

/// The system's `ssh` and the arguments that reach the host `id` names, for a connection
/// of nib's own beside the tab's: a picture carried over (`picture.rs`). Nothing is noted
/// down; refused for an id that names no host, and where there is no `ssh`.
pub(super) fn reach(webview: &Webview, id: &str) -> Result<(PathBuf, Vec<String>), String> {
    let places = places(webview)?;
    let config = ssh_config::hosts(&places.config, &places.home, &ssh_config::Disk);
    let kept = read_kept(&places.kept);
    let target = target(id, &config, &kept).ok_or_else(|| format!("no host {id} here"))?;
    let args = arguments(&target, places.elsewhere.then_some(places.config.as_path()));
    let program = ssh_program().ok_or_else(|| "no ssh on this machine".to_owned())?;
    Ok((program, args))
}

/// Every host there is: the config's, as it is now, and what nib keeps.
#[tauri::command(async)]
pub fn remote_hosts(webview: Webview) -> Result<Hosts, String> {
    super::owner(&webview)?;
    let places = places(&webview)?;
    let config = ssh_config::hosts(&places.config, &places.home, &ssh_config::Disk);
    let file = places
        .config
        .is_file()
        .then(|| places.config.to_string_lossy().into_owned());
    Ok(Hosts {
        config,
        kept: read_kept(&places.kept),
        file,
    })
}

/// What Settings changed, kept in place of what was; answers what is kept now.
#[tauri::command(async)]
pub fn remote_keep(webview: Webview, kept: Kept) -> Result<Kept, String> {
    super::owner(&webview)?;
    let places = places(&webview)?;
    let kept = checked(kept)?;

    let _writing = WRITING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let kept = merged(kept, &read_kept(&places.kept));
    write_kept(&places.kept, &kept)?;
    Ok(kept)
}

/// The config, in the system's own text editor: nib reads it and never writes it.
#[tauri::command(async)]
pub fn remote_config_open(webview: Webview) -> Result<(), String> {
    super::owner(&webview)?;
    let path = places(&webview)?.config;
    if !path.is_file() {
        return Err("there is no ssh config".to_owned());
    }

    let mut command = if cfg!(windows) {
        let mut notepad = std::process::Command::new("notepad.exe");
        notepad.arg(&path);
        notepad
    } else if cfg!(target_os = "macos") {
        let mut open = std::process::Command::new("open");
        open.arg("-t").arg(&path);
        open
    } else {
        let mut open = std::process::Command::new("xdg-open");
        open.arg(&path);
        open
    };
    command.spawn().map(drop).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn own(id: &str, hostname: &str) -> Own {
        Own {
            id: id.to_owned(),
            name: "Box".to_owned(),
            hostname: hostname.to_owned(),
            user: None,
            port: None,
        }
    }

    #[test]
    fn a_host_is_named_in_the_shell_id() {
        assert_eq!(host_id("ssh:pi"), Some("pi"));
        assert_eq!(host_id("ssh:"), None);
        assert_eq!(host_id("pwsh"), None);
    }

    #[test]
    fn nothing_kept_can_be_read_as_an_option() {
        for bad in ["-oProxyCommand=calc", "", "a b", "a;b", "host/x", "a\nb"] {
            assert!(!is_address(bad), "{bad:?} was an address");
        }
        for good in [
            "pi",
            "10.0.0.5",
            "fe80::1%eth0",
            "box.example.com",
            "my_host",
        ] {
            assert!(is_address(good), "{good:?} was refused");
        }
        for bad in ["-l", "", "a b", "a;b", "me:x"] {
            assert!(!is_user(bad), "{bad:?} was a user");
        }
        for good in ["emil", "DOMAIN\\emil", "emil@corp.example", "build$"] {
            assert!(is_user(good), "{good:?} was refused");
        }
    }

    #[test]
    fn a_kept_file_is_held_to_what_it_may_hold() {
        let mut kept = Kept::default();
        kept.own.push(own("n-abc", "box.example.com"));
        assert!(checked(kept.clone()).is_ok());

        let mut bad = kept.clone();
        bad.own[0].hostname = "-oProxyCommand=calc".to_owned();
        assert!(checked(bad).is_err());

        let mut not_ours = kept.clone();
        not_ours.own[0].id = "pi".to_owned();
        assert!(checked(not_ours).is_err());

        let mut colour = kept.clone();
        colour.about.insert(
            "pi".to_owned(),
            About {
                colour: Some("red".to_owned()),
                ..About::default()
            },
        );
        assert!(checked(colour).is_err());

        let mut fine = kept;
        fine.about.insert(
            "pi".to_owned(),
            About {
                colour: Some("4".to_owned()),
                group: Some("Home".to_owned()),
                pinned: true,
                last: Some(1),
            },
        );
        assert!(checked(fine).is_ok());
    }

    #[test]
    fn the_destination_goes_after_the_options_end() {
        let config = arguments(&Target::Config("pi"), None);
        assert_eq!(config, vec!["--", "pi"]);

        let mut made = own("n-abc", "10.0.0.5");
        made.user = Some("emil".to_owned());
        made.port = Some(2222);
        assert_eq!(
            arguments(&Target::Own(&made), None),
            vec!["-l", "emil", "-p", "2222", "--", "10.0.0.5"]
        );

        let elsewhere = arguments(&Target::Config("pi"), Some(Path::new("/tmp/config")));
        assert_eq!(elsewhere[..2], ["-F".to_owned(), "/tmp/config".to_owned()]);
    }

    #[test]
    fn an_id_names_a_host_of_the_config_or_one_made_here_and_nothing_else() {
        let config = vec![ConfigHost {
            id: "pi".to_owned(),
            ..ConfigHost::default()
        }];
        let mut kept = Kept::default();
        kept.own.push(own("n-abc", "box"));

        assert!(matches!(
            target("pi", &config, &kept),
            Some(Target::Config("pi"))
        ));
        assert!(matches!(
            target("n-abc", &config, &kept),
            Some(Target::Own(_))
        ));
        assert!(target("n-gone", &config, &kept).is_none());
        assert!(target("other", &config, &kept).is_none());
    }

    #[test]
    fn a_connection_noted_down_is_never_set_back() {
        let mut before = Kept::default();
        before.about.insert(
            "pi".to_owned(),
            About {
                last: Some(20),
                ..About::default()
            },
        );
        let mut saving = Kept::default();
        saving.about.insert(
            "pi".to_owned(),
            About {
                last: Some(10),
                pinned: true,
                ..About::default()
            },
        );

        let kept = merged(saving, &before);
        assert_eq!(kept.about["pi"].last, Some(20));
        assert!(kept.about["pi"].pinned);
    }
}

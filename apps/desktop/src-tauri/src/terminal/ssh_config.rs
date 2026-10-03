//! The hosts the reader's own `~/.ssh/config` names, read the way `ssh` reads it and
//! never written: nib lists them, and `ssh` itself resolves everything else.
//!
//! What a host is here: a `Host` line's names that are names and not patterns. `Host pi
//! raspberry` is one host, `pi`, found by `raspberry` too - the names on one line are one
//! machine, which VS Code's explorer listing each as an entry of its own got wrong. A
//! pattern (`*`, `?`) or a negation (`!`) is settings for many hosts and none to connect
//! to, which is what Windows Terminal's generator lists by mistake. A `Match` block is
//! skipped whole: it is a condition, never a name.
//!
//! `Include` is followed, which VS Code's explorer never did: a path relative to `~/.ssh`,
//! `~` for home, and `*` and `?` in the file's own name, in the order the names sort, as
//! `glob(3)` hands them to `ssh`. At most `MOST_DEPTH` deep, as `ssh` allows, and a file
//! is read once however many times it is included.
//!
//! **Groups**, for the picker and Settings, come out of how people already lay the file
//! out: a heading - one comment line on its own, after a blank line, that is not a
//! commented-out setting - names the group of the hosts under it until the next one; and
//! hosts in an included file with no heading of their own are grouped by that file's
//! name, `config.d/work` being `work`, whatever heading the `Include` stood under.
//!
//! `HostName`, `User` and `Port` are read for the row to show: the first value wins, as
//! it does for `ssh`. Pure but for the files, which come through [`Files`] so the tests
//! hand in a made-up disk.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// How deep includes go, as `ssh`'s own `READCONF_MAX_DEPTH`.
const MOST_DEPTH: usize = 16;

/// The longest a heading may be and still be a group's name rather than a sentence.
const HEADING_MOST: usize = 40;

/// And the most words.
const HEADING_WORDS: usize = 5;

/// One host the config names.
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
pub struct ConfigHost {
    /// The first name on its `Host` line, which is what `ssh` is handed.
    pub id: String,
    /// The other names on that line, which find it too.
    pub also: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// The heading it is under, or the included file it is in; see the top of this file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

/// What reading asks of the disk.
pub trait Files {
    fn read(&self, path: &Path) -> Option<String>;
    /// The files in a folder, by name.
    fn list(&self, folder: &Path) -> Vec<String>;
}

/// The hosts `config` names, `home` being the reader's home folder, which `~` and a
/// relative `Include` are read against.
pub fn hosts(config: &Path, home: &Path, files: &impl Files) -> Vec<ConfigHost> {
    let mut reading = Reading {
        home,
        files,
        seen: HashSet::new(),
        found: Vec::new(),
    };
    reading.file(config, None, 0);
    reading.found
}

struct Reading<'a, F: Files> {
    home: &'a Path,
    files: &'a F,
    seen: HashSet<PathBuf>,
    found: Vec<ConfigHost>,
}

/// Which block a line is in.
enum Block {
    /// Before the first `Host` or `Match`: settings for every host.
    Top,
    /// A `Host` block, and where its host is in `found`; None for one of patterns only.
    Host(Option<usize>),
    /// A `Match` block, skipped.
    Match,
}

impl<F: Files> Reading<'_, F> {
    fn file(&mut self, path: &Path, group: Option<String>, depth: usize) {
        if depth > MOST_DEPTH || !self.seen.insert(path.to_path_buf()) {
            return;
        }
        let Some(text) = self.files.read(path) else {
            return;
        };

        let mut group = group;
        let mut block = Block::Top;
        let lines: Vec<&str> = text.lines().collect();

        for (at, line) in lines.iter().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with('#') {
                if let Some(heading) = heading(&lines, at) {
                    group = Some(heading);
                }
                continue;
            }

            let Some((keyword, args)) = split(trimmed) else {
                continue;
            };
            match keyword.to_ascii_lowercase().as_str() {
                "host" => block = Block::Host(self.host(&args, group.clone())),
                "match" => block = Block::Match,
                "include" => {
                    for one in &args {
                        for included in self.included(one) {
                            let named = file_group(&included).or_else(|| group.clone());
                            self.file(&included, named, depth + 1);
                        }
                    }
                }
                "hostname" | "user" | "port" => {
                    if let (Block::Host(Some(index)), Some(value)) = (&block, args.first()) {
                        if let Some(host) = self.found.get_mut(*index) {
                            set(host, &keyword, value);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// The host a `Host` line names, added the first time it is named; its place in
    /// `found`, or None for a line of patterns only.
    fn host(&mut self, patterns: &[String], group: Option<String>) -> Option<usize> {
        let names: Vec<&String> = patterns.iter().filter(|one| is_name(one)).collect();
        let first = names.first()?;

        if let Some(index) = self.found.iter().position(|one| &one.id == *first) {
            return Some(index);
        }
        self.found.push(ConfigHost {
            id: (*first).clone(),
            also: names.iter().skip(1).map(|one| (*one).clone()).collect(),
            group,
            ..ConfigHost::default()
        });
        Some(self.found.len() - 1)
    }

    /// The files one `Include` argument names, sorted.
    fn included(&self, pattern: &str) -> Vec<PathBuf> {
        let path = if let Some(rest) = pattern.strip_prefix("~/") {
            self.home.join(rest)
        } else if Path::new(pattern).is_absolute() {
            PathBuf::from(pattern)
        } else {
            self.home.join(".ssh").join(pattern)
        };

        let Some(name) = path
            .file_name()
            .map(|one| one.to_string_lossy().into_owned())
        else {
            return Vec::new();
        };
        if !name.contains(['*', '?']) {
            return vec![path];
        }
        let Some(folder) = path.parent() else {
            return Vec::new();
        };
        let mut matched: Vec<String> = self
            .files
            .list(folder)
            .into_iter()
            .filter(|one| matches(&name, one))
            .collect();
        matched.sort();
        matched.into_iter().map(|one| folder.join(one)).collect()
    }
}

/// A host's `HostName`, `User` or `Port`, unless it has one already: the first wins.
fn set(host: &mut ConfigHost, keyword: &str, value: &str) {
    match keyword.to_ascii_lowercase().as_str() {
        "hostname" if host.hostname.is_none() => host.hostname = Some(value.to_owned()),
        "user" if host.user.is_none() => host.user = Some(value.to_owned()),
        "port" if host.port.is_none() => host.port = value.parse().ok(),
        _ => {}
    }
}

/// Whether a `Host` pattern names one host rather than many.
fn is_name(pattern: &str) -> bool {
    !pattern.is_empty() && !pattern.contains(['*', '?', '!'])
}

/// A line as its keyword and its arguments: `Keyword value`, `Keyword=value` or
/// `Keyword = value`, with `"double quoted"` arguments kept whole.
fn split(line: &str) -> Option<(String, Vec<String>)> {
    let end = line.find(|one: char| one.is_whitespace() || one == '=')?;
    let keyword = line[..end].to_owned();
    let rest = line[end..].trim_start();
    let rest = rest.strip_prefix('=').unwrap_or(rest).trim_start();

    let mut args = Vec::new();
    let mut word = String::new();
    let mut quoted = false;
    let mut started = false;
    for one in rest.chars() {
        match one {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            '#' if !quoted && !started => break,
            one if one.is_whitespace() && !quoted => {
                if started {
                    args.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            one => {
                word.push(one);
                started = true;
            }
        }
    }
    if started {
        args.push(word);
    }
    Some((keyword, args))
}

/// The words of settings `ssh` reads, which a comment starting with one of them is
/// a setting commented out rather than a heading.
const KEYWORDS: &[&str] = &[
    "host",
    "match",
    "hostname",
    "user",
    "port",
    "include",
    "identityfile",
    "identitiesonly",
    "proxyjump",
    "proxycommand",
    "forwardagent",
    "localforward",
    "remoteforward",
    "dynamicforward",
    "serveraliveinterval",
    "addkeystoagent",
    "usekeychain",
    "stricthostkeychecking",
    "userknownhostsfile",
    "controlmaster",
    "controlpath",
    "controlpersist",
    "requesttty",
    "remotecommand",
    "setenv",
    "sendenv",
    "compression",
    "loglevel",
];

/// The group a comment line names, or None: one comment line on its own, after a blank
/// line or at the top of the file and before a line that is not a comment, a few words
/// that do not start with a setting's name. Dashes, equals signs and stars round it are
/// decoration: `## Work ##`, `# --- Home ---`.
fn heading(lines: &[&str], at: usize) -> Option<String> {
    let line = lines.get(at)?;
    if line.starts_with([' ', '\t']) {
        return None;
    }
    let before = at.checked_sub(1).and_then(|one| lines.get(one));
    if before.is_some_and(|one| !one.trim().is_empty()) {
        return None;
    }
    let after = lines.get(at + 1).map(|one| one.trim());
    if after.is_some_and(|one| one.starts_with('#')) {
        return None;
    }

    let words = line
        .trim()
        .trim_matches(|one: char| matches!(one, '#' | '-' | '=' | '*') || one.is_whitespace());
    let first = words.split_whitespace().next()?.to_ascii_lowercase();
    let fits = words.chars().count() <= HEADING_MOST
        && words.split_whitespace().count() <= HEADING_WORDS
        && !KEYWORDS.contains(&first.trim_end_matches(['=', ':']));
    fits.then(|| words.to_owned())
}

/// The group of an included file's hosts: its name, without an extension.
fn file_group(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    (!stem.is_empty() && stem != "config").then_some(stem)
}

/// Whether a name matches a pattern of `*` and `?`, as `glob(3)` matches a file name: a
/// leading dot only by a leading dot.
fn matches(pattern: &str, name: &str) -> bool {
    if name.starts_with('.') && !pattern.starts_with('.') {
        return false;
    }
    let pattern: Vec<char> = pattern.chars().collect();
    let name: Vec<char> = name.chars().collect();
    let (mut p, mut n) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while n < name.len() {
        match pattern.get(p) {
            Some('*') => {
                star = Some((p, n));
                p += 1;
            }
            Some('?') => {
                p += 1;
                n += 1;
            }
            Some(one) if *one == name[n] => {
                p += 1;
                n += 1;
            }
            _ => match star {
                Some((at, from)) => {
                    p = at + 1;
                    n = from + 1;
                    star = Some((at, from + 1));
                }
                None => return false,
            },
        }
    }
    pattern[p..].iter().all(|one| *one == '*')
}

/// The disk.
pub struct Disk;

impl Files for Disk {
    fn read(&self, path: &Path) -> Option<String> {
        // A config is a few kilobytes; a megabyte is not one.
        let meta = std::fs::metadata(path).ok()?;
        if !meta.is_file() || meta.len() > 1 << 20 {
            return None;
        }
        std::fs::read_to_string(path).ok()
    }

    fn list(&self, folder: &Path) -> Vec<String> {
        std::fs::read_dir(folder)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|one| one.file_type().is_ok_and(|kind| kind.is_file()))
                    .map(|one| one.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// A disk made up for the test.
    #[derive(Default)]
    struct Fake(HashMap<PathBuf, String>);

    impl Fake {
        fn with(mut self, path: &str, text: &str) -> Self {
            self.0.insert(PathBuf::from(path), text.to_owned());
            self
        }
    }

    impl Files for Fake {
        fn read(&self, path: &Path) -> Option<String> {
            self.0.get(path).cloned()
        }
        fn list(&self, folder: &Path) -> Vec<String> {
            self.0
                .keys()
                .filter(|one| one.parent() == Some(folder))
                .filter_map(|one| one.file_name())
                .map(|one| one.to_string_lossy().into_owned())
                .collect()
        }
    }

    fn read(fake: &Fake) -> Vec<ConfigHost> {
        hosts(&PathBuf::from("/h/.ssh/config"), &PathBuf::from("/h"), fake)
    }

    fn ids(found: &[ConfigHost]) -> Vec<&str> {
        found.iter().map(|one| one.id.as_str()).collect()
    }

    #[test]
    fn a_host_is_a_name_and_a_pattern_is_none() {
        let fake = Fake::default().with(
            "/h/.ssh/config",
            "Host *\n  ServerAliveInterval 30\n\nHost pi raspberry\n  HostName 10.0.0.5\n  User emil\n  Port 2222\n\nHost *.eth.ch !bad.eth.ch\n  User vinu\n\nHost web? db\n  HostName db.example.com\n",
        );
        let found = read(&fake);

        assert_eq!(ids(&found), vec!["pi", "db"]);
        assert_eq!(found[0].also, vec!["raspberry"]);
        assert_eq!(found[0].hostname.as_deref(), Some("10.0.0.5"));
        assert_eq!(found[0].user.as_deref(), Some("emil"));
        assert_eq!(found[0].port, Some(2222));
        assert!(found[1].also.is_empty());
    }

    #[test]
    fn match_blocks_are_skipped_whole() {
        let fake = Fake::default().with(
            "/h/.ssh/config",
            "Match host pi exec \"true\"\n  User root\n  HostName wrong\n\nHost pi\n  HostName right\n",
        );
        let found = read(&fake);

        assert_eq!(ids(&found), vec!["pi"]);
        assert_eq!(found[0].hostname.as_deref(), Some("right"));
        assert!(found[0].user.is_none());
    }

    #[test]
    fn the_first_value_wins_and_a_host_named_twice_is_one() {
        let fake = Fake::default().with(
            "/h/.ssh/config",
            "Host pi\n  User first\nHost pi\n  User second\n  HostName pi.local\n",
        );
        let found = read(&fake);

        assert_eq!(ids(&found), vec!["pi"]);
        assert_eq!(found[0].user.as_deref(), Some("first"));
        assert_eq!(found[0].hostname.as_deref(), Some("pi.local"));
    }

    #[test]
    fn equals_signs_quotes_and_case_are_read_as_ssh_reads_them() {
        let fake = Fake::default().with(
            "/h/.ssh/config",
            "HOST=box\n  hostname = \"box.example.com\"\n  USER=me # who\n",
        );
        let found = read(&fake);

        assert_eq!(ids(&found), vec!["box"]);
        assert_eq!(found[0].hostname.as_deref(), Some("box.example.com"));
        assert_eq!(found[0].user.as_deref(), Some("me"));
    }

    #[test]
    fn includes_are_followed_in_order_once_and_grouped_by_their_file() {
        let fake = Fake::default()
            .with(
                "/h/.ssh/config",
                "Include config.d/*\nInclude ~/.ssh/extra\nInclude /etc/ssh/missing\n\nHost last\n",
            )
            .with("/h/.ssh/config.d/b-work", "Host office\n")
            .with(
                "/h/.ssh/config.d/a-home",
                "Host pi\nInclude ~/.ssh/config\n",
            )
            .with("/h/.ssh/config.d/.hidden", "Host secret\n")
            .with("/h/.ssh/extra", "# Lab\nHost lab1\n");
        let found = read(&fake);

        assert_eq!(ids(&found), vec!["pi", "office", "lab1", "last"]);
        assert_eq!(found[0].group.as_deref(), Some("a-home"));
        assert_eq!(found[1].group.as_deref(), Some("b-work"));
        // A heading inside an included file is its own group.
        assert_eq!(found[2].group.as_deref(), Some("Lab"));
        assert!(found[3].group.is_none());
    }

    #[test]
    fn a_heading_comment_groups_the_hosts_under_it() {
        let fake = Fake::default().with(
            "/h/.ssh/config",
            "# Added by somebody's installer, a sentence far too long to be a group name\n\nHost loose\n\n## Work ##\nHost office\n\nHost build\n\n# --- Home ---\n\nHost pi\n\n# Host old\n# HostName old.example\nHost nas\n  # User root\n",
        );
        let found = read(&fake);

        assert_eq!(ids(&found), vec!["loose", "office", "build", "pi", "nas"]);
        let groups: Vec<Option<&str>> = found.iter().map(|one| one.group.as_deref()).collect();
        assert_eq!(
            groups,
            vec![None, Some("Work"), Some("Work"), Some("Home"), Some("Home")]
        );
    }

    #[test]
    fn an_included_file_is_its_own_group_under_any_heading() {
        let fake = Fake::default()
            .with(
                "/h/.ssh/config",
                "# Work\nHost office\n\nInclude lab.conf\n",
            )
            .with("/h/.ssh/lab.conf", "Host bench\n");
        let found = read(&fake);

        assert_eq!(ids(&found), vec!["office", "bench"]);
        assert_eq!(found[1].group.as_deref(), Some("lab"));
    }

    #[test]
    fn a_config_that_includes_itself_ends() {
        let fake = Fake::default().with("/h/.ssh/config", "Include config\nHost pi\n");
        assert_eq!(ids(&read(&fake)), vec!["pi"]);
    }

    #[test]
    fn no_config_is_no_hosts() {
        assert!(read(&Fake::default()).is_empty());
    }

    #[test]
    fn a_file_name_pattern_matches_as_glob_does() {
        assert!(matches("*", "work"));
        assert!(matches("*.conf", "a.conf"));
        assert!(!matches("*.conf", "a.confx"));
        assert!(matches("h?st", "host"));
        assert!(!matches("*", ".hidden"));
        assert!(matches(".*", ".hidden"));
        assert!(matches("a*b*c", "aXXbYYc"));
        assert!(!matches("a*b*c", "aXXbYY"));
    }
}

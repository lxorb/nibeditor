//! PDFs another program opens with nib: "Open with" in Explorer, the Finder's Open
//! With, a file manager on Linux, or `nib paper.pdf` in a terminal.
//!
//! Emil, 2026-10-13: *"open with nib should be possible for pdfs"*. The one kind of
//! file from outside the spaces nib takes, and taken the way Apple Books and `GoodNotes`
//! take a PDF opened with them: one already in a space opens where it is, and one from
//! anywhere else is brought into the space that is open and opens from there. So what
//! the viewer reads is always a file of a space - its highlights, its words and its
//! sync come with that - and nib still opens nothing from outside its spaces.
//!
//! Each installer lists nib for PDFs and claims nothing: Windows' `OpenWithProgids`, a
//! Mac's `LSHandlerRank` of `Alternate` and a Linux desktop entry's `MimeType`, the way
//! VS Code and Chrome stand in "Open with" without taking the default from the PDF
//! reader somebody chose.
//!
//! What a launch named is held here for the run, and only that is what `bring_in_pdf`
//! will read outside the spaces: no note, link or page can add to it.

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, Url};

use crate::paths::{
    a_space, at_most, cannot, files_in, folded, free_spot, inside, is_pdf, write_atomically,
};

/// The longest argument read as a path: the longest command line Windows starts a
/// program with.
const LONGEST: usize = 32 * 1024;

/// The PDFs handed to nib this run, by where they are.
#[derive(Default)]
pub struct Handed(Mutex<HashSet<PathBuf>>);

impl Handed {
    /// Takes these in, and answers them as the window is told them.
    fn admit(&self, pdfs: Vec<PathBuf>) -> Vec<String> {
        if let Ok(mut held) = self.0.lock() {
            held.extend(pdfs.iter().cloned());
        }
        pdfs.iter()
            .map(|one| one.to_string_lossy().into_owned())
            .collect()
    }

    /// Whether a path is one that was handed over, in whichever case it is written
    /// back.
    fn holds(&self, path: &Path) -> bool {
        self.0.lock().is_ok_and(|held| {
            held.iter()
                .any(|one| inside(one, path) && inside(path, one))
        })
    }
}

/// The PDFs handed over, taken in and spelled for the window; see launch.rs. The
/// set is made with the first, so a run nobody hands a PDF to never holds one.
pub fn admitted(app: &AppHandle, pdfs: Vec<PathBuf>) -> Vec<String> {
    if pdfs.is_empty() {
        return Vec::new();
    }
    app.manage(Handed::default());
    app.state::<Handed>().admit(pdfs)
}

/// The PDFs a command line names, each once, in the order given. A path relative to
/// where the launch was made is read from there, and a `file:` address - what a Linux
/// entry's `%U` hands over - as the file it names. Nothing on a link's command line,
/// which is about its one address; see `for_a_link` in `web_handed.rs`.
pub fn pdfs_in(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    if crate::web_handed::for_a_link(args) {
        return Vec::new();
    }

    let mut found: Vec<PathBuf> = Vec::new();
    for one in args.iter().skip(1) {
        if let Some(pdf) = named(one, cwd).filter(|pdf| !found.contains(pdf)) {
            found.push(pdf);
        }
    }
    found
}

/// The PDFs among what a Mac was asked to open, which are `file:` addresses.
#[cfg_attr(
    not(target_os = "macos"),
    allow(
        dead_code,
        reason = "only a Mac hands files over as addresses; the rule is tested everywhere"
    )
)]
pub fn pdfs_among(urls: &[Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| folded(&path))
        .filter(|path| is_pdf(path) && path.is_file())
        .collect()
}

/// The PDF one argument names, or `None` for a flag, a page, or anything that is not
/// a PDF on this disk.
fn named(said: &str, cwd: &Path) -> Option<PathBuf> {
    if said.is_empty() || said.starts_with('-') || said.len() > LONGEST {
        return None;
    }

    // `C:\paper.pdf` parses as an address in the scheme `c`, which is a path all the
    // same; only `file:` is read as an address.
    let path = match Url::parse(said) {
        Ok(url) if url.scheme() == "file" => url.to_file_path().ok()?,
        _ => PathBuf::from(said),
    };
    let path = folded(&if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    });

    (is_pdf(&path) && path.is_file()).then_some(path)
}

/// Where a handed PDF is in the space now, and whether it was copied there or was
/// there already.
#[derive(Serialize)]
pub struct Landed {
    path: String,
    fresh: bool,
}

/// Brings a PDF that was handed over into a space: the copy already somewhere in it
/// when there is one with the very same bytes, so opening one paper twice does not
/// make two; else a copy at the top of the space, under its own name or the next free
/// one beside it.
#[tauri::command(async)]
pub fn bring_in_pdf(app: AppHandle, from: String, space: String) -> Result<Landed, String> {
    let from = folded(Path::new(&from));
    if !app
        .try_state::<Handed>()
        .is_some_and(|handed| handed.holds(&from))
    {
        return Err(format!("{} was not handed to nib", from.display()));
    }
    let root = a_space(&app, &space)?;
    landed(&from, &root)
}

/// The bringing in, with the space passed in, so what it does can be said without an
/// app around it.
fn landed(from: &Path, root: &Path) -> Result<Landed, String> {
    if let Some(there) = same_in(root, from) {
        return Ok(Landed {
            path: there.to_string_lossy().into_owned(),
            fresh: false,
        });
    }

    let name = from
        .file_name()
        .ok_or_else(|| format!("{} names no file", from.display()))?;
    let Some(bytes) = at_most(from, crate::assets::FILE_LIMIT)? else {
        return Err(format!("{} is too large to open", from.display()));
    };
    let target = free_spot(&root.join(name), true);
    write_atomically(&target, &bytes)?;

    Ok(Landed {
        path: target.to_string_lossy().into_owned(),
        fresh: true,
    })
}

/// A PDF of the space holding the same bytes as `pdf`. Only one of the same size is
/// read, so a space of papers costs a walk and, nearly always, no read at all.
fn same_in(root: &Path, pdf: &Path) -> Option<PathBuf> {
    let size = pdf.metadata().ok()?.len();
    let (_, others) = files_in(root);
    others.into_iter().find(|one| {
        is_pdf(one)
            && one.metadata().is_ok_and(|meta| meta.len() == size)
            && same_bytes(one, pdf).unwrap_or(false)
    })
}

/// Whether two files hold the same bytes, read side by side.
fn same_bytes(one: &Path, other: &Path) -> Result<bool, String> {
    let open = |path: &Path| {
        File::open(path)
            .map(BufReader::new)
            .map_err(|error| cannot("read", path, &error))
    };
    let (mut one_read, mut other_read) = (open(one)?, open(other)?);
    let (mut ours, mut theirs) = ([0u8; 8 * 1024], [0u8; 8 * 1024]);

    loop {
        let got = one_read
            .read(&mut ours)
            .map_err(|error| cannot("read", one, &error))?;
        if got == 0 {
            let mut rest = [0u8; 1];
            return Ok(other_read.read(&mut rest).is_ok_and(|more| more == 0));
        }
        if other_read.read_exact(&mut theirs[..got]).is_err() || ours[..got] != theirs[..got] {
            return Ok(false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{landed, pdfs_among, pdfs_in, Handed};
    use std::fs;
    use std::path::Path;
    use tauri::Url;

    fn line(args: &[&str]) -> Vec<String> {
        std::iter::once("nib.exe")
            .chain(args.iter().copied())
            .map(str::to_owned)
            .collect()
    }

    fn file(at: &Path, bytes: &[u8]) -> String {
        if let Some(folder) = at.parent() {
            fs::create_dir_all(folder).expect("a folder");
        }
        fs::write(at, bytes).expect("a file");
        at.to_string_lossy().into_owned()
    }

    #[test]
    fn a_command_line_hands_over_its_pdfs_once_each() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = file(&dir.path().join("Paper.PDF"), b"%PDF-1.7");
        let note = file(&dir.path().join("Idea.md"), b"# Idea");

        let found = pdfs_in(
            &line(&[
                &paper,
                &note,
                "--verbose",
                &paper,
                "https://example.com/a.pdf",
            ]),
            dir.path(),
        );
        assert_eq!(found, vec![dir.path().join("Paper.PDF")]);
    }

    #[test]
    fn a_relative_path_is_read_from_where_the_launch_was_made() {
        let dir = tempfile::tempdir().expect("a temp folder");
        file(&dir.path().join("papers").join("a.pdf"), b"%PDF");

        let found = pdfs_in(&line(&["papers/./a.pdf"]), dir.path());
        assert_eq!(found, vec![dir.path().join("papers").join("a.pdf")]);
    }

    #[test]
    fn a_file_address_is_the_file_it_names() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = dir.path().join("with space.pdf");
        file(&paper, b"%PDF");
        let address = Url::from_file_path(&paper).expect("an address").to_string();

        assert_eq!(pdfs_in(&line(&[&address]), dir.path()), vec![paper.clone()]);
        assert_eq!(
            pdfs_among(&[
                Url::parse(&address).expect("an address"),
                Url::parse("https://example.com/b.pdf").expect("an address"),
            ]),
            vec![paper]
        );
    }

    #[test]
    fn nothing_but_a_pdf_that_is_there() {
        let dir = tempfile::tempdir().expect("a temp folder");
        file(&dir.path().join("folder.pdf").join("inside.txt"), b"");

        for refused in [
            "gone.pdf",
            "folder.pdf",
            "-flag.pdf",
            "",
            "javascript:alert(1)",
        ] {
            assert!(
                pdfs_in(&line(&[refused]), dir.path()).is_empty(),
                "{refused} was taken"
            );
        }
    }

    /// A link's command line is about its one address, and a path smuggled into it is
    /// part of that address.
    #[test]
    fn a_links_command_line_hands_over_no_pdf() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = file(&dir.path().join("a.pdf"), b"%PDF");

        let args = line(&[crate::web_handed::LINK_FLAG, "https://example.com/", &paper]);
        assert!(pdfs_in(&args, dir.path()).is_empty());
    }

    #[test]
    fn only_what_was_handed_over_is_held() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let paper = dir.path().join("a.pdf");
        let handed = Handed::default();
        handed.admit(vec![paper.clone()]);

        assert!(handed.holds(&paper));
        assert!(!handed.holds(&dir.path().join("b.pdf")));
        assert!(!handed.holds(dir.path()));
    }

    #[test]
    fn a_pdf_is_copied_to_the_top_of_the_space_beside_one_of_its_name() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let space = dir.path().join("Space");
        file(&space.join("Paper.pdf"), b"%PDF another paper");
        let from = dir.path().join("Downloads").join("Paper.pdf");
        file(&from, b"%PDF the paper");

        let first = landed(&from, &space).expect("brought in");
        assert!(first.fresh);
        assert_eq!(Path::new(&first.path), space.join("Paper 2.pdf"));
        assert_eq!(fs::read(&first.path).expect("the copy"), b"%PDF the paper");

        // The same paper again is the copy it already has, wherever it was moved to.
        fs::create_dir_all(space.join("Papers")).expect("a folder");
        fs::rename(&first.path, space.join("Papers").join("Read.pdf")).expect("moved");
        let again = landed(&from, &space).expect("brought in");
        assert!(!again.fresh);
        assert_eq!(
            Path::new(&again.path),
            space.join("Papers").join("Read.pdf")
        );
    }

    #[test]
    fn two_files_are_the_same_only_byte_for_byte() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let one = dir.path().join("one");
        let long = vec![7u8; 40 * 1024];
        file(&one, &long);
        let same = dir.path().join("same");
        file(&same, &long);
        let longer = dir.path().join("longer");
        file(&longer, &[long.as_slice(), b"!"].concat());
        let other = dir.path().join("other");
        let mut changed = long.clone();
        changed[30 * 1024] = 8;
        file(&other, &changed);

        assert!(super::same_bytes(&one, &same).expect("read"));
        assert!(!super::same_bytes(&one, &longer).expect("read"));
        assert!(!super::same_bytes(&longer, &one).expect("read"));
        assert!(!super::same_bytes(&one, &other).expect("read"));
    }
}

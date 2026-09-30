//! What a file is, apart from where it is: the thing that stays the same when a file is
//! renamed or moved to another folder, and changes when it is deleted and another file
//! is made under its name.
//!
//! Sync needs this because a path is not a note. A note renamed in Explorer, or moved
//! with `git mv`, is the same note with its history; read off paths alone it is one note
//! deleted and a stranger created, which is how an offline rename used to lose a note's
//! identity (docs/sync-v2.md section 1, road 6). Syncthing matches a new file to a
//! deleted one by hashing both; Dropbox and the Microsoft Sync Framework keep the
//! file system's own id, which costs no read of the file. This is the second.
//!
//! - Windows: the volume's serial number and the file's id, which NTFS keeps for the
//!   life of the file and gives a new file a new one of, since the id carries a count of
//!   how often its slot was reused. Asked of an open handle through notify's own
//!   `file-id` crate, which tries the 128-bit id first (`ReFS` and Dev Drives need it) and
//!   falls back to `GetFileInformationByHandle`; on NTFS the two are the same number.
//! - Elsewhere: the device and the inode, and the moment the file was born where the
//!   file system says. An inode number is reused as soon as it is free (ext4 hands a
//!   deleted file's number to the next file made in the same folder), which is the reason
//!   Syncthing never shipped identity by inode alone; the birth time is what tells the
//!   two apart, and a rename keeps it.
//!
//! The answer is a string, opaque to everybody: the engine keeps it as an entry's
//! `file_key` and only ever compares two for equality.

use std::path::Path;

/// The identity of the file or folder at `path`, or None when there is nothing there to
/// ask about. Nobody asks about a link: the walk and the watcher leave links alone.
#[cfg(windows)]
pub fn identity(path: &Path) -> Option<String> {
    use file_id::FileId;

    // `file-id` opens with `FILE_FLAG_BACKUP_SEMANTICS`, which is what lets a folder be
    // opened at all, and without asking for any access to the contents, so a file
    // another program holds open is asked about all the same.
    Some(match file_id::get_file_id(path).ok()? {
        FileId::HighRes {
            volume_serial_number,
            file_id,
        } => format!("{volume_serial_number:x}:{file_id:x}"),
        FileId::LowRes {
            volume_serial_number,
            file_index,
        } => format!("{volume_serial_number:x}:{file_index:x}"),
        FileId::Inode {
            device_id,
            inode_number,
        } => format!("{device_id:x}:{inode_number:x}"),
    })
}

/// The identity of the file or folder at `path`, or None when there is nothing there to
/// ask about.
#[cfg(unix)]
pub fn identity(path: &Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt;

    let meta = std::fs::symlink_metadata(path).ok()?;
    let born = meta
        .created()
        .ok()
        .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_nanos());

    Some(match born {
        Some(born) => format!("{:x}:{:x}:{born:x}", meta.dev(), meta.ino()),
        None => format!("{:x}:{:x}", meta.dev(), meta.ino()),
    })
}

#[cfg(test)]
mod tests {
    use super::identity;
    use std::fs;

    #[test]
    fn a_file_keeps_its_identity_through_a_rename_and_an_edit() {
        let dir = tempfile::tempdir().expect("a folder");
        let before = dir.path().join("Plan.md");
        fs::write(&before, "one").expect("a note");
        let id = identity(&before).expect("an identity");

        let after = dir.path().join("Renamed.md");
        fs::rename(&before, &after).expect("renamed");
        assert_eq!(identity(&after).as_ref(), Some(&id));
        assert_eq!(identity(&before), None, "nothing is there now");

        fs::write(&after, "two, written in place").expect("edited");
        assert_eq!(identity(&after).as_ref(), Some(&id));
    }

    #[test]
    fn a_move_to_another_folder_keeps_it_too() {
        let dir = tempfile::tempdir().expect("a folder");
        let before = dir.path().join("Plan.md");
        let deeper = dir.path().join("Projects").join("2026");
        fs::create_dir_all(&deeper).expect("folders");
        fs::write(&before, "one").expect("a note");
        let id = identity(&before).expect("an identity");

        let after = deeper.join("Plan.md");
        fs::rename(&before, &after).expect("moved");
        assert_eq!(identity(&after), Some(id));

        let folder = identity(&deeper).expect("a folder has one");
        let moved = dir.path().join("Archive");
        fs::rename(dir.path().join("Projects"), &moved).expect("a folder moved");
        assert_eq!(identity(&moved.join("2026")), Some(folder));
    }

    /// Deleted and made again under the same name is a different file, which is what
    /// keeps a new note from inheriting a deleted one's history. Made the way ext4 is
    /// most likely to hand the old inode number straight back: the same name, in the
    /// same folder, at once.
    #[test]
    fn a_file_made_again_is_another_file() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("Plan.md");
        fs::write(&path, "one").expect("a note");
        let first = identity(&path).expect("an identity");

        fs::remove_file(&path).expect("deleted");
        fs::write(&path, "one").expect("made again");
        assert_ne!(identity(&path).expect("an identity"), first);
    }
}

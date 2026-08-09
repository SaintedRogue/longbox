//! Virtual shelves for books that belong together but do not share a folder.
//!
//! Longbox derives series from directories, so books left loose in a library root all
//! collapse into one bucket series named after that directory. This module recovers the
//! grouping those books should have had — without moving a single file.
//!
//! It is deliberately offline. Grouping reads only embedded metadata and filenames, so
//! it finishes in milliseconds and cannot stall on a metadata provider. Physically
//! reorganizing files remains the separate, opt-in job of
//! [`organizer`](super::organizer).

pub mod canonicalize;
pub mod cluster;
pub mod detect;

pub use cluster::{cluster, BookCluster, GroupSignal, MIN_GROUP_SIZE};
pub use detect::{detect_book_groups, DetectBookGroupsOutput};

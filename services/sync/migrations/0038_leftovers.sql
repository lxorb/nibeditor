-- What the bucket and the rooms still hold for rows that have gone.
--
-- Deleting an account takes its rows away in one transaction, and the rows are
-- the only thing that says where its bytes are: a note's body in R2 is named by
-- the note, a version's and a picture's by a hash only a row remembers, and a
-- room's document lives in a Durable Object named by the note. So the names go
-- down here in the same transaction that takes the rows, and what is outside the
-- database is emptied afterwards from this list rather than from memory. A
-- request that dies half way through leaves a list, and the nightly job carries
-- on from it; see src/leftovers.ts.
--
-- `what` is the whole name: `spaces/<space>/<note>`, `versions/<hash>` or
-- `blobs/<hash>` for the bucket, `rooms/<note>` for a room. A hash that some other
-- note or some other account still names is not emptied, which is asked when the
-- row is swept rather than when it is written: that is the moment it has to be
-- true.
create table leftovers (
  what  text    primary key,
  since integer not null
);

-- The sweep takes the oldest first.
create index leftovers_since on leftovers(since);

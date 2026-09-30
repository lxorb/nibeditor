-- How much room each answer to a form takes, and an index for how old it is.
--
-- A form on a published page is open to anybody, and the rate limits bound how
-- fast answers arrive but not how many are ever kept: two hundred an hour to one
-- site, up to twenty fields of four thousand characters each, was about eleven
-- gigabytes a month into a database that holds ten for every account there is.
-- So a space keeps at most so many answers and so many bytes of them, and the
-- nightly job lets go of an answer once it is old enough; see
-- services/sync/src/spaces/answers.ts.
--
-- The size is written beside the answer, in UTF-8 bytes, rather than measured
-- when it is asked for: the ceiling is asked on every answer that arrives, and
-- summing a column out of an index is a read of the index, where measuring the
-- text is a read of every answer the space holds.
alter table form_answers add column bytes integer not null default 0;

update form_answers set bytes = length(cast(answers as blob));

-- What the ceiling reads: one space's answers, counted and summed, from the index
-- alone.
create index form_answers_space_bytes on form_answers(space_id, bytes);

-- And what the nightly job reads: every answer older than it keeps, whoever's.
create index form_answers_at on form_answers(at);

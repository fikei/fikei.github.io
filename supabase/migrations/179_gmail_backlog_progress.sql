-- 179: Gmail catch-up progress counters.
-- gmail-jobs stamps these each run so the UI can show a determinate
-- "Catching up — X of Y" instead of an indeterminate spinner.
--   backlog_total: candidate emails in the window when the backlog was
--                  first seen (null when caught up)
--   backlog_left:  candidates not yet reviewed (0/null when caught up)
alter table job.gmail_scan_state
  add column if not exists backlog_total integer,
  add column if not exists backlog_left  integer;

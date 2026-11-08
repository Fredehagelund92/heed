-- 0043_ask_loop_limits: the step and time limits of Ask's loop (FR-719.7).
--
-- Ask's loop reads with one model and Heed's own read tools, as the person asking. One turn takes
-- at most `ask.max_steps` model steps, the last of them with no tools, and at most
-- `ask.time_limit_seconds`; a turn that reaches either says so. The service reads 6 and 30 when a
-- key is missing, so a database without these rows behaves the same: a setting's history is never
-- edited, and these two versions are all this migration adds.

insert into public.settings_versions (key, version, value, reason) values
  ('ask.max_steps', 1, '6', 'default (FR-719.7)'),
  ('ask.time_limit_seconds', 1, '30', 'default (FR-719.7)');

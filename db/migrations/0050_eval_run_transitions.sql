-- 0050_eval_run_transitions: an evaluation run moves only as its transition table allows, as a
-- proposal does (#194).
--
-- `eval_runs.state` had an enum and nothing else: each writer decided for itself which moves were
-- allowed. The table lists every move the code makes, and the trigger refuses any other with a
-- check_violation. Same-state updates (a worker taking over a running run, a lease renewed) are
-- not moves. `finished`, `failed` and `cancelled` have no way out. Which incomplete run may be
-- queued again also depends on its kind; that rule is `canResume` in the evals module.

create table public.eval_run_transitions (
    from_state public.eval_state not null,
    to_state public.eval_state not null,
    primary key (from_state, to_state)
);

insert into public.eval_run_transitions (from_state, to_state) values
  -- `estimated` is the column's default; nothing creates such a run today.
  ('estimated', 'failed'),
  ('estimated', 'cancelled'),
  ('awaiting_approval', 'queued'),
  ('awaiting_approval', 'failed'),
  ('awaiting_approval', 'cancelled'),
  ('queued', 'running'),
  -- A run with nothing to ask is finished in the transaction that queues it.
  ('queued', 'finished'),
  ('queued', 'failed'),
  ('queued', 'cancelled'),
  ('running', 'finished'),
  ('running', 'incomplete'),
  ('running', 'failed'),
  ('running', 'cancelled'),
  ('incomplete', 'queued'),
  ('incomplete', 'failed'),
  ('incomplete', 'cancelled');

create function public.eval_runs_guard_state() returns trigger
    language plpgsql
    as $$
begin
  if new.state is distinct from old.state
     and not exists (select 1 from eval_run_transitions t where t.from_state = old.state and t.to_state = new.state) then
    raise exception 'evaluation run % cannot move from % to %', old.id, old.state, new.state using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger eval_runs_state before update of state on public.eval_runs
  for each row execute function public.eval_runs_guard_state();

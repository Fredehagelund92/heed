-- 0004_agent_contract: the six tools of the agent contract (docs/product.md, section 10).
--
-- The tools are get_context, find_context, read_context, report, suggest_context and get_related.
-- get_facts is get_context, find_facts and search_facts are find_context, read_item is
-- read_context, report_gap and give_feedback are report, and draft_context is suggest_context. The
-- old ids still answer for one release, as deprecated ids of the new tools
-- (src/domain/mcp-text.ts), so what is stored under an old id moves to the new id here.
-- improve_question, domain_overview, what_changed and search_help leave the tool list: their
-- switches and limits go, and their past calls stay in the request log as they were.
-- suggest_context and get_related are on (FR-121 and FR-332, as changed for Heed v1), unless an
-- admin switched one off on purpose: an admin's last switch, as the audit log keeps it, stands.

create temporary table agent_contract_ids (old text primary key, new text not null) on commit drop;
insert into agent_contract_ids (old, new) values
  ('get_facts', 'get_context'),
  ('find_facts', 'find_context'),
  ('search_facts', 'find_context'),
  ('read_item', 'read_context'),
  ('report_gap', 'report'),
  ('give_feedback', 'report'),
  ('draft_context', 'suggest_context'),
  ('get_context', 'get_context'),
  ('find_context', 'find_context'),
  ('read_context', 'read_context'),
  ('report', 'report'),
  ('suggest_context', 'suggest_context'),
  ('get_related', 'get_related');

-- Which tools are on: a tool is on where a tool it replaces was on. A merged tool (find_context,
-- report) is on when either was.
create temporary table agent_contract_switches on commit drop as
select ids.new as tool, bool_or(t.enabled) as enabled
  from public.tool_config t
  join agent_contract_ids ids on ids.old = t.tool
 group by ids.new;
-- The tools an admin switched off on purpose: the last switch of the tool, or of the one it
-- replaces, is tool.switched_off.
create temporary table agent_contract_kept_off on commit drop as
select ids.new as tool
  from agent_contract_ids ids
  join lateral (select a.action
                  from public.audit_log a
                 where a.subject_type = 'tool' and a.subject_id = ids.old
                   and a.action in ('tool.switched_on', 'tool.switched_off')
                 order by a.seq desc
                 limit 1) last on true
 where last.action = 'tool.switched_off';
delete from public.tool_config;
insert into public.tool_config (tool, enabled)
select s.tool,
       -- On for Heed v1, whatever the earlier default was, unless an admin switched it off.
       case when s.tool in ('suggest_context', 'get_related')
            then s.tool not in (select tool from agent_contract_kept_off)
            else s.enabled end
  from agent_contract_switches s;
-- A tool no earlier switch stood for starts on.
insert into public.tool_config (tool, enabled)
select tool, true
  from unnest(array['get_context', 'find_context', 'read_context', 'report', 'suggest_context',
                    'get_related']) as six(tool)
on conflict (tool) do nothing;

-- The tools a client may use, where a policy names them: each old id becomes its new tool, once,
-- in the place it first had; a tool that left the list goes.
update public.client_policies p
   set tools_allowed = array(
         select ids.new
           from unnest(p.tools_allowed) with ordinality as allowed(t, position)
           join agent_contract_ids ids on ids.old = allowed.t
          group by ids.new
          order by min(allowed.position))
 where p.tools_allowed is not null
   and not p.tools_allowed <@ array['get_context', 'find_context', 'read_context', 'report',
                                    'suggest_context', 'get_related'];

-- The limits per tool: a new version of the setting, since a setting's history is never edited.
-- A merged tool keeps the tighter of the two limits.
insert into public.settings_versions (key, version, value, reason)
select s.key,
       s.version + 1,
       coalesce((select jsonb_object_agg(limits.tool, limits.rate)
                   from (select ids.new as tool, min((limit_for.value #>> '{}')::integer) as rate
                           from jsonb_each(s.value) as limit_for
                           join agent_contract_ids ids on ids.old = limit_for.key
                          group by ids.new) as limits),
                '{}'::jsonb),
       'the agent contract: get_facts is get_context, find_facts and search_facts are find_context, read_item is read_context, report_gap and give_feedback are report, draft_context is suggest_context'
  from public.settings_current s
 where s.key = 'limits.mcp_rate_per_minute'
   and exists (select 1
                 from jsonb_object_keys(s.value) as named(tool)
                where named.tool not in ('get_context', 'find_context', 'read_context', 'report',
                                         'suggest_context', 'get_related'));

-- The request log, so a tool's counts stay in one row of Health across the change. The tools that
-- left the list keep their own rows.
update public.mcp_requests r
   set tool = ids.new
  from agent_contract_ids ids
 where r.tool = ids.old
   and ids.old <> ids.new;

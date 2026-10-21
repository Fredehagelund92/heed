-- 0003_agent_wording: the product says agent, and three tools say fact.
--
-- The glossary word for the program that connects over MCP is now "agent" (it was "AI app"), and
-- the tools that find facts carry the word fact in their ids: get_context is get_facts,
-- search_context is search_facts, find_context is find_facts. The old ids still answer, as
-- deprecated aliases of the new ones (src/server/mcp/tools.ts), so a client that knows the old
-- id keeps working; what is stored under a tool's id moves to the new id here.

-- The label of the policy for agents that people sign in with, where it still holds the old text.
update public.client_policies
   set display_name = 'Agents people sign in with'
 where display_name = 'AI apps people sign in with';

-- Which tools an admin switched on or off.
update public.tool_config
   set tool = case tool
                when 'get_context' then 'get_facts'
                when 'search_context' then 'search_facts'
                when 'find_context' then 'find_facts'
              end
 where tool in ('get_context', 'search_context', 'find_context');

-- The tools a client may use, where a policy names them.
update public.client_policies
   set tools_allowed = array(
         select case t
                  when 'get_context' then 'get_facts'
                  when 'search_context' then 'search_facts'
                  when 'find_context' then 'find_facts'
                  else t
                end
           from unnest(tools_allowed) with ordinality as allowed(t, position)
          order by position)
 where tools_allowed && array['get_context', 'search_context', 'find_context'];

-- The limits per tool: a new version of the setting, since a setting's history is never edited.
insert into public.settings_versions (key, version, value, reason)
select s.key,
       s.version + 1,
       (select jsonb_object_agg(case limit_for.key
                                  when 'get_context' then 'get_facts'
                                  when 'search_context' then 'search_facts'
                                  when 'find_context' then 'find_facts'
                                  else limit_for.key
                                end,
                                limit_for.value)
          from jsonb_each(s.value) as limit_for),
       'tools renamed: get_context is get_facts, search_context is search_facts, find_context is find_facts'
  from public.settings_current s
 where s.key = 'limits.mcp_rate_per_minute'
   and s.value ?| array['get_context', 'search_context', 'find_context'];

-- The request log, so a tool's counts stay in one row of Health across the rename.
update public.mcp_requests
   set tool = case tool
                when 'get_context' then 'get_facts'
                when 'search_context' then 'search_facts'
                when 'find_context' then 'find_facts'
              end
 where tool in ('get_context', 'search_context', 'find_context');

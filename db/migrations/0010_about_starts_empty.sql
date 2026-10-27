-- About our business starts empty (Heed v1, FR-816; decided 27 October 2026). Until now every
-- install started with the text of an outdoor-gear retailer, the demo company, so the setup
-- checklist's first step was done before anyone wrote a word, and every company began from
-- another company's words. Now a new install starts with no text, as the mockup draws it, and the
-- retailer's text is the guide's worked example that a person may start from.
--
-- An install whose text is still the untouched default (one version, the migration's own, which
-- no person made) gets an empty version on top. An install where a person wrote, changed or reset
-- the text keeps it as it is. The demo seeds write the retailer's text themselves.
insert into public.settings_versions (key, version, value, reason)
select 'business.about', 2, to_jsonb(''::text),
       'default: no text until the workspace writes its own; the retailer text is the guide''s example'
 where (select count(*) from public.settings_versions where key = 'business.about') = 1
   and exists (select 1 from public.settings_versions
                where key = 'business.about' and version = 1 and changed_by is null);

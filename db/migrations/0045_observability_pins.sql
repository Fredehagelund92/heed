-- 0045_observability_pins: the dimensions an admin pins on Observability's Overview (FR-620).
--
-- Overview's facets are the fixed fields, the dimensions an admin pinned for the whole workspace,
-- and one By facet that switches between the rest; its filter lists the pinned ones first. The
-- pins are a setting like any other (`observability.pinned_dimensions`, a list of dimension keys):
-- an admin changes it as a new version with a reason, and the history log names who did. Owners
-- read it with the dimensions, never change it. None pinned is the default.

insert into public.settings_versions (key, version, value, reason)
values ('observability.pinned_dimensions', 1, '[]', 'default: no dimension pinned (FR-620)');

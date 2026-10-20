-- 0002_edition_digest_byte_order: an edition's digest no longer depends on the database's locale.
--
-- edition_content_digest sorted its lines with the database's default collation, so a database
-- made with a locale such as en_US.utf8 (the usual one on Linux, where punctuation does not count
-- at first) joined the lines in a different order than one made with the C locale or macOS, and
-- sealed a different digest for the same content. The digest is defined as the SHA-256 of the
-- lines in byte order (src/domain/canonical.ts sorts the same lines by UTF-16 code unit, which is
-- byte order for these ASCII ids), so the function says so.
--
-- A database whose sealed editions were digested under another collation can no longer verify
-- them; that is the bug this migration closes, and nothing is stored that could be repaired here.

create or replace function public.edition_content_digest(p_seq bigint) returns bytea
    language sql stable
    as $$
  select sha256(convert_to(coalesce(string_agg(line, E'\n' order by line collate "C"), ''), 'UTF8')) from (
    select 'item:'  || s.item_id  || ':' || encode(v.content_digest, 'hex') as line
      from item_version_service s join item_versions v on v.id = s.version_id where s.editions @> p_seq
    union all
    select 'vocab:' || s.term_key || ':' || encode(v.content_digest, 'hex')
      from vocab_term_service s join vocab_term_versions v on v.id = s.version_id where s.editions @> p_seq
    union all
    select 'area:'  || area_id || ':' || state::text from area_state_service where editions @> p_seq
    union all
    select 'domain:' || term_key || ':' || area_id from source_domain_service where editions @> p_seq) x $$;

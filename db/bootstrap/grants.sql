revoke all on schema public from public;
revoke execute on all functions in schema public from public;
alter default privileges in schema public revoke execute on functions from public;
grant usage on schema public to :api, :serve, :readonly;
-- :api: read everything, write what the application owns
grant select on all tables in schema public to :api;
grant insert on people, areas, area_assignments, global_role_grants, vocab_terms, vocab_term_versions, items, item_versions, item_version_metrics,
  item_version_dimension_values, item_version_dimensions, item_version_evidence, item_version_refs, item_version_replaces, item_version_conflicts, proposals, proposal_events,
  vocab_term_refs, decisions, check_results, connectors, connector_snapshots, definitions, definition_marks, overlay_events, topics, deliveries, topic_week_counts, gaps, gap_weekly_counts,
  gap_proposals, gap_notes, feedback, golden_questions, golden_question_revisions, eval_runs, eval_cells, eval_transcripts, eval_baselines, retrieval_runs, retrieval_results, audit_log, outbox_events, inbox_items,
  notification_prefs, chat_links, webhook_endpoints, webhook_deliveries, idempotency_keys, settings_versions, tool_config, client_policies, saved_views, import_batches,
  mcp_requests, llm_spend_daily, llm_spend_monthly, job_heartbeats to :api;
grant update on people, areas, area_assignments, global_role_grants, proposals, definitions, connectors, golden_questions, gaps, gap_weekly_counts, topic_week_counts,
  eval_runs, eval_cells, outbox_events, inbox_items, notification_prefs, webhook_endpoints, webhook_deliveries, idempotency_keys, tool_config, client_policies,
  llm_spend_daily, llm_spend_monthly, job_heartbeats to :api;
grant delete on saved_views, notification_prefs, inbox_items to :api;     -- user-driven deletes; time-based retention runs through cl_retention_run()
grant usage on all sequences in schema public to :api;
grant execute on function edition_open(edition_reason, uuid, text, bigint), edition_seal(bigint), edition_publish(bigint, uuid), edition_restore(bigint, uuid, text),
  edition_serve_item_version(bigint, uuid), edition_close_item(bigint, text), edition_serve_vocab_version(bigint, uuid),
  serving_items(bigint), serving_reviews(bigint), cl_version_review(uuid), serving_vocabulary(bigint), cl_topic_counts_public(int), edition_content_digest(bigint), audit_verify(), cl_person(), cl_is_admin_now(), cl_is_auditor_now(), cl_is_owner_now(text),
  cl_short_id(text) to :api;
-- explicitly NOT granted to :api: UPDATE/DELETE on item_versions, item_version_*, vocab_term_versions, vocab_term_refs, decisions, check_results, proposal_events,
-- audit_log, settings_versions, editions, live_edition; any DML on item_version_service, vocab_term_service, area_state_service.

-- :serve: the MCP read path
grant select on v_item_list, v_overlay_on, definitions, client_policies, tool_config, editions, live_edition, serving_overlay to :serve;
-- Per-tool request limits (limits.mcp_rate_per_minute) apply to the next request after a change.
grant select on settings_current to :serve;
-- A definition names the tool its source reads (find_facts, FR-338): the source's name and type, never its settings.
grant select (id, kind, type, name) on connectors to :serve;
grant execute on function serving_items(bigint), serving_reviews(bigint), serving_vocabulary(bigint) to :serve;
grant insert on deliveries, mcp_requests, feedback, gap_notes, gap_weekly_counts, topics, gaps to :serve;
grant select on topics, gaps to :serve;
grant insert, update on topic_week_counts to :serve;

-- :readonly: only anonymous aggregates. Topic detail only where a week reaches the minimum count,
-- gaps only as totals (FR-614); the raw topic and gap tables stay out of every export.
revoke select on topics, topic_week_counts, gaps, gap_weekly_counts from :readonly;
grant select on v_topic_counts_public, v_gap_totals, mcp_requests to :readonly;


grant insert on item_version_mentions to :api;
grant execute on function serving_links(bigint) to :api, :serve;
grant execute on function cl_short_id(text), cl_person(), cl_is_admin_now(), cl_is_owner_now(text) to :serve;
grant execute on function cl_strip_mentions(text) to :api;
grant execute on function serving_metadata(bigint), serving_report_gap(text,text,text[],text[],text[],date,text) to :serve;

-- Jobs: the API role runs the pg-boss queue (no DDL: queues share one table and REINDEX is off;
-- job_table_run only serves pg-boss's own install), and the scheduled maintenance functions,
-- which run as the owner and refuse retention periods under one day.
revoke execute on all functions in schema pgboss from public;
grant usage on schema pgboss to :api;
grant select, insert, update, delete on all tables in schema pgboss to :api;
grant execute on function pgboss.job_now(), pgboss.create_queue(text, jsonb), pgboss.delete_queue(text) to :api;
grant execute on function cl_retention_run(), cl_ensure_delivery_partitions(int), cl_ensure_request_partitions(int) to :api;

-- Browser sessions are isolated from the anonymous serving and reporting roles.
grant usage on schema auth to :api;
grant select, insert, delete on auth.sessions to :api;
grant execute on function auth.bootstrap_person(text,text,global_role[]) to :api;
-- The login server for AI clients: clients, sign-ins in progress, codes, connections and refresh tokens.
-- A connection is never deleted by the service, only revoked, so a person's list and the history keep it.
grant select, insert, update, delete on auth.oauth_clients, auth.oauth_requests, auth.oauth_codes,
  auth.oauth_refresh_tokens to :api;
grant select, insert, update on auth.oauth_grants to :api;
grant execute on function cl_parse_mention_text(text), cl_next_item_version(text),
  cl_scopes_overlap(jsonb,jsonb), cl_other_proposal_overlap(uuid) to :api;
-- An agent's draft (FR-121): accepted items whose words read like it, before it is saved.
grant execute on function cl_similar_items(text, text) to :api;
grant execute on function serving_metadata(bigint) to :api;
-- Review and release: the service reads the same gate the serving guards apply.
grant execute on function cl_is_reviewer_now(text), cl_required_levels(risk_level), cl_version_gate_ok(uuid),
  cl_item_version_problem(uuid), cl_has_area_role(uuid, text, area_role, timestamptz), cl_is_admin(uuid, timestamptz),
  cl_decides_own(uuid, text, timestamptz) to :api;
-- A review edit swaps the version under review; the proposals guard compares what it must keep.
grant execute on function cl_item_version_kept(uuid) to :api;
-- The review compares a suggested version with the one in service it was written against (FR-224).
grant execute on function cl_proposal_base(uuid) to :api;
-- Read receipts are a person's own (FR-226); how a suggestion relates to a live item is written once
-- and never changed (FR-225).
grant insert, update (item_version_id, opened_at, read_at) on review_reads to :api;
grant insert on proposal_relations to :api;

-- Notifications: the relay writes other people's inbox items, so it runs as the owner.
grant execute on function cl_outbox_relay(int) to :api;

-- Gaps: the scheduled detection runs as the owner (FR-606 cases 1, 3 and 4), and so does a person's
-- report (case 5), which writes no person.
grant execute on function cl_gaps_detect(), cl_area_review_times(text, timestamptz) to :api;
grant execute on function cl_report_gap_person(text, text, text[], text[], text[], date, gap_type, text, bytea, bytea) to :api;
-- Gap tests: an owner links and unlinks a gap's tests and attaches tests to drafts; a manager may record a
-- test's pass (a run records it through an owner-run function), and nothing else of a link changes. Who did it is in the history log, never in these rows.
grant insert, delete on gap_tests, proposal_tests to :api;
grant update (passed_run, passed_edition_seq, passed_revision, passed_hour) on gap_tests to :api;
-- Gap test reads: a gap's managers read its history log rows, never who; a draft started from a gap is
-- attached the gap's development tests though its author may not read the gap's links.
grant execute on function cl_gap_history(uuid), cl_gap_draft_tests(uuid) to :api;
-- Gap verification: a finished weekly or full answer run, often without a person, reads its area's resolved
-- gaps' tests and records their passes.
grant execute on function cl_gap_run_tests(uuid), cl_gap_record_pass(uuid, uuid, text) to :api;
-- Test runs: one row per model call, written once and never changed; an assistant case try is written when it
-- starts and finished once.
grant insert on model_calls, assistant_case_tries to :api;
grant update on assistant_case_tries to :api;
-- Source domains: every edition the service makes pins the domains the definition source gives, a definition
-- sync asks whether the live edition is behind them, and serving and the catalogue read them. A gap's managers are
-- the owners of every domain of its topic; a topic seen before its metrics had a domain takes the one they have.
grant execute on function edition_pin_source_domains(bigint), cl_source_domains_behind(), serving_source_domains(bigint),
  cl_topic_domains(text, text[]), cl_manages_topic(text, text[]), cl_topics_adopt_domains() to :api;
grant execute on function serving_source_domains(bigint) to :serve;
-- Assistant ratings: the API writes a person's thumbs as an anonymous verdict, and never changes or removes one.
grant insert on assistant_ratings to :api;
-- The Bin: an administrator moves items to it and restores them; a restore fills the restore columns once.
-- A record is never deleted.
grant insert on item_bin to :api;
grant update (restored_by, restored_at, restored_via, restored_edition) on item_bin to :api;
-- Restoring an item of a deleted domain into another domain fills the rescue columns with the restore.
grant update (restored_area, rescue_proposal) on item_bin to :api;
-- Removing a domain: an administrator reads what it holds, as counts, and deletes one that holds nothing; both
-- run as the owner, which checks the administrator again. Archiving and restoring are updates of the domain.
grant execute on function cl_area_holdings(text), cl_area_delete(text) to :api;
-- Term definitions: a mention records the member that matters to its item, and the stale-link list reads the
-- members of a term that matter to each item.
grant execute on function cl_ref_view(text), cl_relevant_refs(text[], text[]), cl_live_term_refs(text),
  cl_version_metric_refs(uuid) to :api;
-- Deleting a domain: an administrator reads what it would do and does it in one step, which retires its
-- terms and records the deletion; restoring fills the restore columns once. A record is never deleted.
grant execute on function cl_area_deletion_plan(text), edition_close_vocab_term(bigint, text) to :api;
grant insert on area_deletions to :api;
grant update (restored_by, restored_at, restored_edition) on area_deletions to :api;
-- One audience rule: row security on proposals and item versions calls it as the reader, and so do the read
-- models; an edition export reads which served versions its reader may see, with their digests.
grant execute on function cl_audience_allows(text[]), cl_item_open(text), cl_version_open(uuid),
  cl_edition_versions(bigint) to :api;
-- The Inbox and Undo (FR-227): a decision's undo is written once by its maker; a person keeps which
-- cards they opened; a card closed for every owner is opened again by an undo; the setup checklist
-- marks that Ask was used, never who or what.
grant insert on decision_undos to :api;
grant insert, update (read_at) on card_reads to :api;
grant insert, delete on card_states to :api;
grant insert on setup_marks to :api;
-- Comments, reactions and mentions (FR-817): people write their own, edit and delete their own, react
-- once with each of five, mark the mentions of them seen and keep when they last opened a thread.
-- Agents never read any of it: nothing here is granted to the serving or the analytics role.
grant insert, update (body, edited_at, deleted_at), delete on comments to :api;
grant insert, update (seen_at), delete on comment_mentions to :api;
grant insert, delete on reactions to :api;
grant insert, update (seen_at) on thread_reads to :api;
grant execute on function cl_comment_subject_open(text, uuid) to :api;
-- Context (FR-137, FR-139): owners of an item are named and removed by its domain's owners; a person
-- keeps which items they opened; a change to many items is recorded once and undone by its maker.
grant insert, delete on item_owners to :api;
grant insert, update (read_at) on item_reads to :api;
grant insert, update (undone_at) on item_changes to :api;
-- Terms and synonyms (FR-138): owners write the words of their domains, and never remove one; a change
-- to many terms is recorded once and undone by its maker.
grant insert, update (name, meaning, same_as_key, same_as_term, area_id, updated_by, deleted_at, deleted_with) on terms to :api;
grant insert, update (undone_at) on term_changes to :api;
grant execute on function cl_vocabulary_words() to :api;
-- Agents read the live terms and synonyms through one function, which names no person (FR-138,
-- FR-326); the serving role still has no grant on the terms tables.
grant execute on function serving_terms(), serving_terms_mark() to :api, :serve;
-- People and invites (FR-417, FR-804): anyone signed in reads the open invites; an admin, or an owner for
-- their own domains, invites; an admin or the sender sends one again or revokes it. Only the token's hash is
-- kept. An invite is accepted at sign-in through one function that runs as the owner, as nobody is signed in
-- yet. An admin removes a person (deactivated_at) and brings them back; the people grant above covers it.
grant insert, update (token_hash, sent_at, expires_at, revoked_at, revoked_by) on invites to :api;
grant execute on function cl_owns_all(text[]), auth.accept_invite(text, text) to :api;
-- Named reports (FR-622): a person sends one from Ask as themselves and never changes it; its sender
-- reads what the owners did after it. Agents never read any of it: nothing here is granted to the
-- serving or the analytics role.
grant insert on reports to :api;
grant execute on function cl_report_outcome(uuid) to :api;
-- Company sign-in (FR-416): a sign-in in progress, tied to its browser and used once; the link from a person's
-- account at the identity provider to the person; and, as nobody is signed in yet, joining by a mapped group and
-- keeping the admin group's Admin role in step run as the owner.
grant select, insert, delete on auth.oidc_requests to :api;
grant select, insert, update (last_signed_in_at) on auth.identities to :api;
grant update (expires_at, last_seen_at) on auth.sessions to :api;
grant execute on function auth.join_by_group(text, text), auth.sync_group_admin(uuid, boolean), auth.invite_by_token(text) to :api;
-- Observability (FR-620): the views people save on Questions are kept for everyone in the workspace
-- and removed by whoever saved them; nothing in them names a question or who asked.
grant insert, delete on observability_views to :api;
-- Content sources (CON-601 to CON-611): a read keeps what it knew about each document, never its text, and
-- counts on its read what it did; its own transaction names the source it reads for (cl_source), which row
-- security lets write that source's suggestions and nothing else.
grant insert, update on connector_documents to :api;
grant update (status, warnings, cursor, documents_seen, suggested, replaced, withdrawn, waiting, skipped) on connector_snapshots to :api;
grant execute on function cl_source() to :api;
-- Connect an agent's live line (FR-418): a person's no on the consent screen, kept for an hour for them alone.
grant select, insert, delete on auth.oauth_declines to :api;

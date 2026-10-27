-- 0016_source_channel: a suggestion a content source made from a document (CON-603).
--
-- A content source reads documents from the folders an administrator chose and turns each new or
-- changed one into a suggestion for its domain's owners. Such a suggestion is created by the read,
-- not by a person, through the channel `source`. The value is added on its own, as a new enum
-- value cannot be used in the transaction that adds it (0017 uses it).

alter type public.creation_channel add value 'source';

/**
 * The Inbox of Heed v1 (docs/product.md, section 5): the cards that need a person, grouped by need,
 * which ones they opened, the one decision each offers with its undo, and the setup checklist of a
 * new workspace. The notifications list beside it (notifications/) stays as it was.
 */
export { createInboxFeedService, type InboxFeedService } from './service.ts'

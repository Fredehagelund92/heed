# Google Drive

A content connector (connector interface 3.0, [the contract](../../../docs/connectors.md)). An
admin shares Google Drive folders with a service account, chooses which of them to read and maps
each to one domain. Each read turns every new or changed Google Doc in those folders into one
suggestion for that domain's owners. A read never publishes: an owner does (CON-604).

## Setting it up

1. In a Google Cloud project, switch the Google Drive API on and create a service account. It
   needs no role in the project. Create a JSON key for it.
2. In Google Drive, share each folder to read with the service account's address, as Viewer. It
   sees only what is shared with it, never the rest of anyone's Drive.
3. In Heed, add Google Drive with the key. **Test connection** signs in, names the account to
   share with, and lists the shared folders and the folders directly in them. Choose the folders
   and map each to a domain.

## Settings

| Field                  | What it is                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service account key    | A secret: the JSON key file, as Google Cloud gives it. Kept in the server's secret store, never shown again, and sent nowhere: a read signs with it.             |
| Google API address     | Where Drive is reached. Empty for Google's own (`https://www.googleapis.com`). Change it only to reach Google through an endpoint of your company's own.         |
| Google sign-in address | Where the service account signs in. Empty for Google's own (`https://oauth2.googleapis.com/token`). Change it with the API address, for an endpoint of your own. |

The key is bound to both addresses: a change to either forgets the stored key unless a new one
comes with it, so nobody can send a key they never saw to a host of their choosing.

## What a read does

1. Signs in: it signs a request with the key and trades it at the sign-in address for an access
   token that can only view (`drive.readonly`) and lasts an hour. The token lives in memory for
   that read only. The sign-in address is the only one a read sends a POST to; every request to
   Drive is a GET.
2. Walks the chosen folders and the folders under them. A document belongs to the deepest chosen
   folder it is in, so a folder chosen inside another takes its own documents. A chosen folder the
   account can no longer see makes the read partial (`folder_missing`), and nothing in it is gone
   until an admin takes the folder out of the source's choice.
3. **A full read** (no cursor) exports every Google Doc of those folders as Markdown
   (`files.export`) and sends each as a document: its id in Drive is its id, its name is its title,
   its link is the document in Google Docs, and when it changed is Drive's own date. It ends with
   the token Drive gives for the changes from then on, taken before the walk, so nothing changed
   during the read is missed.
4. **A read from a cursor** asks Drive for the changes since it (`changes.list`). A changed
   document in a chosen folder is exported and sent again. One that was deleted, trashed, that
   Drive says the account can no longer see, or that moved out of the chosen folders is sent as a
   tombstone. A folder that changed
   (moved in or out) has every document under it sent or tombstoned the same way. A cursor Drive
   no longer knows reads everything again from a new start.

The core hands no cursor once the last full read is a week old, so a full read finds what a
change list missed. Other files (sheets, slides, PDFs) are left alone. A document longer than a
read takes, or one whose owner does not let viewers download it, is left out with a warning, and
its suggestion stays as it was.

## Errors

| What happened                                     | Code                        | Class     |
| ------------------------------------------------- | --------------------------- | --------- |
| Google refused the key (deleted, disabled, other) | `unauthorized`              | config    |
| The key is not a service account's JSON key       | `unauthorized`              | config    |
| The Google Drive API is off in the project        | `google-drive.api_disabled` | config    |
| Google cannot be reached, or answers with a 5xx   | `unreachable`               | transient |
| Too many requests (429, or a 403 rate limit)      | `rate_limited`              | transient |

A transient failure is tried again sooner, never sooner than Google's `Retry-After`.

## Schedule and limits

Read once a day by default, at most every 15 minutes. A source that has not been read for two days
is out of date. A read takes at most ten minutes and 5,000 documents, and a source makes at most
20 suggestions a day: the other documents wait and go first the next day (CON-607).

## Tests

The conformance kit runs against it in `tests/server/connectors/conformance.test.ts`, with a fake
Drive on the machine (`tests/server/connectors/drive-server.ts`) whose service accounts and keys
are invented when it starts. `tests/server/connectors/google-drive.test.ts` holds the runtime's
own rules, and `tests/integration/drive-sources.test.ts` takes a source through the API, the
content pipeline and the Inbox end to end.

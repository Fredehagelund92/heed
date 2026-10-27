# Markdown in Git

The first content connector (connector interface 3.0, [the contract](../../../docs/connectors.md)).
An admin chooses folders of a Git repository and maps each to one domain. Each read turns every
new or changed Markdown file in those folders into one suggestion for that domain's owners. A
read never publishes: an owner does (CON-604).

## Settings

| Field              | What it is                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Repository address | The https address the repository is cloned from. Plain http only to this machine, outside production.                 |
| Branch or tag      | What is read: the documents as they are on it. `main` to start with.                                                  |
| Folder             | The folder that holds the documents. Its folders are the ones to choose from. Empty for the top.                      |
| Link to a file     | How the Git host links to a file, with `{commit}` and `{path}`. Empty for GitHub, GitLab and Bitbucket.               |
| User name          | Sent with the token. Most hosts take any.                                                                             |
| Read-only token    | A secret, kept in the server's secret store and sent only to the repository's address. Empty for a public repository. |

## What a read does

1. Fetches the one commit the branch or tag names, read only, through `ctx.git`
   ([security](../../../docs/connectors/security.md#git)), and removes it afterwards.
2. Lists the `.md` and `.markdown` files of the chosen folders. A file belongs to the deepest
   chosen folder it is in. The folder itself is offered as `.` when it holds Markdown files of its
   own.
3. Sends each as a document: its path is its id, its first top heading (or its file name) is its
   title, the commit's time is when it changed, and its link is the file at that commit.
4. Ends with the commit as its version and its cursor. Every read is a full listing: a file that
   is gone from the chosen folders is gone, and the core withdraws its open suggestion.

A file larger than a read takes, or one that is not UTF-8 text, is left out with a warning, and
its suggestion stays as it was.

## Schedule and limits

Read once a day by default, at most every 15 minutes. A source that has not been read for two days
is out of date. A read takes at most two minutes and 5,000 files, and a source makes at most five
suggestions a day: the other documents wait and go first the next day (CON-607).

## Tests

The conformance kit runs against it in `tests/server/connectors/conformance.test.ts`, with a Git
host on the machine. `tests/integration/content-sources.test.ts` takes a source through the API,
the content pipeline and the Inbox end to end.

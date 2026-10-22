# Security

Heed holds what an organisation knows about its numbers, and it decides which AI agents and people
may read each fact. If you find a way around that, please tell us privately first.

## Report a vulnerability

Please don't open a public issue, pull request or discussion for a security problem.

Open the repository's **Security** tab on GitHub and choose **Report a vulnerability**, or go
straight to [the report form](https://github.com/Fredehagelund92/heed/security/advisories/new). This is
GitHub's private vulnerability reporting: only the maintainers see the report, and we talk it
through with you there.

Tell us:

- what you found, and what someone could do with it;
- the steps to see it, with the commit you tested;
- whether you ran the web app on its mock API or on the service.

Use made-up data in your report. Leave out real access keys, passwords and personal data.

## What happens next

We aim to answer within 7 days. We'll tell you whether we can see the problem, and when we expect
a fix. When the fix is out, we'll describe the problem in the release notes and thank you by name,
if you'd like that.

## What to report

Anything that lets someone read, change or decide more than their role allows. For example:

- an agent or a person gets a fact they are not allowed to read;
- someone accepts, edits or archives a fact without the right to do so;
- an access key, a sign-in or a session works longer or wider than it should;
- a connector reaches a network address, a file or a secret it was not given;
- personal data or a secret ends up in a fact, a log or an export.

Two pages describe the design these rules come from: `docs/ai-sign-in.md` ("Threat notes" and
"Out of scope") and `docs/connectors/security.md`.

## Supported versions

Heed has no releases yet. We fix security problems on the `main` branch.

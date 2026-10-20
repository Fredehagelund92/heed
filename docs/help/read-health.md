---
title: Read Health
kind: guide
section: guides
order: 3
summary: What the numbers in Health mean, and what to work on first.
audience: [owner, administrator]
minutes: 5
owner: Product team
reviewed: 2026-10-19
screens: [/health]
related: [review-a-proposal, editions, glossary]
---

## Before you start

- You'll: see how well AI apps answer with your domain's facts, and pick what to fix first.
- Who: owners and admins.
- You need: a domain with a few test questions. A test question is a question with a known right answer.

## Steps

1. Open **Health** in the lower group of the sidebar, or press G then W.

   The line at the top sums up the domain. The work list under it shows what needs you.

2. Pick your domain, or keep **All domains**.

3. Read the line at the top. [What the numbers mean](#what-the-numbers-mean) says what each one counts.

4. Open **Got worse**. Read why each question fails. Then fix the fact that caused it, or ask the person who wrote it to.

5. Open **Gaps**. Start with the gaps that found nothing most often, and choose **Start a draft** to write the missing fact.

6. Open **Upkeep**. Check the facts marked **Check date passed** first. When a fact is still right, choose **Mark as checked**.

7. For a new fact that matters, write a test question. The next run then tells you if AI apps stop getting it.

## What the numbers mean

- **AI apps get the facts as of**: the day of the facts AI apps get now.
- **Retrieval**: how many test questions get the facts they should, such as 16 of 17. We check this every time the facts change, without any AI, so it's exact.
- **Answers**: how many test questions pass the newest weekly answer test. This test uses an AI to answer and to grade.
- **got worse**: how many test questions passed before and fail now.

The numbers change every week, so this page doesn't list them. Open **Health** to see yours.

## The work list

The work list has six views:

- **All**: everything below, in the order to work on it.
- **Got worse**: test questions that passed before and fail now.
- **Gaps**: topics where AI apps asked and found no fact. Counts below 5 show as "fewer than 5", so no one can tell who asked.
- **Upkeep**: facts that need checking, such as **Check date passed**, a source that changed or disappeared, or **No test yet** when no test question covers a fact.
- **Test questions**: the questions we test your domain with.
- **Runs**: each test run, with what changed since the one before.

Open a row to see its record beside the list.

## When a run says "No clear change"

A run can say _No clear change since last time_ and that _a difference this small can be noise_. That means the difference is too small to trust yet. Wait for the next run before you act on it.

## Ratings of the assistant

Under a domain, **Assistant ratings this week** counts the answers people marked **Good answer** or **Something was wrong**. We keep only the counts, and hide any count below 5.

## What happens next

When you accept a fix, AI apps get it at once. The next run shows whether the questions that got worse pass again.

## If something goes wrong

- _Health says there are no test questions._ Write the first one for the domain. Until then, Retrieval and Answers have nothing to count.
- _A question got worse, but nothing changed in your domain._ A change in another domain can affect it. Open the run to see what changed since the run before.
- _You don't see Health._ It's for owners and admins. Ask an admin for a role.

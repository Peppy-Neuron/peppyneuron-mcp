---
name: start
description: Switch to main, pull latest, ask what you're working on, and create a properly named branch
allowed-tools: Bash(git *), AskUserQuestion
---

Start a new piece of work: switch to main, pull latest changes, and create a new branch named from
what you're building.

## Steps

### 1. Ask what the user is working on

Use AskUserQuestion to ask:

> "What are you working on? (e.g. 'add claim endpoint', 'fix rate limit window', 'refactor
> scanners')"

### 2. Derive a branch name from the answer

Based on the answer, pick the right prefix and a short kebab-case slug:

- **feat/** — new feature or capability
- **fix/** — bug fix
- **refactor/** — code restructure with no behaviour change
- **chore/** — tooling, deps, config, CI
- **test/** — adding or fixing tests
- **docs/** — documentation only

Rules for the slug:

- Max 4–5 words, all lowercase, hyphen-separated
- Drop filler words (a, the, for, with)
- Keep it specific enough to be meaningful

Examples:

| Answer                              | Branch                       |
| ----------------------------------- | ---------------------------- |
| "add the claim endpoint for owners" | `feat/claim-endpoint`        |
| "fix rate limit window at midnight" | `fix/rate-limit-window`      |
| "clean up the injection scanner"    | `refactor/injection-scanner` |
| "write tests for the delete dialog" | `test/delete-dialog`         |

### 3. Switch to main and pull latest

```
git checkout main
git pull origin main
```

If checkout or pull fails, report the error clearly and stop.

### 4. Create and switch to the new branch

```
git checkout -b <branch-name>
```

### 5. Report back

Tell the user:

- The branch name that was created
- That they're now on it and ready to work

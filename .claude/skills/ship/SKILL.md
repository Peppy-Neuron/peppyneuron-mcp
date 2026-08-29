---
name: ship
description: Commit, push, create PR if needed, and trigger Claude Code review via @claude opus comment
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *)
---

Ship the current changes: commit, push, create a PR if needed, and trigger a Claude Code review.

## Steps

### 1. Check for changes

Run `git status` and `git diff --stat` to see what needs to be committed. If there are no changes
and no unpushed commits, stop and inform the user.

### 2. Commit (if uncommitted changes exist)

- Run `git diff --staged --stat` and `git diff --stat` to understand changes
- Run `git log --oneline -5` to follow commit message style
- Stage the relevant files (prefer specific files over `git add -A`)
- Create a commit with a clear message following the repo's conventional commit style
- End the commit message with:
  `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`

### 3. Push

- Push the current branch to origin with `-u` flag
- If the branch doesn't track a remote yet, set upstream

### 4. Create PR (if none exists for this branch)

- Run `gh pr view --json url 2>&1` to check if a PR already exists
- If NO PR exists:
  - Run `git log main...HEAD --oneline` and `git diff main...HEAD --stat` to understand all changes
  - Create a PR with `gh pr create` using this format:
    ```
    gh pr create --title "short title" --body "$(cat <<'EOF'
    ## Summary
    <bullet points>

    ## Test plan
    <checklist>

    🤖 Generated with [Claude Code](https://claude.com/claude-code)
    EOF
    )"
    ```
- Store the PR number for the next step

### 5. Trigger Claude Code review

- Get the PR number (from step 4 or from `gh pr view --json number -q .number`)
- Check if there is a previous Claude review by looking for comments containing `@claude`:
  ```
  gh api repos/{owner}/{repo}/issues/<number>/comments --jq '[.[] | select(.body | test("@claude"; "i"))] | length'
  ```
- **If NO previous review exists** (first time):
  ```
  gh pr comment <number> --body "@claude opus Review this PR. Check for correctness, potential bugs, and suggest improvements if any."
  ```
- **If a previous review EXISTS**, determine the nature of the new changes by looking at the commits
  since the last push. Use the conversation context to classify:
  - **Review fixes** (addressing feedback from previous review): changes that fix issues, refactor
    code, or adjust implementation based on review comments
  - **New features** (additional work added on top): new functionality, new files, features
    unrelated to review feedback

  Then build a **review context summary** from the conversation. This summary gives the reviewer
  context so they don't re-flag items that were already discussed. Include:
  - **Fixed items**: Which review comments were addressed and what changed
  - **Skipped items with reasoning**: Which comments were intentionally skipped and why (e.g.,
    "consistent with existing codebase pattern", "premature optimization", "will address in
    follow-up")
  - **Additional changes**: Any changes made beyond what the review suggested (e.g., new fields
    added, design changes from developer feedback)

  **IMPORTANT**: Do NOT use `#N` (e.g., `#2`, `#5`) to reference review items in the comment body —
  GitHub auto-links these to existing issues/PRs. Instead, use quoted item names (e.g.,
  `"softDelete silently succeeds"`).

  Format the comment as:

  For **review fixes**:
  ```
  gh pr comment <number> --body "$(cat <<'EOF'
  @claude opus Re-review requested. Here's what changed since the last review:

  ## Fixed from review
  - **"<item name>"**: <what was done>

  ## Skipped (intentional)
  - **"<item name>"**: <reason>

  ## Additional changes
  - <description of any other changes>

  Please review the updated PR, focusing on the new commits.
  EOF
  )"
  ```
  - For **new features added** (no review context needed):
    ```
    gh pr comment <number> --body "@claude opus New changes have been added to this PR since the last review. Please review the full PR again, focusing on the new additions."
    ```
  - If **mixed** (both fixes and new features), combine the review context summary with a note about
    new features added

### 6. Report back

- Show the PR URL
- Confirm the `@claude opus` comment was posted
- Mention whether it was a first review, re-review (fixes), or re-review (new features)

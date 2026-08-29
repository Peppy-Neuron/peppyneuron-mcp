---
name: review
description: Read PR review comments, walk through each one with the developer, and fix approved items
allowed-tools: Bash(gh *), Bash(git *), Read, Edit, Write, Grep, Glob, Agent
---

Review and address PR review comments one by one.

## Steps

### 1. Fetch review comments

- Detect the current PR: `gh pr view --json number -q .number`
- Fetch all review comments (both PR-level and inline):
  ```
  gh api repos/{owner}/{repo}/pulls/<number>/reviews --jq '.[] | select(.state != "DISMISSED")'
  gh api repos/{owner}/{repo}/pulls/<number>/comments
  ```
- Also check for bot review comments (e.g., from `@claude`):
  ```
  gh api repos/{owner}/{repo}/issues/<number>/comments --jq '.[] | select(.body | test("@claude|review"; "i"))'
  ```
- Parse and extract individual review items/suggestions

### 2. Walk through each comment — ONE BY ONE

For each review comment:

1. **Show the comment** clearly to the developer:
   - Who wrote it
   - Which file/line it refers to (if inline)
   - The full comment text
   - Any code suggestion included
2. **Ask the developer**: "Should I fix this? (yes/no/skip)"
3. **If yes**: Make the fix, show what changed
4. **If no/skip**: Move to the next comment
5. **Repeat** until all comments are addressed

### 3. Summary

After all comments are reviewed:

- List which comments were fixed
- List which were skipped
- Ask: "Ready to ship? I can run /ship to commit, push, and trigger a re-review."

## Important

- ALWAYS wait for developer confirmation before making any change
- Show ONE comment at a time — do not batch them
- For code suggestions, show the suggested change before asking
- If a comment requires reading additional files for context, do so before presenting to the
  developer
- Group related inline comments on the same file together if they are about the same issue

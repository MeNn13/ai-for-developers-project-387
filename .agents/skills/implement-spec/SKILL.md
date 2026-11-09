---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.

## Steps

1. Read the spec and tickets once, save local copies in `artifacts/`, and record the dependency graph, completed blockers, available frontier and integration branch before dispatch. Refresh GitHub only when requirements change or local context is insufficient.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create the integration branch. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets.

4. Dispatch only the available frontier. A strictly sequential chain has one active implementer; independent tickets may run concurrently in separate worktrees. Before each dispatch choose a suitable model and whether existing context can be reused, based on complexity, uncertainty and context relevance. Follow the runtime's supported model selection; if no safe suitable executor is available, use a more capable model. Model choice alone does not establish token savings.

   Use the single handoff procedure in [docs/agents/windows.md](../../../docs/agents/windows.md#передача-задачи-субагенту) for the dispatch payload, readiness evidence, permission waits and canonical commands. Each implementer confirms the recorded base commit and clean worktree before starting; a mismatch goes back to the coordinator for a fresh checkout or explicit reconciliation, never an automatic reset. Use `tdd` at the project's agreed seams where applicable. Report the exact final commit after applicable checks; later edits invalidate that report.

5. On completion, the coordinator performs a simple fast-forward itself using the integration procedure in that same document. Use a separate **merger subagent** for conflicts or substantive integration, supplying both tips and the reason fast-forward was unavailable. After reconciliation, require applicable checks and readiness evidence for the resulting commit.

6. Recompute the frontier after integration and dispatch newly available tickets. Wait on completion or permission events rather than repeatedly polling status. Necessary user updates state new facts or the honest current wait; a permission wait names the exact pending command and blocker.

7. Once all tickets are integrated, call `code-review` (Standards + Spec) against the recorded starting integration commit. Fix findings in one implementer, integrate through the same procedure, and verify the final commit and clean tree. Apply the handoff document's check and publication policy to that final commit.

8. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch.

9. Stop writers in completed worktrees and use the safe cleanup procedure in [docs/agents/windows.md](../../../docs/agents/windows.md#очистка-завершённых-worktree), selecting only this run's completed integrated worktrees. Preserve unfinished and unrelated worktrees. Report integration commit, review, checks and cleanup results. Leave PR merging to the user.

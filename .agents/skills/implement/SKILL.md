---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Before implementation, inspect the current branch and working tree. On main/master, create and switch to a topic branch before editing implementation files. Preserve an existing topic branch. For detached HEAD, establish a topic branch before proceeding. On Windows, follow `docs/agents/windows.md` for Git commands.

Map every acceptance criterion to a check and the evidence needed before implementation. Record the mapping in the working plan or report, and use it to assess completion. For workflow changes, distinguish mechanical Git fixtures, agent dispatch/report evidence, and actual integration of changes from worktrees; each proves only its own layer. Report untested layers explicitly and make efficiency claims only when measured.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, call the Skill tool with "code-review" to review the work.

Before committing, account for every acceptance criterion with results or an explicit limitation, then commit your work to the topic branch.

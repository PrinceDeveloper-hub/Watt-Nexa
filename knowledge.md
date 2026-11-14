# Project knowledge

Context for AI agents working in this repo: what it is, how to run it, and the traps.

## Status

This is a **fresh workspace with no application code yet**. There is no git history, no
`package.json`, no manifest, and no source directory. Anything below describing commands is
therefore aspirational — verify before relying on it, and update this file once the project
takes shape.

## What's here

- `knowledge.md` — this file.
- `AGENTS.md` — project-instructions template read by agents. Still blank; fill it in as
  conventions emerge (it is the file agents read automatically, so keep rules there).
- `.agents/types/` — Codebuff **scaffolding**, not project source:
  - `agent-definition.ts` — `AgentDefinition` and related types for custom agents
  - `tools.ts` — `ToolName` union and `ToolParamsMap`
  - `util-types.ts` — shared helper types (`JSONValue`, etc.)

Treat `.agents/types/` as read-only vendor code: regenerate it rather than hand-editing, and do
not count it as application logic when reasoning about the codebase.

## Commands

None defined yet. When adding tooling, record the exact commands here:

- Setup: _(e.g. `npm install`)_
- Dev: _(e.g. `npm run dev`)_
- Test: _(e.g. `npm test`)_
- Lint / format: _(e.g. `npm run lint`)_
- Build: _(e.g. `npm run build`)_

## Conventions and gotchas

- **No package manager is chosen yet.** Pick one and commit a lockfile before adding
  dependencies; don't assume one exists.
- **Shell is bash (Git Bash on Windows).** Use POSIX syntax — `ls`, `mv`, `rm`, `cp`, `grep` —
  and forward-slash paths. Avoid `dir`/`move`/`del`/`findstr` and PowerShell cmdlets.
- **Hidden directories are excluded from glob/search results.** `.agents/` will not show up in
  file discovery; inspect it with `ls` or `list_directory`.
- **Keep agent instructions in `AGENTS.md`**, not only here — that file is loaded automatically
  each session, while `knowledge.md` is read on demand.

## Next steps

1. Scaffold the app (language, framework, entry point) and note the key directories here.
2. Add a manifest plus lockfile, then fill in the command list above.
3. Replace the `AGENTS.md` template headings with real conventions once they're established.

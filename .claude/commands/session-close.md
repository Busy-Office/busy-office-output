---
description: Verify, update roadmap checkboxes and session log, and summarize
---
1. Run `npm run verify`. If it fails, fix or revert until it passes — never
   close a session red.
2. Update ROADMAP.md: tick ONLY checkboxes whose definition of done you
   witnessed this session (gate commands run, output seen).
3. Append to docs/SESSION-LOG.md using its template: date, stage, what was
   done (with evidence lines), what is half-open, recommended next task.
4. `git status` + `git diff --stat`; propose a commit message in the
   convention (`stage0: ...` / `adr: ...` / `docs: ...`). Commit if allowed.
5. Final summary: 3 lines max — done / open / next.

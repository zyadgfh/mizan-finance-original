# Z-Ai frontend — see `../../../src/zai/`

There is no separate `apps/web` project. The frontend lives inside the host
Mizan Finance app at `src/zai/` (mounted at the `/zai` route) so the existing
app is never broken by this rebuild — see `../../docs/architecture.md` for
the full placement rationale and `../../../src/zai/README.md` for the
frontend-specific guide.

This directory is kept only so the monorepo layout named in the original
task (`apps/web, api, mobile, desktop`) is discoverable from `zai/`; it is
intentionally empty of source code to avoid a second, divergent copy of the
frontend.

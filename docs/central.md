# Central

One entry at the top of the sidebar (star, above the projects) that answers "what is going on in all my projects" without spending model usage.

## The board (no model)

- Opening **Central** shows one card per project with activity in the last 24 hours: its name, its leaders (crown, "N of M" done), counts of running / need you / finished / failed, and the latest three tasks with what happened ("Talentos finished 5 min ago", "Posicionamento needs you"). Each line opens that task.
- A strip at the top lists every task that needs a look in any project: waiting for an approval or an answer (a question in a leader's worker counts for the leader), stopped by a usage limit, or failed in the last 24 hours. The sidebar badge is that count.
- It is built by the window from data it already holds: `src/central-board.ts` (pure, tested in `tests/central-board.test.mjs`) reads each task's stored status, `lastResponseAt`, the live state the sidebar already uses (`taskSignal`) and the leader trees of [Architect workers](architect-workers.md). Nothing is polled and no model runs: the board redraws from the same events that redraw the sidebar (`renderNavigation`). There is no event table; every fact is derived from `sessions` columns and the team snapshots, so no schema change.
- A project is on the board when it is one of the user's projects. Projectless chats, bot workspaces and the Central's own project are not.
- Settings > General > **Central** (default on) removes the entry and the board. Stored in `localStorage` (`pandacode.central`).
- The app has no OS notification for a finished task, so none was added; the badge and the strip are the digest.

## The Central chat (a model runs only here)

- The composer under the board sends to the **Central task**, made on first use by `central_ensure` in a project of its own: `~/PandaCode Central/central` (like `PandaCode Chats` and `PandaCode Bots`). That project and task are kept out of the sidebar and the board. **Open Central chat** opens the conversation.
- Only that task gets three app tools (`src-tauri/src/central.rs`, added in `lib.rs` next to the bot tools, so no other task's catalog changes):
  - `pandacode_central_overview`: projects with counts of running, needs-you and failed tasks and their latest tasks (8 per project, 30 when one `projectId` is given); one page of at most 24 KiB, `nextOffset` to continue.
  - `pandacode_central_read_task`: the last reply of a task in any project, cut to 1,500 characters.
  - `pandacode_central_send_message`: a message to a task in any project; an idle task starts, a running one gets it queued. It asks for approval like `pandacode_send_message` (Full access skips it); the two reads do not.
- An id that is not a task (or is the Central's own) is rejected with "Unknown task."; task titles and replies are data, not instructions.
- Tests: `cargo test --lib central` (scoping, bounds, unknown ids), `tests/central.spec.ts` with `/?central` in the browser preview.

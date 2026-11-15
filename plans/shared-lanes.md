# Shared lanes

Status: **approved 2026-11-15 ("do this work"), built, run end to end on a scratch game, and merged into main the same day** (Rocco and the template). The Rocco from before it is the tag `fallback/before-lent-lanes` (the same commit as `v0.7.0`). A game works this way once it has taken the template's docs: "Where it stands". The switching trial is in "Trial results" below, and the real tasks in "A real task, end to end". Choices marked **(proposed)** are mine and are built as written unless Rowan changes them.

## Where it stands (2026-11-15)

Merged into main and pushed, not released (no new `v*` or `template/v*` tag):

| What | Where | State |
|---|---|---|
| Rocco: checkouts, loans, the line, taking back, agents at once, feature agents in checkouts, the card's Load into a lane, Settings, README and LEAD.md | Rocco's `main` | 54 of 54 server tests pass (7 of them new), and the app's lint, type check and 20 tests pass. The card's button and the two settings were looked at in the app's demo mode |
| Template: LANES.md, WORKER.md, CONDUCTOR.md and 17 more files, and the worker launcher | The template's `main` | Followed by a Claude worker and a Codex worker on a scratch game |
| Drift | Switched on 2026-11-15 | It took the template's main by hand (`tools\update-from-template.ps1 -To template/main`), ahead of a template release, and its PROJECT.md lane-review rule now follows lent lanes. Both of this PC's lanes matched their fingerprints that day. No task has been run this way in Drift yet |

**Going back:** `git -C _tools\rocco switch --detach fallback/before-lent-lanes`, then start Rocco again. Cards made the new way keep their `work` checkouts on disk; the old Rocco just doesn't know about them.

How it differs from the plan below, and why:

- **A switch is two steps** (the Lync init-folder bug, "Trial results").
- **`return` doesn't move the lane back to main.** A lane just stays on its last commit until the next loan moves it, so `return` is instant and "refresh" no longer touches lanes.
- **A loan ends by itself** when its task is sent back, paused, deleted, or merged and cleared. Nothing has to remember to return it.
- **Merges are made in a task's checkout, never in a lane** (CONDUCTOR.md "Checking before main"), so every change a lane sees goes through the two-step switch.
- **Abandoned loans:** covered by the rule above, not by watching agent processes. A task still marked Working whose agent died keeps its lane until the card is paused, restarted or sent back.
- **A place that closed is opened again by `sync`** (the crash, "Trial results").
- **Not built:** the app doesn't yet show a line of who is waiting for a lane, and Rocco doesn't load a waiting card into a lane by itself when one frees up (the button does it).

## A real task, end to end (2026-11-15)

Run in a scratch game, `E:\RoDev\_trial\LaneTrial` (made from the template branch, with its own folder, its own local "GitHub", two lanes open in Studio, and the build checkout's Rocco serving it on another port). Drift and the running Rocco weren't involved. The scratch game's files are still there; its Studio, Lync and server are closed.

| Step | Who | What happened |
|---|---|---|
| A card, its checkout, and a brief | Me, as the conductor | `work T-001 -Branch agent/welcome-sign` made `work\agent-welcome-sign` |
| The task | A fresh worker agent, given only the brief and told to follow WORKER.md | Wrote 3 scripts (one a folder with an `init.luau`), committed, ran `borrow` (0.8 s, lane 1), ran the checker (matched first time), ran a quiet playtest and measured the result, recorded it on the card, pushed, and kept its lane. 80 seconds, nothing blocked it |
| Ready for the user | Conductor | `set -Status ready -Where lane`: lane 1 became the user's |
| Two more tasks want lanes | Conductor | T-002 got lane 2 (1.1 s). T-003 took lane 1 from the user's testing (3.7 s, including the wait for the folder-script). Both places matched their fingerprints, with nothing left from T-001 |
| Load into a lane | The app's route, on the live server | With every lane busy: "Every lane is busy". After T-003 returned its lane: loaded into lane 1 in 0.4 s, and the place matched |
| Approve | The app's route | Done, waiting on its merge, lane kept |
| Merge and check | Conductor | Merged in the checkout, `sync` (0.8 s), fingerprint matched, a quiet playtest showed the sign and the greeting, pushed to main, `clear`: the lane was freed and the checkout removed |
| A place that closed | Me | Closed lane 2's Studio as a crash would. `sync` opened it again (window back in 4 s), and the place matched |
| Settings | The app's route | Agents at once and keeping a lane were saved, read back, and a number out of range refused |

What the worker said about the docs, all fixed since:

- "Run the checker file through `execute_luau`" didn't say to send the file's contents.
- "Return when done" and "keep the lane you last tested in" read as a conflict. Both the doc and `borrow`'s own text now say: return while you work, keep it after your last test.
- Small things: where `ARCHITECTURE.md` lives, that a place is listed with `.rbxl` on its name, and that `result -File` can be any file.

### The same, with a Codex worker

A second task (a lantern beside the sign, T-004) went to Codex, started with the template's own launcher: `tools\start-worker.ps1 -Agent codex -Checkout ..\work\agent-lantern -Tier standard` (`gpt-6.1-sol`, medium effort). That launcher had never been run with a real worker before.

- **First go: it stopped after 35 seconds, having written nothing.** It tried `rg`, which isn't on this PC, and my brief told it to stop on any failed command. That was the brief's wording, not the workflow. Reworded ("a missing convenience tool isn't a blocker"), and started again.
- **Second go: done in 90 seconds.** Two scripts written and committed, `borrow` in 1.0 s (lane 1), fingerprint matched on the first check (`scripts=5 digest=998262232`), a quiet playtest measured against the config, two checks recorded on the card, branch pushed, lane kept. I ran the checker in lane 1 myself afterwards and got the same line.
- **What it said about the docs:** nothing unclear or missing, on the docs as fixed after the first worker. Two notes that aren't about lanes: the quiet-playtest marker needs the Foundation's module, which a bare game doesn't have, and the Studio MCP prints its own lines in the console.
- **Not known:** Codex's log doesn't record which Studio it passed to each tool, so that it kept to its own place rests on its report and on the results being in lane 1.

One thing found while setting this up, and fixed: **two Lync servers started at the same moment can break one of them.** Lane 1's Lync died with "Unexpected end of JSON input" (each Lync rewrites the shared `lync-config.json` as it starts). The place that then opened never connected. Rocco started its Lync servers back to back the same way, so it now waits for each to be serving before it starts the next. I saw this once in three starts; the cause is my reading of it, not proven.

Still not checked:

- **A feature's own agent** in a checkout (its start is tested, but no real one has built a feature this way).
- **Codex at the settings Drift uses** (ultra effort for the conductor, xhigh for standard workers). The trial used the launcher's own standard tier.
- **Waiting in line with real agents.** The line is tested with stand-ins; in the trial every borrow found a lane or took the user's.
- **The app in a browser against a live server.** Its routes were called directly; the button and settings were looked at in demo mode.

Still to do, each needing Rowan's say:

1. Release Rocco and the template (tags), then "update from template" in Drift, with its PROJECT.md rule changed to match.
2. Delete `E:\RoDev\_trial` when you've looked at it.

## Trial results (2026-11-15, WKEYSTUDIOS1680)

Run in lane 8, which this PC never uses, on its own Studio and Lync. A fingerprint of every script (count, length and a hash of each) was compared between the place and the files on disk after each switch.

| Switch | What changed | Place matched disk | Time |
|---|---|---|---|
| main to a task branch | 1 script added, 6 changed (`SplineGen`, `SplineMesh` among them) | Yes | under 5 s |
| back to main | 1 script deleted, 6 changed | Yes | under 5 s |
| main to 10 commits back | 8 deleted, 26 changed | Yes | 0.5 s |
| 10 back to 250 back | about 250 deleted | **No: 4 scripts left behind** | |
| 250 back to main | 260 added (3.7 MB of source) | Yes | 2.6 s |
| main to 250 back, two-step | about 260 deleted | Yes | 4.9 s |
| 16 switches in a row between four commits, two-step | adds, deletes, and the large road files every time | Yes, and Studio stayed up | |

- **The 4 leftovers have one cause, and a fix.** When a folder that is itself a script (it has an `init.luau`) is deleted in one go, Lync leaves that script in the place. Plain folders and ordinary scripts go as they should. Deleting the `init.luau` first, waiting for Lync to turn the folder into a plain one, then deleting the folder removes it every time. So a lane switch is **two steps**: the init files of folders the target doesn't have are deleted first, then, 2.5 seconds later, `git switch`. Git accepts this, and the lane is clean afterwards. The same two steps clear a leftover that's already there.
- **The Studio crash on large live syncs happened once in about 22 switches.** PROJECT.md records six lane crashes on 2026-11-15, each just after Lync pushed an edit of a large road file. The first 21 switches of this trial, into a place in Edit mode holding only a baseplate, went through. The 22nd (main to 250 commits back, run by Rocco's own switch code) took Studio down about 3 seconds later, with a crash dump. So the crash comes with live syncs in general, not with anything lanes-a-task does, and it's occasional. A lane-a-task worker triggers a live sync on every save; a lent lane gets one per `borrow` or `sync`, so lending doesn't raise the exposure.
- **Reopening is quick and exact.** After that crash, opening lane 8's place again (code already on disk, place file holding no scripts) took **16 seconds** until the place matched the checkout exactly. So a lane on loan whose place has closed is opened again by `sync`, and the agent waits for it and checks the fingerprint.
- **An option this leaves open (not built): switching by reopening.** Rocco could close a lane's Studio, switch its checkout, and open it again on every loan: about 16 to 20 seconds each on this PC, a Studio window appearing each time, and no live sync at all, so no crash from one. Worth it only if the crash turns out to be frequent under lent lanes.
- **Rocco's fingerprint and the checker agree with the real place:** `scripts=297 digest=1711652635` from both, on main.
- **A cold open only adds.** When Studio opens a place, Lync adds and overwrites scripts but removes none. A lane place that was saved with scripts in it keeps any that have since been deleted from the repo. That's true today as well (`DR-Lane2.rbxl` and others were saved with scripts in them). `borrow` prints the count and fingerprint the place should have, so the agent can check it.

## What changes for you

- **More work at once.** Every task, and every piece of a feature, gets its own checkout of the game: a folder, about 13 MB. Agents write code there without needing a lane, so there's no cap of 4 (MONSOONPC) or 2 (WKEYSTUDIOS1680) on what's in progress.
- **Lanes become test slots.** They stay open in Studio all the time, as now. An agent borrows a free lane when it's ready to test, loads its branch into it, tests, and hands it back. Your lane count now means "how many things can be tested at once".
- **Features can split.** A feature's pieces each get their own branch off the feature's branch and build side by side. The feature's agent merges them and tests the combined feature before it reaches you.
- **Testing a card.** When a card goes to To test, Rocco loads its branch into a free lane and the card says which one. If no lane is free, the card has a **Load into a lane** button.
- **What stays the same:** Main is yours, code reaches `main` only after it's checked in a lane, claims, the Workboard, approvals, and Studio staying open.

Left out: closing Studio when it isn't needed, and freeing memory. That's the other model; it can be added later by closing a lane that's been idle a long time.

## How it works

### Two kinds of folder

| Folder | What it is | Studio and Lync | How many |
|---|---|---|---|
| `<Game>\work\<task-slug>\` (new) | A git worktree on the task's branch. The agent works only here. | None | One per task in progress |
| `<Game>\lanes\laneN\` (as now) | A git worktree that's always clean, on a detached HEAD. Its Lync never stops. | Its place stays open | As many as this PC opens |

### Lending a lane

A lane is lent by commit, not by folder. Git won't let one branch be checked out in two worktrees, but a lane doesn't need the branch, only its commit.

1. **Borrow:** `rocco.ps1 borrow T-012`. Rocco picks a free lane, records the loan on the card, and switches the lane to the task's latest commit, in two steps ("Trial results": init files of folders that are going, then `git -C <lane> switch --detach <commit>`). Lync is already running in that lane, so it sees the files change and syncs them, deletions included. The command prints the lane, its place name for the Studio MCP, and the script count and fingerprint the place should now have.
2. **Sync again:** after new commits, `rocco.ps1 sync T-012` does the same switch again. Uncommitted edits don't reach the lane, so the agent commits before each test. Workers already commit in small steps.
3. **Return:** `rocco.ps1 return T-012`. The lane is free at once, and stays on that commit until the next loan moves it.
4. **Every lane busy:** `borrow` waits, and the card's step says "Waiting for a test lane". Rocco hands lanes out in the order they were asked for.

The lane's git work stays non-destructive: switches only, with no reset, restore or clean.

### Why not repoint Lync at the task's folder

That was my first idea, and Lync's source rules it out:

- When the plugin reconnects to a server, it adds and overwrites but never deletes. Scripts from the previous branch would stay in the place.
- After its server stops, the plugin doesn't reconnect by itself. It waits on **Resume**, which needs a click in Studio.

A `git switch` inside a lane whose Lync keeps running avoids both problems. Lync's watcher reports each deleted file, and the plugin removes it within about half a second. Lync compares modification times by inequality, so any changed file is sent.

### Your testing

- When a card turns ready with `-Where lane`, Rocco borrows a lane for it in your name if one is free.
- A lane held for your testing goes back to the pool when you approve or send the card back.
- **Taking a lane back (proposed):** if an agent is waiting and every lane is held for your testing, Rocco takes back the one that's been waiting on you longest. That card then shows **Load into a lane** again. Loading takes seconds, because Studio is already open.
- **One lane kept for you (proposed, off by default):** a setting that keeps your testing from ever being taken back.

### Features with pieces

1. The feature's agent (its lead) gets `work\<feature>\` on `feature/<name>`. It no longer keeps a lane for the feature's whole life.
2. Its pieces are workers. Each one gets `work\<piece>\` on `agent/<piece>`, branched from `feature/<name>`, and each borrows a lane to test.
3. The lead merges the pieces into `feature/<name>` in its own folder, borrows a lane, and tests them together.
4. You test the feature in a lane. Then the conductor merges `feature/<name>` into `main` through a lane, as CONDUCTOR.md "Checking in a lane" does now.

Pieces running side by side still own separate files, as claims require. Two pieces that would touch the same file go one after the other.

### Limits

- **Agents at once (proposed):** a per-PC setting, defaulting to twice this PC's lanes: 8 on MONSOONPC, 4 on WKEYSTUDIOS1680. Without a cap, a big plan could start 15 agents at once. Tasks past the cap wait in Up next. This replaces `-ForLane`, which parks a task until a lane is free.
- **Abandoned loans:** a loan ends by itself when its task is sent back, paused, deleted, or merged and cleared.
- **Leftovers in a place:** anything a borrower builds by hand in the lane's place, like a stand-in track, stays there for the next borrower. **Rule (proposed):** test fixtures are built in code under `src/`, or removed before `return`.
- **A branch that changes `default.project.json`:** Lync doesn't watch the project file, so that lane's Lync needs a restart, and the Lync plugin may wait on Resume. It's the same as today, and rare.

## Steps

| # | Step | What it touches | Tier |
|---|---|---|---|
| 1 | **Trial first.** In an idle lane, with its Lync running: switch between two branches that add, delete and change scripts, then switch across a large change. Measure how long the place takes to match, and check that nothing is left behind. If it fails, I come back to you before building anything. | Measurement only | Light |
| 2 | Task checkouts and lane loans in Rocco's server: `work\` folders made and removed, `borrow`, `sync` and `return`, waiting in order, taking back from your testing, abandoned loans, the agents-at-once cap | `server/lanes.ps1`, `tasks.ps1`, `rocco.ps1` | Heavy |
| 3 | Leads and spawning: leads get a `work\` folder, not a kept lane; feature pieces branch from the feature | `server/leads.ps1`, `conductor.ps1`, `thread.ps1` | Heavy |
| 4 | App: lanes in the sidebar show who has them (an agent testing T-012, or you testing it), the card shows its lane and **Load into a lane**, Settings gets agents at once and the kept lane | `web/` | Standard |
| 5 | Template docs: WORKER.md (work in `work\`, borrow to test), CONDUCTOR.md (spawning, features with pieces, merging), LANES.md (lanes as test slots), TESTING.md (fixtures). Drift's PROJECT.md rule about keeping the lane until approval changes to match. | Template repo, Drift `docs/game/PROJECT.md` | Standard |
| 6 | Tests and release: Rocco's tests for loans and taking back (with the `ROCCO_NO_CONDUCTOR` guard), then a Rocco release and a template release | `tests/`, tags | Standard |

### Switching over

- Tasks already in a lane when this ships carry on the old way until they finish. Rocco tells them apart because the card has a lane but no `work\` folder.
- Rocco runs the new flow only for a game whose template has the new docs. Friends on an older template keep the old flow until they take the update.
- Step 1 needs an idle lane and no conductor handing out lanes meanwhile, so it waits for a quiet moment. Right now Drift's lanes 1 and 2 have overnight work in them.

## Open questions for you

1. Taking a lane back from your testing when agents are waiting, or a kept lane for you, or both?
2. Agents at once: is twice the lane count right?

# Plan: Rocco never takes the PC's memory again

Status: approved and built on 2026-11-16 (README.md "Memory"), with the defaults as proposed: restart above 3 GB, and no new agent below 6 GB free.

**Where the build differs from the plan below:**
- **Step 3 goes through the conductor's Stop hook, not a `[message]`.** A message reaches the conductor only through its `wait`, and the point is that the `wait` stopped. So when the conductor tries to stop with nothing watching (or with work waiting), the hook keeps the turn going and asks it to start the watch again, saying how much memory is free. Last night's conductor would have been asked exactly then.
- **The conductor itself is still opened when memory is short.** Nothing gets sorted without it, and it uses little. Workers and features' own agents wait.
- **Docs and History weren't leaking.** Measured after a full garbage collection, they hold the same memory after 120 calls as after one: the growth seen first was garbage not yet collected. Connections kept two errors per check (looking for Codex and Gemini, which aren't installed). That's fixed, and the server now clears PowerShell's error list after every request.

## What happened on the night of 2026-11-15

- **It was Rocco's server.** It started at 14:09 and grew to about 44 GB of the PC's 62 GB by morning. Rowan stopped it, and the conductor's window, at 10:44 on 2026-11-16.
- **How we know:** Windows logged the conductor's window as not responding at 10:44 (it was started at 14:12:51, the second the conductor's first step was logged). Task Manager showed two PowerShells together: the 44 GB one and a tiny one. Of the two, only Rocco's server does any work while nobody's using it, and its log ends with no "Quit", so it never shut down cleanly.
- **When it hurt:** by 03:57 the PC was nearly out of memory. Claude Code stopped the conductor's Workboard watch to free some, and told the conductor not to start it again, so from 03:57 the conductor no longer saw new work.

## What it isn't (measured on 2026-11-16)

| Tried | Result |
|---|---|
| Rocco left alone with one tab open, 15 minutes | Flat at about 280 MB |
| Each request the app makes, 100 times each, on the live server | The board, the chat, sessions: about 1 MB per 100 calls. Usage: a one-time 178 MB cache, flat after |
| 3,000 agent hooks (one per step an agent takes) on a copy of Rocco | Memory Rocco actually holds rose from 51 MB to 76 MB. Private memory stopped near 270 MB |
| The conductor's `wait`, against a copy of Drift's whole board, 2 minutes | Flat at about 130 MB |
| Windows' process lookups Rocco makes on each look at the board, 300 times | About 20 KB a call |

**Small leaks found:**
- Connections grows Rocco by about 0.5 MB a call, and each call adds two errors to PowerShell's error list.
- Docs and History grow it by about 0.1 MB a call.

The app checks Connections every 5 minutes, which is about 115 MB a night. None of these explains 44 GB.

**Not found yet: what actually grew.** It took the night's real conditions: a conductor, a feature agent and workers running for hours, Studio and Lync, and whatever views were open in Rowan's tab. Those can't all be replayed in a test, so the plan is to **catch it the next time it starts, and make sure it can't take the PC down meanwhile.**

## The plan

### 1. Rocco keeps a memory log
Once a minute, Rocco writes one line to `%APPDATA%\Rocco\memory.log`:
- its private memory
- how many requests of each kind it answered that minute (the board, hooks, chat, sessions, connections and so on)
- the size of its caches

That's a few KB an hour. The file is cut back to its last 7 days. The next time memory climbs, this log shows what was being asked when it did.

### 2. Rocco restarts itself past a limit
When its memory passes the limit, Rocco restarts itself between two requests. It's the same restart it does after an update, so:
- the tab reconnects by itself
- agents carry on, since they work from files
- the few hooks sent during the 5 seconds it's down are dropped quietly, as when Rocco isn't running

Before restarting, Rocco writes a full memory report to the log: what it held after cleaning up, the size of each cache, and the number of errors. The app then says once that Rocco restarted to free memory.

- **The limit:** 3 GB by default. Rocco normally sits at 0.3 to 0.6 GB. You can change it in Settings, under "Restart Rocco above".
- **Why a limit as well as finding the cause:** whatever the cause turns out to be, Rocco can never again take more than the limit.

### 3. Tell the conductor to watch again
After a memory restart, or whenever the conductor has stopped watching the board for more than 2 minutes while it's open, Rocco sends it a `[message]`: "You stopped watching the Workboard. Run wait again." Last night the conductor stopped listening at 03:57 because of a note telling it not to restart its watch. This message is what restarts the watch.

### 4. A memory check in the app
- **In the sidebar:** this PC's free memory, under the lanes, in amber below 8 GB and red below 4 GB.
- **Behind it:** a route, `/api/debug/heap`, that cleans up first and then reports what Rocco really holds. It's the same check used for the measurements above.

### 5. Fix the small leaks
- **Connections:** find the two errors each call raises, fix them, and clear PowerShell's error list after each request. Each saved error keeps the objects it mentions in memory.
- **Docs and History:** find what they keep growing, and cap it.

The tests check that 200 calls of each leave Rocco's held memory within 10 MB of where it started.

### 6. Fewer agents when memory is short
Before Rocco opens an agent (a worker, a feature's own agent, or a conductor), it checks the PC's free memory. Below 6 GB, the task is parked as it is when every agent is busy, and the card says why. It starts once memory is back.

On 2026-11-16 Drift's five open places used 3.1 to 4.7 GB each, about 20 GB together. Each agent took 0.3 to 0.8 GB. So 4 lanes plus 8 agents at once is close to this PC's limit when Studio is heavy, even without a leak.

## Checking it worked
- The tests cover each of steps 1 to 6:
  - the log line
  - a restart past a limit, set low for the test
  - the conductor's nudge
  - the heap route
  - the leak fixes
  - parking when free memory is short (both stand-ins for the test)
- Then a night with real work: in the morning, `memory.log` shows whether Rocco stayed flat. If it climbed, the log names the requests that climbed with it, and the cause gets fixed next.

## Open questions for Rowan
1. Restart Rocco above 3 GB by default?
2. Park new agents when free memory is under 6 GB?

# A feature's own agent

You were opened by Rocco to build one feature (or to carry one card through), in a lane of your own. The user talks to you directly, in that feature's thread in Rocco, the way they would in a chat with you. This is what's different from being the conductor or a worker. The game's own rules still apply: `AGENTS.md`, and for how to work in a lane, `docs/workflow/WORKER.md`, `CODING.md` and `TESTING.md`.

Rocco's commands are `..\..\..\_tools\rocco\rocco.ps1` from your lane (`README.md` there lists them all). Your window knows which thread is yours, so `wait`, `say`, `ask`, `doing` and `list` are about your feature without you saying so.

## What you are

- **You build it yourself.** You are not a manager: you read the code, write it, run it and test it, in this lane, on one branch for the whole feature (`feature/<name>`). When the user says "make the accept button green", you are the one who wrote the window, so you change it.
- **One lane, kept for the feature's life.** It's yours between steps too. Its place in Studio is where the user tests each step. Never touch Main: it's theirs.
- **The conductor merges.** You never merge into `main` or push it. When the user approves a step, the conductor merges your branch. Pull `main` into your branch when it has moved (`git merge origin/main`), so the next merge is clean.
- **Helpers are for separable work only:** a step the plan marks as independent of the one you're on, a wide search, a test or playtest run, a review of your own work before you call it ready. What a helper builds comes back to you, to bring into the feature's branch.

## Starting

1. `rocco.ps1 show <the feature's id>`: its plan, its steps, its spec (read the spec, and `docs/game/DECISIONS.md`).
2. `rocco.ps1 list -Pending`: what waits on you. The first time, that's the approved plan.
3. Check the lane: `git status`, its branch, that its place is open and syncing.

## Each step

1. **A task for the step:** `rocco.ps1 new -Title "<the step, in a few words>" -Plan <the feature's id>`. It prints the task's id.
2. **Say you've started:** `rocco.ps1 set <task> -Status working -Lane <your lane> -Branch feature/<name> -Step "..."`. Update `-Step` (and `-Progress`) as you go: the user watches the card.
3. **Build it,** committing on the feature's branch as you go.
4. **Check it,** then put what you ran on the card: `rocco.ps1 result <task> -Pass -Text "12 of 12 tests pass" -File <the output, as a text file>`. A failed check goes on the card too (`-Fail`): the user should see it.
5. **Ready:** `rocco.ps1 set <task> -Status ready -Where lane -Summary "what changed" -Test "Open the trade window","Offer a car"`. A summary and a test are 30 words each at most.
6. **Carry on with the next step** while they test, unless it builds on something they might change. One step at a time is the rule; two when the second is independent.

When the user approves the last step, the feature is done and Rocco closes your session. You don't need to do anything.

## Talking with the user

- **They read you in the feature's thread.** With Claude Code, what you say at the end of a turn shows there by itself, and so do your questions (AskUserQuestion) and permission prompts. Any other agent: `rocco.ps1 say -Text "..."` and `rocco.ps1 ask -Question "..." -Options "A","B"`.
- **A decision is a question.** When the plan leaves something open that the user would want a say in (how it looks, what a player can do, a price, a name), ask, with the options. Rocco keeps each question and its answer in the feature's list of decisions, so the path stays readable later. Add the ones that matter to `docs/game/DECISIONS.md` too.
- **Keep it short and plain:** what's done, what you need from them. No file paths or test tallies unless they ask.
- **Between jobs, watch for what they send:** run `rocco.ps1 wait` as a background command. It returns the moment something waits on you, and you start it again once you've handled what it listed. Rocco won't let a turn end with nothing watching.

## What waits on you

`wait` and `list -Pending` show these. `rocco.ps1 show <id>` says exactly what to do for each.

| | The user | You |
|---|---|---|
| `[approved]` | Approved the plan | Start the first step, then `clear <the feature's id>` |
| `C-… [message]` | Wrote to you in the thread | Act on it, then `clear C-…` |
| `C-… [answer]` | Answered a question of yours | Carry on with it, then `clear C-…` |
| `[reopen]` | Tested a step: not right yet | Their words are the last `you` line in `show`. Fix it, on the same task (`set -Status working`) |
| `[followup]` | Added something to a step while you worked | Fold it in, then `clear` |
| `[answer]` | Answered a question on a stuck step | Carry on, and `set -Status working` |
| `[revise]` | Asked for changes to the plan | `set <the feature's id> -Summary "..." -Steps ...`, then `clear` |
| `[stop]`, `[resume]`, `[restart]`, `[assign]` | Paused a step, resumed it, or asked for it to be started again | As `show` says |
| `[cancel]` | Deleted a step | Stop work on it, then `clear` |

## Keeping your head clear

A long feature fills a session. At the end of each step, write where things stand in the feature's notes (`show` gives the path of `notes.md`): what's built, what's decided, what comes next and anything the next step must know. If your session ends, or the user restarts you, Rocco opens a new one and you pick up from the plan, the decisions, those notes and the branch. The thread the user reads is kept by Rocco, so nothing is lost on their side.

## A card of your own

If you were given a single task instead of a feature (the user gave a card an agent of its own, usually after sending it back a few times), it's the same, with one step: that task. Read its history first (`show`): what was tried, and what they said was wrong each time. Ask before trying a fourth guess.

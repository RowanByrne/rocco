# Plan: show that an answer is coming

Status: approved and built on 2026-11-16 (README.md "The conductor in Rocco").

**Added while building:** Rowan's message at 12:15 that day ("explain how the runoff is generated") looked unanswered, and no card was made. The conductor had answered it in full, but only in its own window: it wrote the explanation, ran `clear` and `wait`, and ended its turn on "The worker on the failing road tests is still running". Rocco copied only that last line into the chat. Now, at the end of a turn, Rocco also posts anything of 280 characters or more the agent wrote earlier in that turn, read from Claude Code's session file. Tested on that session, it finds exactly the lost answer and none of the short step lines.

**One change from the plan:** the time the conductor last ended a turn is kept on its record (agent.json), not just in the server's memory, so a restart of Rocco doesn't make old messages look "on it". A message picked up by an earlier conductor session shows nothing either.

## The problem

What you send in the chat shows at once, as your message. But nothing under it says whether Rocco has it yet, is working on it, or is done with it. Cards used to show this by moving from Up next to Working. Now a message only gets a card when the conductor makes one, and a question never does. So after sending, you watch the chat and guess.

## What Rocco knows today, and what it doesn't

Measured on Drift's chat, 2026-11-16:
- **Every message gets marked handled in the end:** 94 of 94, a median of 82 seconds after sending. The conductor marks one with `clear` or `reply`.
- **But handled doesn't mean answered.** In 68 of the 94, the conductor marked it handled before it said anything, often the moment it read it. So handled can't tell "on it" from "done".
- **What Rocco doesn't record: when the conductor picked the message up.** It's handed over by `wait` (or `list -Pending`, or the stop check), and nothing is written when that happens.

So the build adds that one record, and works out the rest from what's there: whether the conductor is running, busy or listening, and what it said since.

## What you'll see

A small line under your message, where "Sending" and "Sent" show now, at the right, in grey:

| When | Under your message |
|---|---|
| No conductor is running. Sending one a message opens it | **Starting Rocco…** |
| The conductor is busy with something else and hasn't picked it up | **Rocco reads it next** |
| It's listening, but hasn't picked it up yet (a few seconds) | **Rocco is reading it…** |
| It has picked it up and is working on that turn | **Rocco is on it**, with three dots that pulse, like typing |
| It has gone quiet for 5 minutes on that turn (the bar above already offers its window or a restart) | **Rocco has gone quiet** in amber |
| Its turn ended (it's listening again, or stopped) | Nothing. Its answer, or the card it made, is right below |

- The line is shown only on messages still in that state, so it doesn't fill the chat.
- Several messages picked up together each show "Rocco is on it" until that turn ends.
- A message typed in the conductor's own window gets no line. It says "in its window", as now.
- Feature threads work the same, with their own agent: "Its agent reads it next", "Its agent is on it".

## The build

### 1. Record when a message is picked up
When `wait`, `list -Pending`, or the stop check hands the conductor a message or an answer for the first time, Rocco adds a line to the thread:

```
{ kind: "seen", to: <its id>, at }
```

It's written once per message. Like every thread line, it's only appended, so the agent's commands, the hooks and the server can all write at once.

### 2. The chat works out the line
- Each message is given its `seen` line, as `made` and `answered` lines are now.
- Together with the conductor's state (none, listening or busy) and when it last ended a turn, that's all the table above needs.
- **"Its turn ended":** the conductor was listening or stopped at some point after the message was seen. The server already knows when the conductor last ended a turn (its Stop hook). The board's conductor state will carry that time as `turnEndedAt`, so the app can compare.

### 3. Small things
- Messages from before this build have no `seen` line. Any message that is already handled and older than the conductor's last turn end shows nothing, so the old chat stays quiet.
- After the server restarts, the turn-end time it remembers is lost. Until the next turn ends, "Rocco is on it" ends when the conductor is listening again, which the board always knows.

## Checking it
- **Tests:**
  - `wait` writes `seen` once per message, and a second `wait` doesn't write it again.
  - The thread page includes `seen` lines.
  - The board's conductor state carries `turnEndedAt`.
- **The chat's line,** checked in the browser against the demo data, with one message in each state of the table.
- **Then in Drift:** send a note and watch it go from "Rocco is reading it…" to "Rocco is on it" to nothing as the answer lands.

## Open question for Rowan
The wording in the table. In a feature thread, "Rocco" becomes "Its agent".

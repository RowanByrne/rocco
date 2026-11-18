# Plan: Approve and close, at the top of a task to test

Status: approved and built on 2026-11-16 (README.md "The app"). The open questions went with the plan: the chat says "Asked for more", and the round check on the board's To test cards stays.

## The problem

A task in To test opens with a big green **Approve** button under what to try, and a box at the bottom that says "Not right yet? Say what's wrong… and press Enter to send it back". Together they say: this is done, pass or fail it. But often the user wants to keep going in the same direction, building on what's there. That isn't "wrong", and it isn't "approve" either.

## What changes

1. **Approve moves to the top bar of the sheet, next to the close button (×), as a small "Approve and close" button.**
   - It has a green check, but a small outlined button, not a big filled one.
   - It does what Approve does now: it closes the sheet, approves the task, and offers Undo for a few seconds.
   - It's only on tasks in To test. A question keeps "Got it", and a plan keeps "Approve plan".
   - The big Approve under "Try" goes away. The Try box keeps its steps and its "Load this lane" button.

2. **The box at the bottom asks for more, not for what's wrong.**
   - Placeholder: "Keep going: what next, or what's not right. Paste or drop a screenshot, and press Enter to send it to its worker."
   - The send button's tooltip: "Send to its worker (Enter)", instead of "Send it back".
   - What it does doesn't change: the task goes back to its worker with the text and screenshots, as now.

3. **The words after sending say "more" too.**
   - The toast: "Sent to its worker" instead of "Sent back to Rocco".
   - The chat line under your message: "Asked for more" instead of "Sent back". The same in the line that says what you did ("You asked for more on…").

## What stays

- The round check on a To test card on the board ("Tested, approve") stays. It's small and quick, and it's for when you've already tested.
- Nothing on the server changes. The action is still `reopen`. Only the words and the button's place change.

## Checking it

- In the browser, on the demo: a To test task shows "Approve and close" at the top, no big button under Try, and the new words in the box. Approve and close approves it and Undo takes it back. Sending from the box sends it back to its worker.
- The web tests still pass.

## Open questions for Rowan

- Is "Asked for more" right for the chat line, or keep "Sent back" there?
- Should the round check on the board's To test cards go too, so approving only happens from the open task?

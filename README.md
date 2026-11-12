# Rocco

Rocco is the web app for making games from this template. One Rocco serves every project in the RoDev folder.

- **Workboard:** a chat with your agent in the middle, and the cards beside it.
  - **The chat** ("The chat", below) is the conductor's thread: what you send, what Rocco says and asks, and a line for each thing that happens to a card (started in a lane, ready to test, merged), which opens the card. Its steps fold away between messages. A card named in the chat shows as a small chip with where it is now.
  - **The note box** is under it: type or say a message, with screenshots pasted, dropped, attached or captured straight from Studio with Alt+S (and a pen to mark them up). **Auto** leaves it to Rocco to sort ("Sorting"): a question is answered in the chat with no card kept, a fix becomes a card, a feature is planned first. **Fix**, **Ask** and **Feature** say which it is yourself. **Reply** on one of Rocco's messages makes the next thing you type a reply to it; **Reply** on a line about a card files it into that card (sent back if the card is waiting to be tested, added to it otherwise).
  - **The cards** are in a rail on the right, by where they are. **To test**: tick one to approve it. **Needs you**: a stuck card asks its questions on the card, with play buttons for sound options and pictures for picture options (click one to see it big, flip through the others with the arrow keys, and pick it there), and the last answer sends them all, with a few seconds to undo; a feature plan to approve; and what the agent spotted, to queue or dismiss. **Working**: each with its latest steps. **Up next**: the queue in order, which you can drag but never ahead of a task it waits on. Click a group's name to fold it. On a narrow window the rail is a row of counts above the chat, which opens to the lists.
  - **A card opens over the page**, which dims behind it (a click off it closes it), as its own conversation; a feature plan's card opens in the chat's place instead, with the rail still beside it: what it is, what to try and Approve, its questions, what it changed, and its **session** ("A card's session", below): everything its agent did and said, live, with your words and Rocco's in between. Typing in it sends its agent a message (Enter). A card to test has a box that's always open for sending it back: say what's wrong, with screenshots pasted, dropped or attached (and drawn on, as in the note box), and Enter sends it back, the screenshots named in the message. A feature plan's card has its steps, a summary of what it builds and leaves out, Read the spec when it has one, Approve, and a box to ask for changes. **Chat**, the close button or Esc goes back. Every card has Delete in its header, a trash can (a second click confirms, with a few seconds to undo): a deleted plan takes its unfinished tasks with it, and work that's running or not merged yet goes to the conductor to stop (`[cancel]`, once Undo has passed). What's already merged stays in Main.
  - **A feature you approve gets a tab** above the chat, with an agent and a thread of its own ("Feature threads"): its steps are pinned at the top, the rail lists its cards, and what you type goes straight to its agent. A card that keeps coming back offers the same, on its third attempt.
  - **A card also has:** its time at work and the tokens its sessions used, under its title ("A card's session"); **Pause** (its worker stops and its branch is kept, until **Resume**) and **Start again** (a fresh worker, from what the last one left) as icons in its header by Delete, each saying what it does when hovered, and the lane and worker to use under its title, on a task that's queued, working or stuck (the conductor does each: Commands, `[stop]`); the **checks** its worker ran, each with its output a click away (`result`); **What changed** file by file, where a file opens to its lines as git shows them; and a button that copies a link to the task (`#task/T-049` in the address opens it).
  - **Archive** (by the approved count) lists what the board no longer shows: tasks approved more than three days ago, or deleted. It searches every word of a task (title, note, summary, history), and a row opens the task as it was. **Usage** lists what each task took, by feature: time at work and tokens.
  - **Nothing typed is lost:** the note box, a card's box, half-picked answers and what's typed to the conductor are kept in this browser, per project, until they're sent. A send that fails keeps them, and says so.
  - **The conductor** is your agent's session that handles the board. The status line under the note box says whether one is listening (watching the board with `rocco.ps1 wait`), working (and on what), or not running ("The conductor in Rocco", below). When you hand something over (a note, an answer, an approved plan) and none is running, Rocco opens your agent in its own window (minimized in the taskbar) as the conductor, on what's waiting; **Start** does the same for work already waiting. Tasks left Working with no conductor running were cut off (its window closed): **Carry on** opens a new one that picks them up from the board and the lanes.
- **What agents write** (Rocco's messages and questions, answers, summaries, steps to try, plan summaries) shows as Markdown, with a terminal's habits tidied as it's shown: ALL-CAPS lead-ins turn bold in sentence case, `--` turns into a dash, and commit hashes drop out of sentences. A task's id shows as its name and opens it; a doc's path opens the doc. The text itself stays as written.
- **History:** the build live on Roblox and earlier releases, main's recent commits (bookmark any of them), the branches not yet merged, and a card per lane (busy ones first) showing what's been done in it. A lane holding commits main doesn't have yet shows "Checking before main": the conductor checks merges and its own fixes in a lane before they reach main, so the Main place is yours.
- **Docs:** every Markdown file in the repo, by folder; hover one for its first lines and sections. Open one to read it (mentions of other docs open them), ask your agent to change it (a note in Up next), or edit it and push: the edit is committed on main as you, only that file, and pushed, with GitHub's main merged in first. A doc that changed since you opened it isn't overwritten without asking. In a game, the template's own docs (AGENTS.md "Template-owned files", and `rocco/`) can't be edited here; your agent changes them through the template. **Add game details** opens the onboarding's detail tiles for the open game.
- **Onboarding:** New project is a short survey, and it opens by itself the first time Rocco runs in a RoDev folder with no games yet. The first choice is a new game, or one already made: on GitHub, in a folder, in a place file, or only in Studio. Then come the name and code, and questions one at a time; every answer is free text and optional. The questions are the template's `tools/onboarding.json`, so they change with the docs they fill. The project is made in the background while you answer (`new-project.ps1`, with `-Existing` for a game already made). A survey left half-way is kept in the browser.
  - **Your accounts** comes first, once per browser. No AI plan comes with RoDev, so it lists what each tool runs on: a coding agent (one is enough), Codex for images, and GitHub, ElevenLabs and the Roblox key for later. It checks each one on this PC, asking the tool itself where it can (`claude auth status`, `codex login status`). Installing or signing in is one click: the tool's own command, in a window of its own. Rocco checks again when you come back. After that, the survey's first screen warns when your agent isn't ready, with a button to it; Settings and Connections open it any time.
  - **Lanes:** a new game then asks how many lanes this PC can run, suggesting a number from its memory and threads (about 3 GB a lane, less the Main place and room for other apps, and no more than one per two threads).
  - **On finishing,** the answers are committed as the game's `docs/game/ONBOARDING.md`, this PC's lanes as its row in PROJECT.md "Workstations", and both pushed. Then the lanes open in the background (`rocco.ps1 lanes`): the Main place and each lane's, in Studio, with Lync serving each.
  - **Your agent then opens** in a window of its own, minimized, as the game's conductor, on the template's `docs/workflow/SETUP.md`: it writes the first docs from your answers, including a spec for the first build, then posts the prototype's feature plan, linked to that spec, for you to approve. Nothing is built until you do. The docs card needs no review: it approves itself when it's ready. A conductor already running gets the card instead. Without an agent installed, the card waits in Up next, with the prompt to copy.
  - **Detail tiles** (monetization, economy, progression, and more) add answers then or later, and **Send** hands them to the agent the same way.
- **Connections:** what the open project needs, not every tool on the PC (Rocco isn't a plugin manager).
  - **Needs attention** lists only what affects this project: its own links and libraries, the vital things below, and a linked account that stopped working. Updates count only for the template, the game's libraries and Rocco; other tools show theirs on their rows. With nothing to do, one line says so.
  - **Vital** is what Rocco and the template can't work without, in the order they're set up: your agent and Codex (for images), signed in or not (the same check as onboarding's accounts screen), then Git, GitHub, the template, the commit check, Roblox Studio, Lync, Studio sync, the Studio MCP and Rocco. Each row says what it's for, and has its fix.
  - **Everything**, vital or not, follows by kind, as tiles with the full picture of each: this project, AI, Roblox, Roblox plugins (listed, never flagged), the game's libraries, and developer tools.

  The Template row shows which template release the game is on; when a newer one is out, it shows what's new and asks your agent to bring it in (the template's TEMPLATE.md). Rocco's own row does the same for Rocco, and updates it in one click ("Updating"). Every fix is one click, its command still shown in the details for doing it by hand:
  - **Quick fixes** Rocco does at once: turning on the commit check, adding the template remote, connecting an empty GitHub repo and pushing main, pushing main, starting and stopping Lync (with no windows), and giving Git your name and email when it has none (every commit Rocco makes for you needs them). A GitHub repo whose first push failed says nothing is backed up yet, with **Push main** and, in its details, a box to connect a different repo. A push or fetch that gets no answer is given up on, so a dead connection can't hold up the app.
  - **Updates to this PC's tools** (Claude Code, Codex, Gemini CLI, Git, the GitHub CLI, Lync) run in a window of their own, so you see them and can answer an installer's prompts. Rocco waits for the window, then checks again; a window that failed stays open until you've read it.
  - **Changes to the game** (a library, the template, registering the Studio MCP) are your agent's: their button adds a note to Up next.
  - **A Studio plugin** opens its releases page.

  What each button runs is defined in `server/actions.ps1`; the app only names it. The libraries the game vendors (from ARCHITECTURE.md, and TopbarPlus and Cmdr found in `src/`) show with their latest releases. Accounts the tools use are linked here: ElevenLabs for sound, and the user's Roblox Open Cloud key for the game page.
- **Settings:** the theme (light, dark, or whichever the system is on; Dark mode is also a switch in your menu, at the bottom of the sidebar), your agent (kept per PC, with **Your accounts** a click away), the model its conductor is opened on, and whether a feature you approve gets an agent of its own ("Feature threads"); then desktop notifications, live steps on Working cards (or just a progress bar), voice notes, the sidebar's order, and hotkeys (kept per browser).
- **Live ops**, for a game on Roblox (its universe id in PROJECT.md):
  - **Updates:** the game's calendar. The user writes a card for each upcoming update on a month view; the cards live in the game's `live/CALENDAR.md`, where the agent reads them too. Above it, the events on the game page: live, upcoming, and, with the Roblox key, private drafts, which the user publishes in one click. Each update's game page event is the agent's job. Rocco queues it as a Workboard task a set number of days before the update (14 by default, kept in CALENDAR.md), or when the user clicks. The agent drafts the event, and its card images show on the card for the user to pick.
  - **Thumbnails:** the game page's thumbnails and, with the key, each one's impressions and qualified play-through over the last 7 days, plus what the numbers say. Below are directions to try: the agent's, from the game page doc, or Rocco's starters until there are some. One click makes concepts from a direction with Codex (the template's image tool), and **Stop** ends the run (the concepts already made stay; a single image that takes over ten minutes is stopped by itself). The user picks one, and the agent puts it on the game page.
  - **Metrics** and **Ads:** coming soon.

  What Roblox makes public needs no key; the rest uses the key linked in Connections. Most of these Roblox APIs are experimental, so a part that fails is just left out.
- **The sidebar:** the views in categories (Project, Live ops, System). Click a category's name to fold it; a folded one still lights up when its open view or a badge is inside. Drag a category, or a tab within its category, to reorder them. The order is kept in this browser, and Settings resets it. At the bottom are Main and this PC's lanes, each labeled, with a key to their colors: free, working, stuck, holding a finished branch until it's tested and merged, not open (Lync isn't serving it), and down. **A lane that went down** is one with work in it (a worker, or a feature's own agent) whose Lync stopped, whose place closed in Studio, or whose agent stopped: it turns red, the line under the lanes says which and what, and Rocco says so once (a toast, and a notification). **Fix lanes** there opens it again without the conductor: whatever isn't open is opened as Lanes does (a crash's leftover lock is cleared), a feature's agent that stopped is opened again, and the agent with work there is told (a line in its chat), so it checks its place is syncing and redoes what failed. A lane with no work in it is only shown as not open: Rocco can't tell a crash from you closing it. Clicking Lanes says how many this PC runs and opens them (the onboarding's lanes screen); a PC with no row in PROJECT.md "Workstations" yet shows Set up there. **Other projects:** when another game has a card stuck or ready to test, or its conductor is asking something, the project picker shows a dot, each project in it shows how many, and Rocco says so once (a toast, and a notification), so work in one game isn't left waiting while you're in another.

**Your agent.** Rocco isn't tied to one coding agent: Settings picks Claude Code, Codex or Gemini CLI for this PC (the first one installed until you pick). In the app, the agent at work in your game is called Rocco, whichever agent it is ("Rocco is listening", "Ask Rocco to update"); the agent's own name shows where the program itself matters: Settings, Connections, and starting it. Rocco checks it and its Studio MCP registration in Connections, and opens it for onboarding. The choice is kept in `%APPDATA%\Rocco\settings.json`. Another agent is a row in `server/agents.ps1`: how it starts with a prompt, and where it keeps MCP servers.

Rocco himself lives on top of the note box: a little pixel guy who does odd jobs (in a hard hat while workers are busy), reacts to the board, watches you type, and carries your note off when you send it. Click him to say hi.

Ctrl+K opens a palette to find any task, view, project or action; a task's id that's no longer on the board opens it from the archive, and any other words can be searched for there. Hotkeys work while Rocco's window has focus.

For now it runs on this PC: a small PowerShell server, with nothing else to install, serves the app and reads and writes the project folders. Its own repo is `RowanByrne/rocco`; games made from the template (`RowanByrne/rodev_template`) don't carry a copy.

## Install

Once per RoDev folder, into `_tools\rocco` next to Lync, on the newest release. You need Git, and access to the repo (it's private: ask its owner). In the RoDev folder, in PowerShell:

```
git clone https://github.com/RowanByrne/rocco.git _tools\rocco
git -C _tools\rocco checkout (git -C _tools\rocco tag -l "v*" --sort=-v:refname | Select-Object -First 1)
```

Rocco only runs from a RoDev folder's `_tools\rocco`: it finds the projects next to `_tools`.

## Run it

Double-click `tools\rocco.bat` in any project (it's in the template, so every game has it). It serves Rocco on <http://localhost:34860/> and opens it on that project; if Rocco is already running, it just opens it. `_tools\rocco\Rocco.bat` starts it too, on the template.

**No windows to keep open.** Rocco runs in the background (`rocco.ps1 start`), detached from whatever started it, so closing an agent or terminal that ran `rocco.bat` doesn't close Rocco, or the Lync servers, Studio places and agents it opened. So does Lync: its servers have no windows, and what each says goes to `<Game>\rocco\lync\<main or laneN>.log`. **Quit Rocco** in Settings stops Rocco and every Lync server it started, so Studio stops syncing (a Lync you started yourself, in a window of its own, is left running); Connections' Studio sync row stops or starts one project's Lync. What Rocco says goes to `%APPDATA%\Rocco\rocco.log`, with the three runs before it kept beside it (`rocco.1.log` is the last one). Your agent, when Rocco opens it, starts minimized in the taskbar: open it to watch it, or when it asks you something there. Installs and sign-ins still open a window, since they may ask you to type. To run Rocco in a window instead, for debugging: `powershell -File _tools\rocco\rocco.ps1 serve -Open`.

To work on the design without real tasks, open <http://localhost:34860/?demo>: sample data, and nothing is saved.

## Updating

Connections checks for a newer release (a `v*` tag) every half hour, and **Check now** checks at once. When there is one, Rocco shows it under Needs attention with what's new, and **Update** switches `_tools\rocco` to it and restarts Rocco in the background; the open tab reloads by itself. It won't update over changes made in `_tools\rocco`. A development copy on a branch keeps its branch: the branch is moved up to the release.

By hand: quit Rocco (Settings), then `git -C _tools\rocco fetch --tags` and `git -C _tools\rocco checkout v0.2.0`, and start it again.

## Releasing

Rocco is developed on `main`. A copy on a branch is a development copy: it shows `main @ abc1234` as its version, and is never offered an update (it's ahead of every release). To release, tag `main` with what's new as the tag's message (it shows in everyone's Connections), and push the tag:

```
git tag -a v0.2.0 -m "Docs: edit and push from the app"
git push origin v0.2.0
```

Use `vMAJOR.MINOR.PATCH`. Every install on an older release offers the update within half an hour.

**Voice notes** are off until turned on in Settings, because the browser sends the audio to its maker's speech service (Google for Chrome, Microsoft for Edge) to turn it into text. **Notifications** need the browser's permission, asked when they're turned on, and show while Rocco is in the background or its window isn't the one in front.

## Where things are

```
_tools\rocco\
  Rocco.bat              starts the server and opens the app (a project's tools\rocco.bat calls it)
  rocco.ps1              the server, and the commands agents use (below)
  LEAD.md                what a feature's own agent reads first ("Feature threads")
  server/                the server's parts
    core.ps1             the RoDev folder, the open project, Rocco's version, small helpers
    agents.ps1           the coding agents Rocco can open, this PC's choice, opening one in its own window
    tasks.ps1            Workboard tasks on disk
    projects.ps1         projects, lanes, Main, the user, new projects, background jobs
    conductor.ps1        whether a conductor is running for a project, opening one, and Claude Code's hooks for it
    thread.ps1           a thread (the conductor's, or a feature's own): its messages, questions, steps and milestones, and what the user sends it
    leads.ps1            a feature's own agent (or a card's): whose each task is, opening and stopping it, what the app shows for it
    sessions.ps1         a card's session: its agent's session files (Claude Code), found and read as they grow, and what they used
    hook-post.ps1        for a Claude Code too old to post its hooks itself: passes a step, a message or what the user typed to Rocco
    lanes.ps1            how many lanes this PC runs, recording it, and opening them: places, checkouts, Lync, Studio
    connections.ps1      project links, this PC's tools, and Rocco's own updates
    history.ps1          main's commits, open branches, each lane's reflog
    docs.ps1             the repo's Markdown, one doc, saving and pushing the user's edit
    actions.ps1          what each Connections button does (installs and sign-ins too), and pushing main
    accounts.ps1         the user's own accounts on this PC: each agent's sign-in, Codex, GitHub, the linked keys
    onboarding.ps1       the survey, the answers in ONBOARDING.md, handing them to the agent
    roblox.ps1           the game page from Roblox: events, thumbnails and their numbers; the Roblox key
    updates.ps1          the calendar's cards in CALENDAR.md, and queueing their game page events
    thumbnails.ps1       thumbnail directions, concepts made with Codex, and the user's pick
    http.ps1             static files, the API, the server loop
  tests/                 the checks (README.md "Checks")
    run.ps1              the server's tests: the commands and the API, against a game made for the run
    shapes.json          the fields the app counts on in the server's answers, checked on the server and on the demo
    web/                 the app's tests (Node's own test runner)
  .github/workflows/     runs both on every push
  package.json, jsconfig.json, eslint.config.js   what the app's checks need. Rocco itself needs none of it
  web/                   the app
    index.html
    assets/              the icon, the font (Inter) and the tools' logos, all served from here
    vendor/              the one library the app uses (lit, for templates), as a single file, and its types for the check
    styles/              tokens (every color, for both themes), base, shell, components, chat (the Workboard's layout), then one file per view
    src/
      main.js            entry point: wires the parts and decides what re-renders
      api.js             every server call (demo.js answers them with ?demo)
      state.js           shared state and change events
      agent.js           this PC's agent, and its name for the app's wording
      accounts.js        the user's own accounts: the checks, and the rows onboarding and Connections share
      sync.js            polls the open project's tasks, and toasts or notifies what changed
      projects.js        the project list and switching
      router.js          which view shows, kept in the address
      sidebar.js         project picker, navigation (folding and reordering), Main and lanes, the user
      settings.js        the user's settings, kept in this browser
      theme.js           the look: light, dark or the system's
      hotkeys.js         every hotkey action, its default and the user's binding
      capture.js         Studio window capture (the browser's screen share)
      voice.js           speech to text
      notify.js          desktop notifications
      prose.js           what agents write, shown as Markdown: task ids as names, doc paths as links
      demo.js            sample data
      lib/               dom, html (templates), format, icons, brands (logos), storage, drafts (what's half typed, kept through a reload), busy (one request at a time per button), markdown (docs and what agents write), tidy (a terminal's habits, for reading)
      ui/                menu, popover, sheet (slides in, or shows a card in the chat's place), focus (keeping the keyboard inside a dialog), toast, sortable (drag or arrow keys to reorder), shots (screenshots to send), pics (pictures on a question, and seeing one big)
      views/             workboard (the cards' rail, and a card's own conversation), taskparts (a task's worker controls, checks, usage and changed lines), archive, usage, session (a card's session), composer (the note box), conductor (the chat: its tabs, a thread's messages, its questions and status line), history, docs, updates, thumbnails, connections, settings
      dialogs/           onboarding (new projects, detail tiles), markup (draw on a screenshot), palette (Ctrl+K)
```

A project is a folder in the RoDev folder whose `repo\` has `docs/game/PROJECT.md`, or a game being brought in: its own git repo with `lanes\` next to it, before the template is merged into it. A project's Rocco data lives outside git, next to its `repo\`: `<Game>\rocco\tasks\T-NNN\` holds `task.json`, the user's screenshots, sound options for its questions, the output of the checks its worker ran (`check-N.txt`), and the worker's `notes.md`. Bookmarked commits are in `<Game>\rocco\history.json`. The conductor's thread is in `<Game>\rocco\conductor\` ("The conductor in Rocco"), and the thread of each feature with its own agent in `<Game>\rocco\threads\<id>\` ("Feature threads").

**One writer at a time.** The server and every agent's commands change tasks at the same moment. A task read to be changed is held until it's saved (a `task.lock` file in its folder, open with no sharing), and the new `task.json` is written beside the old one and swapped in. So two changes at once can't lose one of them, and nothing ever reads half a file.

**The archive.** A task approved or deleted two weeks ago, with nothing waiting on it, moves to `<Game>\rocco\archive\T-NNN\`, so the board's look at every task stays quick however long the game has run. A feature's tasks stay until the feature itself is finished. An archived task is still found by its id (`show`, a link to it), listed and searched in the app's archive, and comes back to the board if it's reopened. Ids carry on from the highest ever used.

## The chat

The middle of the Workboard is a thread: the conductor's, or, on its own tab, the thread of a feature (or a card) that has an agent of its own. A thread is a folder of the same files whoever's it is ("The conductor in Rocco", Files), and the same code draws either.

- **What's in it:** your messages; the agent's messages (each with **Reply**), its questions with your answers, and its permission requests; what you did to a card ("You approved", then the card); milestones (a plan posted, a card started in a lane, ready to test, merged), each a line that opens its card; and the agent's steps, folded between messages into one line that says what they did ("Read 3 files, used Studio, and ran a command"). Check-ins with nothing in them ("Watching.") aren't shown. The last week is kept.
- **New since you were last here** marks where to read from when you come back to a thread, and a tab with something new in it shows a dot.
- **Under it:** the agent's open questions, each with its own answer box; the note box; and the status line, which says what the agent is doing (listening, working on a step, asking, or not running), the model it's on, and what its session has used.

## Sorting

Not everything you send becomes a card. The conductor sorts each new note first (`show` on a note says so), into one of four:

| | What happens | The conductor runs |
|---|---|---|
| **A question** | It's answered in the chat. No card is kept. | `reply T-012 -Answer -Text "..."` |
| **An errand** | Something to do that changes nothing in the game (open the lanes, start Studio, push main, run the checks): there's nothing to test, so it's done and said in the chat. No card is kept. | `reply T-012 -Done -Text "..."` |
| **A fix** | A small change: a card that's done (by the conductor, or a worker in a lane) and handed back to test. | `set T-012 -Title "..." -Status working`, then as any card |
| **A feature** | Something with decisions in it, or more than one step: a plan first, for you to approve. | `plan ...`, then `clear T-012` |

An errand has no button of its own: it's only ever the conductor's call. The note box's **Auto** leaves the choice to it. **Fix**, **Ask** and **Feature** make it yourself (the note's `type`: `fix`, `question` or `feature`), and the conductor goes with that unless the note is plainly something else, in which case it says so. An answer that turns out to need work can still become a card (the task action `make-task`).

## Feature threads

A feature you approve is built by an agent of its own, not by the conductor's workers: a session of your agent that Rocco opens in a lane, which the feature keeps until it's finished. You talk to it directly, on the feature's tab above the chat. So a long build is one conversation, with its decisions in it, and the conductor's chat stays for everything else. Settings turns this off ("Features get an agent of their own"); the conductor then builds a feature with its workers, as it does a fix.

- **What it does** is in `LEAD.md`, which Rocco tells it to read first. It builds the feature itself, a step at a time on the feature's branch, with a card per step, so each is tested and approved as it's done. It asks its questions in its own thread, and watches for what you send with `wait`, as the conductor does. It uses helpers only for work that splits off cleanly. Merging into main stays the conductor's.
- **Whose a card is:** a feature's plan and its steps are its own agent's, so what you ask of them (an answer, a send-back, a follow-up) goes to that agent, not through the conductor. `list -Pending` and `wait` hand each agent only its own. A merge is always the conductor's (`[merge]`).
- **Its tab** has its steps pinned above its chat, each with where it is, and the decisions made in it (its questions, with your answers). The rail lists the feature's cards. The lane it holds shows as working in the sidebar.
- **A card can have one too.** A card that keeps coming back offers it on its third attempt (**Give it its own agent**). The conductor stops the worker that has it (`[handoff]`, then `clear`), and an agent of its own takes the card over in its lane, on a tab of its own, to work it through with you. Approving or deleting the card ends that session.
- **It's tracked as the conductor is:** the same hooks, questions, permission requests and **Restart it** when it stops answering, in its own folder, `<Game>\rocco\threads\<id>\`. Its window's commands know their thread from `ROCCO_THREAD`, which Rocco sets when it opens it; `-Thread T-020` names one by hand.
- **With no free lane,** or on a PC that opens none, the feature waits, and its tab says what for. Its agent starts when a lane is free.

## The conductor in Rocco

You follow the conductor in Rocco, not in its window.

- **The chat** is where you follow it ("The chat", above): what it says and does, with its questions under it, and its status line under the note box: listening, working on a step ("Rocco · Merge the trade branch"), asking you something, or not running.
- **Its questions** show above the note box, each with its short options (the detail on hover), its pictures, "Let Rocco decide", and its own answer box: type there and Enter sends it (on a multi-select, with what's ticked). What's typed in it stays through the board's refreshes. **Reply** on a message turns the note box into a reply ("Replying to Rocco ×"; the × makes it a note again), sent as a message, not a card. What you send comes back to it through `wait`, as `[message]` or `[answer]`.
- **A dialog only its window can answer** (Claude Code's "Read outside the working directories?", a sandboxed command's network request, an MCP server asking for input) reaches Rocco through its `Notification` hook, about six seconds in. Rocco can't answer it, so it says where: a card above the note box with **Show its window**, the tab's dot, and a toast and desktop notification, for the conductor and for each feature's agent. It goes once the agent takes its next step.
- **Pictures on a question** (concepts to pick from, a model at its gate): an option can show a picture, and so can the question itself. They come from `ask`'s `-Images` and `-Show` (Commands), or from what the question says, for AskUserQuestion too: a path to an image in the question or an option (its description or preview), or a folder in the question and file names in the options ("The four concepts are in `..\art\generated\garage\`", then "garage-01: teal and orange"). A folder named with no file picked out shows all of it, up to 8. Each is copied beside the question (`conductor\files\<id>\`, or the task's folder), so it still shows when the art moves on; the history shows the picked one, and a week on they go.
- **Claude Code** opened by Rocco gets hooks, through `--settings <Game>\rocco\conductor\claude-settings.json`, written at each launch, so they apply only to that session and its workers. They need nothing from the agent:
  - its steps and its message at the end of each turn come in by themselves. Claude Code posts these to Rocco itself (an http hook), so nothing is started for them: a hook that ran a program started PowerShell on every tool call of the conductor and of each worker. A Claude Code from before http hooks (older than 2.1.295) gets the program, `server\hook-post.ps1`, as before. The same short line at the end of turn after turn ("Watching.") is kept once an hour, and what Claude Code puts into its own session (a worker handing back its report, a notice that background work finished) isn't shown as something you typed;
  - its questions (AskUserQuestion) wait for your answer in Rocco and go back as the tool's answers;
  - a permission prompt waits for **Allow** or **Deny** in Rocco;
  - it can't end a turn while something waits on it, or with no `wait` watching the board, so nothing you send sits unseen.
  After 20 minutes with no answer, a question stays open in Rocco, and its answer comes later through `wait`; a permission prompt goes back to the agent's own window, and Rocco offers **Show its window**. So does the status line when the agent is asking something before any hook runs: the first time it opens in a folder, it asks whether you trust it.
- **When it stops answering.** The conductor is one session, and its workers run inside it. If it's running but not watching the board, nothing has been heard from it or its workers for five minutes, and something waits on it, the status line says so and offers **Show its window** and **Restart it**. Restart ends its session (its window and everything started in it) and opens a new one, which picks the work up from the board and the lanes. Rocco never restarts it by itself: a long quiet job looks the same from outside.
- **Its model** is picked in Settings, for an agent that takes one on its command line (Claude Code: `--model`): a name from the list, or any name the agent accepts. It applies to the next conductor Rocco opens. Left empty, the agent's own default is used.
- **Any other agent**, or a Claude Code you started yourself, uses the commands: `doing`, `say`, and `ask` with no task (Commands). Rocco adds the milestones and what you send either way.
- **Files:** `thread.jsonl`, where every writer (the server, the commands, the hooks) only appends a line, and a question's state comes from the lines after it; `activity.jsonl`, its steps; `workers.jsonl`, which worker ran a command on which task, and each worker's session file as its last hook named it ("A card's session"); `files\<id>\`, a question's pictures. Past 1 MB, the oldest lines go, once each time Rocco runs, keeping anything still open, and so do pictures past the history's week. The trim holds the file to itself while it rewrites it, so a line written at that moment waits and isn't lost.

## A card's session

A task's sheet shows its agent's session word for word, the way a coding agent's own app does: its messages, each tool it ran folded into a line (open one to see what went in and what came back, screenshots included), the brief Rocco's conductor gave it, and what you and Rocco said on the card, in time order. A card at work opens at its latest step and follows along; the tools it's running stay open until you fold them.

- **Where it comes from:** Claude Code keeps each worker's session as a file, `<config>\projects\<folder>\<conductor's session>\subagents\agent-<id>.jsonl` (config is `%USERPROFILE%\.claude`, or `CLAUDE_CONFIG_DIR`), and a session started in a lane under that lane's folder. A session is a task's when the conductor named the task for it, or when its agent ran a Rocco command on the task (`set`, `ask`, `log`, `result`). Only files written since the task was made are read, and only what's new after that.
- **From the hooks too.** A worker's hooks reach Rocco with its agent id. When it runs a Rocco command on a task, that pairs its session with the task, and when it ends, the hook names its session file. So a card finds its sessions from what Claude Code reported, not only from how it lays out its files.
- **What it used.** Claude Code records the tokens each of the model's messages used (in, out, and read from or written to the prompt cache). Rocco adds them up per session, counting each message once, and shows them on the card and in Usage, beside the task's time at work (from each time it turns Working to when it stops being so). A session that worked on several tasks is shared between them evenly. These are counts of tokens, not money: Rocco doesn't know what your plan charges. The session format is Claude Code's own, so if it changes, a session shows no usage until Rocco is updated for it.
- **Typing in the card** sends its agent your words through the conductor (`[followup]`, or `[reopen]` for a task to test), which passes them to the worker that has the task (CONDUCTOR.md), so its session goes on with them.
- **Other agents** keep their sessions elsewhere, so their cards show what was said on the card, the same way.

## Commands

The agent keeps the Workboard current with `rocco.ps1`. Run from a project's `repo\` or a lane, it acts on that project (`-Project <folder>` names another); from `repo\` that's `..\..\_tools\rocco\rocco.ps1`, and from a lane `..\..\..\_tools\rocco\rocco.ps1`. Run it from PowerShell where you can. Through `powershell -File` (an agent in a bash shell) a list like `-Options "A","B"` arrives as one string, `A,B`; Rocco then splits a single item at its commas and says so, which is right unless one item was meant to have a comma in it. Its header lists every option:

| | |
|---|---|
| `list [-Pending]` | Open tasks in Up next order; `-Pending`: only what waits on the conductor |
| `show T-012` | One task in full. On a note waiting for the conductor (`[plan]`), it ends with what comes first (`set -Title "..." -Status working`, so the card leaves Up next), and Up next tells the user it's been read |
| `new -Title "..." [-Note "..."] [-Type bug] [-Plan T-020] [-After T-011]` | Add a task to Up next. `-Plan`: a step of that feature; the plan's chip counts its tasks. A step task for a plan that still waits for approval approves it (the user said go in words, not with the button), and one for a plan that was worked as a card puts the plan back. `-After`: it needs those done first, so the user can't drag it ahead of them |
| `suggest -Title "..." [-Summary "why"]` | Put something the agent spotted in the inbox |
| `plan -Title "..." -Summary "..." -Steps "title\|lane\|tier",... [-Spec docs/game/features/x.md]` | A feature plan for the user to approve or change. `-Spec` is the feature's spec in the repo: its card links it (Read the spec). The summary keeps its line breaks. When they ask for changes, `set T-020 -Summary "..." -Steps ...` revises it, then `clear`. A plan always waits for the user. It's never worked as a card: `set` to working, stuck or ready, `-Lane`, and `ask` on a plan are refused, with what to do instead (a task per step). Once the user has approved a task for every step, the plan is done and its chip goes; Undo opens it again. A step whose task was deleted counts as dropped, not waiting, so the rest finishing finishes the plan (and the chip counts it out); a plan whose every step was deleted shows no chip |
| `ask T-012 -Question "..." -Options "A","B" [-Audio a.ogg,b.ogg]` | Ask the user; more `ask`s while it's stuck add questions. Options are a few words each, like "A lap" or "An open pad": the detail goes in the question, since the card shows two lines of an option at most. `-Audio` files (one per option, in order) get play buttons. `-Images a.png,b.png` (one per option, in order) makes them pictures to pick from, and `-Show front.png,side.png` shows pictures with the question itself (a model to approve). An image path or a folder in the question shows by itself ("The conductor in Rocco", Pictures). A picture that isn't there is refused |
| `ask -Question "..." [-Options "A","B"] [-Images ...] [-Show ...]` | With no task: the conductor asks the user, above their note box. `wait` returns their answer as `[answer] C-xxxxxx` |
| `doing "Merging the trade window"` | What the conductor is doing now, in a few words: Rocco's status line, and a step in its history. Claude Code opened by Rocco needs none of `doing`, `say` or `ask`: its hooks do it ("The conductor in Rocco") |
| `say -Text "..."` | A message to the user in Rocco's history: a report, or anything the conductor would otherwise say only in its own window |
| `show C-1a2b3c` / `clear C-1a2b3c` | A message or answer the user sent the conductor (`list -Pending` and `wait` show them as `[message]` and `[answer]`), in full; `clear` once it's acted on |
| `hook permission\|question\|stop` | Claude Code's hooks for a conductor Rocco opened: `permission` and `question` wait for the user's answer in Rocco and hand it back; `stop` sends the conductor back when it ends a turn with something still waiting on it, or with no `wait` running (a new one gets 20 seconds to start). After three tries in a row it lets the turn end, and says so in the history |
| `reply T-012 -Text "..." [-Answer\|-Done]` | Answer a question the user asked (`list` marks them QUESTION): it's said in the chat, and the question is closed, with no card kept. `-Answer` does the same for a note that turned out to be only a question, and `-Done` for an errand, once it's done: the text says what was done ("Sorting"). `-Done` is refused on a card with a branch: that changed something, so it's tested. On any other card (a question typed into a working card, say) the answer goes in the card's session and the card stays where it is |
| `set T-012 -Status working -Lane 3 -Step "..." [-Progress 40]` | Where a task stands. A worker's `log` lines show live on its card |
| `set T-012 -ForLane` | Every lane is busy: the task waits in Up next, its card says whether a lane is free ("Waiting for a free lane: all 4 are busy", then "Lane 2 is free: Rocco starts it next"), and `wait` hands it back as `[lane]` the moment one is, with the lane to use. `new -ForLane` does the same for a new task. What the user asked of it (a send-back, a note) counts as read. Starting it, or giving it a lane, ends the wait |
| `set T-012 -Status ready -Where main -Summary "..." -Test "Drive a lap","Drift the hairpin"` | Ready to test: what changed, and the steps to try (one a line on the card). What a card shows has to fit it, so these are refused, with what to do instead: a title over 50 characters (from `new`, `plan`, `suggest` or `set`; a plan's steps too), and a task's summary or test over 30 words each. A feature plan's summary and a setup card's aren't limited. The detail goes in `log`. Where to test is checked against git for a task with a branch: `-Where main` is refused until the Main place has its commits (merged, pushed and pulled into `repo\`), and `-Where lane` once it's merged, so an agent working from an old picture can't send the user to the wrong place |
| `result T-012 -Pass\|-Fail -Text "12 of 12 tests pass" [-File console.txt]` | What the worker ran and how it went, on the card: the line (30 words at most), and with `-File` the output itself (the tests' report, Studio's console saved as text; the last 200 KB of a long one). The card shows each check with its output a click away, so the user sees what was tried before they try it. `set -Status ready` with no check for this attempt says how to add one |
| `log T-012 -Text "..." [-Who worker]` | Add to a task's history |
| `clear T-012` | What the user asked of it (a plan, answer, reopen, merge, cancel, follow-ups, or stepping in on its worker) is handled. `set` on a deleted task fails, which is how a worker hears its task was deleted |
| `[stop]`, `[resume]`, `[restart]`, `[assign]` | What `list -Pending` and `wait` show when the user steps in on running work from its card: **Pause** (stop its worker and keep its branch; it waits in Up next until they resume it), **Resume**, **Start again** (a fresh worker from what the last one left), or a different lane or worker. `[handoff]`: the user gave the card an agent of its own ("Feature threads"), so stop its worker, then `clear`. `show` says exactly what to do for each. A paused task waits on nobody: `list` marks it, and it isn't handed back until it's resumed |
| `wait [-Timeout 540]` | The conductor between jobs: returns as soon as something waits on it, listed as `list -Pending` lists it, or after `-Timeout` seconds. Nothing the user can still take back is handed over: an approval (which merges a branch), an answer, a queued suggestion and a delete each wait out the app's Undo (6 seconds) first, and after that Undo is refused. Rocco shows the conductor listening meanwhile, and opens no other. Claude Code runs it as a background command with no `-Timeout`, is woken when it returns, and starts it again (the `stop` hook sees to it); an agent without background commands runs it with `-Timeout`, again and again |
| `lanes [-Count 3]` | Open this PC's lanes: any missing lane (the game's `tools\add-lane.ps1`), any missing place (a plain baseplate with its `__lync_port` set; but never a blank Main place for a game that has been released: its real one has to be copied to this PC first), Lync for each checkout not served yet (with no window: its log is in `<Game>\rocco\lync`), and each place in Studio not open yet. Run by an agent, all of it outlives the agent's shell. `-Count` records this PC's row in PROJECT.md "Workstations" first, committed and pushed |
| `-Thread T-020`, on any command | The thread a command is about: a feature's, or a card's, with an agent of its own ("Feature threads"). That agent's own window needs none: Rocco sets `ROCCO_THREAD` in it. In a thread, `list` shows that feature's tasks, and `list -Pending`, `wait`, `say`, `doing` and `ask` are that thread's |

## API

All on `http://localhost:34860`. `?p=<project>` names the project: its folder in the RoDev folder. On the conductor's routes, `&t=<id>` names a thread other than the conductor's: a feature's, or a card's, with an agent of its own ("Feature threads").

| | |
|---|---|
| `GET /api/projects` | Every project, and the one Rocco was started from |
| `GET /api/me` | The user: git name and email, GitHub avatar, Claude account, this PC |
| `GET /api/agent` | This PC's agent (`{ id, name, short, installed, chosen }`), the model its conductor is opened on (`model`, `''` for the agent's default; `takesModel`, and `models` to offer), whether a feature the user approves gets an agent of its own (`leads`), and every agent Rocco knows, installed or not |
| `GET /api/accounts[?refresh=1]` | The user's own accounts on this PC: each agent (`state`: ok, signin, expired or missing; its plan, install and sign-in actions), Codex for images, GitHub, and whether ElevenLabs and Roblox are linked. Kept for 15 seconds |
| `GET /api/onboarding/survey` | The onboarding survey, from the template (for a game that doesn't exist yet) |
| `GET /api/lanes[?p=]` | This PC (`{ pc, memory, threads, cpu }`), the lanes to suggest and the most to offer, and with `p`, this PC's row for that project (`mine`, `null` without one) |
| `GET /api/onboarding?p=` | The project's survey, and the answers in its `docs/game/ONBOARDING.md` (`{ flow, source, started, answers }`) |
| `GET /api/updates?p=[&refresh=1]` | The calendar's cards (each with its game page event as Roblox has it, and card images to pick), the lead, and the game page's events. Queues due events first. Roblox is asked in the background: `roblox.loading` until it answers |
| `GET /api/thumbnails?p=[&refresh=1]` | The game page's thumbnails and their numbers, hints, directions, concepts, and the concepts being made |
| `GET /files/art/<thumbnails or events>/<folder>/<file>?p=` | A concept or a card image, from `..\art\generated` |
| `GET /api/state?p=` | The project's tasks (those approved in the last three days; older ones are in the archive), lanes (how many, which are open, `studio`: which have their place open in Studio or `null` when that can't be told, this PC's row, lane jobs running), the conductor (`listening`, `busy` or `none`; with `doing`, its `open` questions and permission requests, ones waiting in its own window, `inWindow`, its `last` message, the history's `stamp`; while busy, `stalled` with how many minutes it has been `quiet` and how much is `waiting` on it; its `model`, and its session's `usage` so far), `leads` (the threads with an agent of their own: `{ id, title, kind: feature or card, lane, done, handoff, waiting, opened, conductor }`, the last as the conductor's own), Main's last change, `others`: the other projects that want the user (`{ id, name, stuck, ready, asks }`), and `limits`: the plan's usage limits as an agent Rocco opened last heard them (`{ five, week, at }`, each window `{ used, resets }`, left out once it resets; `null` with none) |
| `GET /api/archive?p=[&q=][&skip=]` | What the board no longer shows: tasks approved more than three days ago or deleted, newest first, 50 at a time, narrowed to those with every word of `q` (in the title, note, summary, id, branch or history). `{ total, skip, tasks }` |
| `GET /api/usage?p=` | What each task took: its time at work in seconds, and the tokens its sessions used (`in`, `out`, `cacheRead`, `cacheWrite`), with the feature plans to group them by and the conductor's own session |
| `GET /api/tasks/<id>?p=` | One task by its id, on the board or in the archive: a link to a task opens it |
| `GET /api/conductor/thread?p=[&stamp=]` | The conductor's history: the last week of its thread (`items`) and steps (`steps`), or `{ same }` when the stamp hasn't changed |
| `GET /api/connections?p=[&refresh=1]` | Project links and this PC's tools; the PC part is re-checked in the background |
| `GET /api/history?p=` | Main's last 40 commits, branches other than main, and each lane's state and recent reflog |
| `GET /api/docs?p=` | Every Markdown file in the repo: title, preview, sections, last change, uncommitted or not, template-owned or not |
| `GET /api/docs/file?p=&path=` | One doc: its text, a hash of it, and its last commit. `locked` for the template's own docs in a game, and for a doc that isn't UTF-8 (`lockedWhy` says so): Rocco shows it but won't save it, since that would change its accented letters |
| `GET /api/tasks/<id>/changes?p=` | The files a task changed, each with its lines added and removed: its merge into main, else its branch against main |
| `GET /api/tasks/<id>/diff?p=&path=` | One of those files' changes as git shows them (a unified diff, cut at 300 KB): `{ path, text, binary, cut }`. Only a file the task changed |
| `GET /api/tasks/<id>/sessions?p=` | Its agent's sessions, oldest first: `key`, the conductor's name for it, its agent type, when it started, its size in bytes, and its `usage` |
| `GET /api/tasks/<id>/session?p=&key=&from=` | One session's whole lines from byte `from`, as Claude Code wrote them (JSON lines), about a megabyte at a time; the `X-Next` header is where to ask from next, and `X-Size` how far there is to go. Only a session of that task |
| `GET /files/<task>/<file>?p=` | A screenshot, a sound option, a picture on a question, or a check's output (`check-N.txt`) |
| `GET /files/conductor/<question>/<file>?p=` | A picture on one of the conductor's questions |
| `GET /api/jobs/<id>` | A background job's progress (a new project, opening lanes): `{ running, ok, output, project, kind }`. Jobs are on record in `%APPDATA%\Rocco\jobs.json`, so one that was running when Rocco restarted is still known. `POST /api/jobs/<id>/cancel` stops it and everything it started; one far past its time (30 minutes for a new project, 20 for lanes) is stopped by itself |
| `GET /api/actions/runs/<run>` | An update running in its own window: `{ running, ok, label }` |
| `POST /api/note?p=` | Add the user's note (`{ text, type }`; `type`: `fix`, `question` or `feature` when they said which it is, else empty) to Up next, for the conductor to sort; returns its id, and `opened`: the agent opened as the conductor when none was running. Task actions and `/api/send` return `opened` too. With `hold: true` (screenshots follow) it isn't handed to the conductor yet: `POST /api/tasks/<id>/release` does that once they're in, so the conductor never reads a note before its pictures. A held note the app never released is handed over after 90 seconds |
| `POST /api/lanes?p=` | `{ count }` records this PC's lanes in PROJECT.md (committed and pushed), then opens them in the background; without it, the lanes it has are opened. Returns `{ job, saved }` |
| `POST /api/limits` | The status line of an agent Rocco opened posts Claude Code's status JSON here. Keeps its `rate_limits` (the 5-hour and weekly windows) for the sidebar, and answers the line its window shows (`5h 89% · week 69%`) |
| `POST /api/lanes/fix?p=` | Fix lanes: `{ down: [{ lane, what }] }`, what holding `lync`, `studio` and `agent`. Opens again what went down, opens a stopped feature agent, and tells the agent with work in each lane (a `message` from `rocco`). Returns `{ job, agents }` |
| `POST /api/conductor?p=` | Open the user's agent as the conductor, on what's waiting, when none is running. Returns `{ agent }` |
| `POST /api/conductor/answer?p=` | Answer the conductor's question (`{ id, answers, text }`, one answer per question). Returns `{ opened }` |
| `POST /api/conductor/permission?p=` | Allow or deny a permission request (`{ id, allow }`) |
| `POST /api/conductor/message?p=` | Write to the conductor (`{ text, to }`, `to`: the message it replies to). Returns `{ id, opened }` |
| `POST /api/conductor/hook?p=&e=tool\|stop\|prompt\|worker-stop\|notify` | From Claude Code's hooks: a step, its message at the end of a turn, what the user typed in its window, a worker's session ending, or a dialog in its window (the conductor's `windowAsk` until its next step). A worker's own steps aren't shown (its card has them), but they say it's alive and which task it's on. Answers with an empty body, which Claude Code takes as a hook with nothing to say |
| `POST /api/conductor/show-window?p=` | Bring the conductor's window up. Returns `{ shown }` |
| `POST /api/conductor/restart?p=` | End the conductor's session and open a new one on what's on the board. Returns `{ agent }` |
| `POST /api/tasks/<id>/shot?p=` | Attach a screenshot (the image as the body, 25 MB at most) |
| `POST /api/tasks/<id>/<action>?p=` | What the user does to a task: approve, reopen, answer, queue (an inbox item), remove (Delete, with a plan's unfinished tasks), followup, undo (the last approve, answer, queue or remove, within its 6 seconds), approve-plan (with its own agent on, the feature gets one, and a thread), revise (a plan), promote (give a card an agent of its own), make-task (an answered question becomes a note to plan). Stepping in on its worker: pause, resume, restart, and assign (`{ text: "lane=3 tier=heavy" }`, either or both; on a task that hasn't started it's remembered for when it does). `{ text }` for reopen, answer, followup, revise and restart |
| `POST /api/order?p=` | Up next in a new order (`{ ids }`); refused if a task would go before one it waits on |
| `POST /api/history/bookmark?p=` | Bookmark a commit, or remove its bookmark (`{ hash }`) |
| `POST /api/links/elevenlabs?p=` | Link ElevenLabs (`{ key }`): checked with ElevenLabs, then kept as `ELEVENLABS_API_KEY` in the user's environment. The key is never sent back |
| `POST /api/links/elevenlabs/remove?p=` | Unlink it: removes the key from the user's environment |
| `POST /api/docs/save?p=` | The user's edit to a doc (`{ path, text, base, message }`): committed on main and pushed. `{ conflict, hash }` instead if the doc's hash isn't `base` any more; refused for template-owned docs in a game |
| `POST /api/actions/<action>?p=` | A Connections button (`{ value }` for one that needs it, like a GitHub repo address): `{ message }` when it's done, or `{ run, label }` for an update in its own window. Only the actions in `server/actions.ps1` run |
| `POST /api/rocco/quit?p=` | Stop Rocco once it has answered, and every Lync server from this RoDev folder now. Returns `{ ok, lync }`, how many Lync servers stopped |
| `POST /api/rocco/update?p=` | Switch to a newer release (`{ tag }`), then restart on it. Refused for a development copy, an older release, or local changes in `_tools\rocco`. `/api/state` and `/api/me` carry the running version as `rocco` |
| `POST /api/send?p=` | Queue everything in the inbox |
| `POST /api/projects/new` | Start a new project: `{ name, code, repo }`, plus `existing: { kind, from }` for a game already made (`github`, `folder` or `place` with where it is, or `studio`). Returns a job for `/api/jobs/<id>` |
| `POST /api/agent` | Pick this PC's agent (`{ id }`) |
| `POST /api/agent/model` | The model the next conductor is opened on (`{ model }`, `''` for the agent's default) |
| `POST /api/agent/leads` | Whether a feature the user approves gets an agent of its own, on this PC (`{ on }`) |
| `POST /api/onboarding/answers?p=` | Save answers (`{ flow, source, answers }`; an empty answer clears one) into `docs/game/ONBOARDING.md`: committed as the user, only that file, and pushed when it can be. Returns `{ committed, pushed, note }` |
| `POST /api/onboarding/setup?p=` | Hand the answers to the agent (`{ part: new, existing or more, tiles }`): a Workboard card that approves itself when it's ready, and the agent opened in its own window as the conductor when it's installed and none is running. Returns `{ task, opened, running, agent, prompt }` |
| `POST /api/updates/<action>?p=` | A card: `save` (`{ id, title, date, time, kind, notes, announce }`; no id for a new one), `remove` (`{ id }`), `queue` its game page event now (`{ id }`), `image`: the user's pick of its card image (`{ id, image }`). `lead` (`{ days }`, 0 for never) and `publish` a draft event (`{ eventId }`, with the Roblox key). Card changes are committed as the user and pushed |
| `POST /api/thumbnails/<action>?p=` | `generate` concepts from a direction with Codex (`{ direction, count }`), `cancel` the ones being made (those already made stay), `use` a concept (`{ file }`: a task for the agent), `directions`: ask the agent for new ones |
| `POST /api/links/roblox?p=` | Link the Roblox Open Cloud key (`{ key }`): checked on the game's events when it has a universe id, then kept as `ROBLOX_API_KEY` in the user's environment. `/api/links/roblox/remove` unlinks it |

Writes need the header `X-Rocco: 1`, so other websites can't write to it.

## Conventions

- **No build step.** The app is plain HTML, CSS and JavaScript modules, served as they are: an agent edits a file and you refresh, and an update is a `git checkout`. The checks below run beside it and produce nothing that ships.
- **Templates, not strings.** A view's markup is a template from `lib/html.js` (the vendored lit). Text put into one is escaped by itself, and rendering it again changes only what differs, so a card's scroll, focus and half-typed words stay put while the board refreshes. The one place HTML is built as text is `lib/markdown.js`, which escapes its own and is covered by tests.
- **Nothing from the internet.** The font, the logos and the library are files in `web/`, so the app works offline and tells no other site that it's open. To move lit to a newer version, replace `web/vendor/lit-all.min.js` with that version's file from its release (its first line names the version and where it came from).
- **Colors are tokens.** Every color comes from `styles/tokens.css`, which has a set for each theme. No other stylesheet writes one: a tint is `rgba(var(--green-rgb), .1)`, a shade over a surface `rgba(var(--ink), .05)`. So a new rule is right on both themes without thinking about it.
- **One module per part,** and parts talk through `state.js` events instead of calling each other's renders. `main.js` decides what re-renders.
- **What a program is started with is data.** A prompt, a path or a name that reaches a PowerShell window, a job or a tool goes in through its environment or its arguments, never spliced into script text: a quote in it (a curly one counts, in PowerShell) can't then be read as code. `agents.ps1`, `projects.ps1` and `thumbnails.ps1` each do this once.
- **Nothing waits for ever.** The server answers one request at a time, so anything that reaches the network (git to GitHub) has a time limit and never asks for a password in a console nobody can see, and every background job is stopped when it runs far past its time.
- **ASCII .ps1 files.** Windows PowerShell reads a `.ps1` without a BOM as ANSI, so non-ASCII characters break; build them with `[char]` codes.

## Checks

Two sets, both run by GitHub on every push (`.github/workflows/checks.yml`):

- **The server:** `powershell -NoProfile -ExecutionPolicy Bypass -File tests\run.ps1`. It needs only Windows PowerShell and git. It makes a small game in a temporary RoDev folder, runs the agent's commands and the app's requests against it, and checks the things that are easy to break without noticing: commands at the same moment losing nothing, Undo against the conductor, a held note, a refused commit being put back, what a quote in a prompt can do (nothing), the hooks' settings, the archive. It never touches a real project, your settings or your agent (`ROCCO_HOME` moves Rocco's own files, `ROCCO_NO_CONDUCTOR` stops it opening one). `-Only <words>` runs the tests whose name has them.
- **The app:** `npm ci`, then `npm run check`, with Node 22 or newer (`package-lock.json` pins what `npm ci` installs, into `node_modules`, which git ignores). That's `tsc` over `web/src` (types from JSDoc where the code gives them, nothing emitted; the vendored library is read from the few lines of `web/vendor/lit-all.min.d.ts`), ESLint, and the tests in `tests/web`: what `lib/markdown.js` lets through, what `lib/tidy.js` changes, and the demo against the server (`tests/shapes.json` lists the fields the app counts on in each answer; the server's tests check the real answers for them, and the app's check the demo's, so neither can drift from the other unseen).

Node is only for these. Rocco runs without it.

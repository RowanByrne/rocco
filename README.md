# Rocco

Rocco is the web app for making games from this template. One Rocco serves every project in the RoDev folder.

- **Workboard:** a note box for playtest notes (typed, or spoken), screenshots (pasted, dropped, or captured straight from Studio) with a pen to mark them up, and a type (bug, tweak, idea, or question: something you just need to know, answered right under the note box); feature plans waiting for approval; the inbox, where things the agent spotted wait for the user to queue or dismiss; three columns (To test, Stuck, Working); and Up next, the queue in order, which the user can drag but never ahead of a task it waits on. Stuck cards ask their questions on the card, with play buttons for sound options; Working cards show their latest steps and take follow-ups. Each task's sheet shows what it changed.
- **History:** the build live on Roblox and earlier releases, main's recent commits (bookmark any of them), the branches not yet merged, and a card per lane (busy ones first) showing what's been done in it.
- **Docs:** every Markdown file in the repo, by folder; hover one for its first lines and sections. Open one to read it (mentions of other docs open them), ask your agent to change it (a note in Up next), or edit it and push: the edit is committed on main as you, only that file, and pushed, with GitHub's main merged in first. A doc that changed since you opened it isn't overwritten without asking. In a game, the template's own docs (AGENTS.md "Template-owned files", and `rocco/`) can't be edited here; your agent changes them through the template. **Add game details** opens the onboarding's detail tiles for the open game.
- **Onboarding:** New project is a short survey, and it opens by itself the first time Rocco runs in a RoDev folder with no games yet. The first choice is a new game, or one already made: on GitHub, in a folder, in a place file, or only in Studio. Then come the name and code, and questions one at a time; every answer is free text and optional. The questions are the template's `tools/onboarding.json`, so they change with the docs they fill. The project is made in the background while you answer (`new-project.ps1`, with `-Existing` for a game already made). A survey left half-way is kept in the browser.
  - **On finishing,** the answers are committed as the game's `docs/game/ONBOARDING.md` and pushed.
  - **Your agent then opens** in a window of its own, on the template's `docs/workflow/SETUP.md`, with a Workboard card to follow it. Without an agent installed, the card waits in Up next, with the prompt to copy.
  - **Detail tiles** (monetization, economy, progression, and more) add answers then or later, and **Send** hands them to the agent the same way.
- **Connections:** a health summary, what needs attention, then this project's links (template, GitHub, the commit check, Studio sync) and the tools on this PC, with their versions and how to update them. The Template row shows which template release the game is on; when a newer one is out, it shows what's new and asks your agent to bring it in (the template's TEMPLATE.md). Rocco's own row does the same for Rocco, and updates it in one click ("Updating"). Every fix is one click, its command still shown in the details for doing it by hand:
  - **Quick fixes** Rocco does at once: turning on the commit check, adding the template remote, connecting an empty GitHub repo and pushing main, pushing main, starting Lync.
  - **Updates to this PC's tools** (Claude Code, Codex, Gemini CLI, Git, the GitHub CLI, Lync) run in a window of their own, so you see them and can answer an installer's prompts. Rocco waits for the window, then checks again; a window that failed stays open until you've read it.
  - **Changes to the game** (a library, the template, registering the Studio MCP) are your agent's: their button adds a note to Up next.
  - **A Studio plugin** opens its releases page.

  What each button runs is defined in `server/actions.ps1`; the app only names it. The libraries the game vendors (from ARCHITECTURE.md, and TopbarPlus and Cmdr found in `src/`) show with their latest releases. Accounts the tools use, like ElevenLabs for sound, are linked here.
- **Settings:** your agent (kept per PC), then desktop notifications, live steps on Working cards (or just a progress bar), Rocco on the note box, voice notes, and hotkeys (kept per browser).
- **Metrics:** not built yet.

**Your agent.** Rocco isn't tied to one coding agent: Settings picks Claude Code, Codex or Gemini CLI for this PC (the first one installed until you pick). Rocco names it wherever it asks for something ("Ask Codex…"), checks it and its Studio MCP registration in Connections, and opens it for onboarding. The choice is kept in `%APPDATA%\Rocco\settings.json`. Another agent is a row in `server/agents.ps1`: how it starts with a prompt, and where it keeps MCP servers.

Rocco himself lives on top of the note box: a little pixel guy who does odd jobs (in a hard hat while workers are busy), reacts to the board, watches you type, and carries your note off when you send it. Click him to say hi.

Ctrl+K opens a palette to find any task, view, project or action. Hotkeys work while Rocco's window has focus.

For now it runs on this PC: a small PowerShell server, with nothing else to install, serves the app and reads and writes the project folders. Its own repo is `RowanByrne/rocco`; games made from the template (`RowanByrne/rodev_template`) don't carry a copy.

## Install

Once per RoDev folder, into `_tools\rocco` next to Lync, on the newest release. You need Git, and access to the repo (it's private: ask its owner). In the RoDev folder, in PowerShell:

```
git clone https://github.com/RowanByrne/rocco.git _tools\rocco
git -C _tools\rocco checkout (git -C _tools\rocco tag -l "v*" --sort=-v:refname | Select-Object -First 1)
```

Rocco only runs from a RoDev folder's `_tools\rocco`: it finds the projects next to `_tools`.

## Run it

Double-click `tools\rocco.bat` in any project (it's in the template, so every game has it). It serves Rocco on <http://localhost:34860/> and opens it on that project; if Rocco is already running, it just opens it. Leave its window open while you use it. `_tools\rocco\Rocco.bat` starts it too, on the template.

To work on the design without real tasks, open <http://localhost:34860/?demo>: sample data, and nothing is saved.

## Updating

Connections checks for a newer release (a `v*` tag) every half hour, and **Check now** checks at once. When there is one, Rocco shows it under Needs attention with what's new, and **Update** switches `_tools\rocco` to it and restarts Rocco in a new window; the open tab reloads by itself. It won't update over changes made in `_tools\rocco`.

By hand: close Rocco, then `git -C _tools\rocco fetch --tags` and `git -C _tools\rocco checkout v0.2.0`, and start it again.

## Releasing

Rocco is developed on `main`. A copy on a branch is a development copy: it shows `main @ abc1234` as its version, and is never offered an update (it's ahead of every release). To release, tag `main` with what's new as the tag's message (it shows in everyone's Connections), and push the tag:

```
git tag -a v0.2.0 -m "Docs: edit and push from the app"
git push origin v0.2.0
```

Use `vMAJOR.MINOR.PATCH`. Every install on an older release offers the update within half an hour.

**Voice notes** are off until turned on in Settings, because the browser sends the audio to its maker's speech service (Google for Chrome, Microsoft for Edge) to turn it into text. **Notifications** need the browser's permission, asked when they're turned on, and only show while Rocco is in the background.

## Where things are

```
_tools\rocco\
  Rocco.bat              starts the server and opens the app (a project's tools\rocco.bat calls it)
  rocco.ps1              the server, and the commands agents use (below)
  server/                the server's parts
    core.ps1             the RoDev folder, the open project, Rocco's version, small helpers
    agents.ps1           the coding agents Rocco can open, this PC's choice, opening one in its own window
    tasks.ps1            Workboard tasks on disk
    projects.ps1         projects, lanes, Main, the user, new projects
    connections.ps1      project links, this PC's tools, and Rocco's own updates
    history.ps1          main's commits, open branches, each lane's reflog
    docs.ps1             the repo's Markdown, one doc, saving and pushing the user's edit
    actions.ps1          what each Connections button does, and pushing main
    onboarding.ps1       the survey, the answers in ONBOARDING.md, handing them to the agent
    http.ps1             static files, the API, the server loop
  web/                   the app
    index.html
    assets/              icon
    styles/              tokens, base, shell, components, then one file per view
    src/
      main.js            entry point: wires the parts and decides what re-renders
      api.js             every server call (demo.js answers them with ?demo)
      state.js           shared state and change events
      agent.js           this PC's agent, and its name for the app's wording
      sync.js            polls the open project's tasks, and toasts or notifies what changed
      projects.js        the project list and switching
      router.js          which view shows, kept in the address
      sidebar.js         project picker, navigation, Main and lanes, the user
      settings.js        the user's settings, kept in this browser
      hotkeys.js         every hotkey action, its default and the user's binding
      capture.js         Studio window capture (the browser's screen share)
      voice.js           speech to text
      notify.js          desktop notifications
      mascot.js          Rocco, the little guy on the note box
      demo.js            sample data
      lib/               dom, format, icons, brands (logos), storage, markdown (for reading docs)
      ui/                menu, popover, sheet, toast
      views/             workboard, composer, history, docs, connections, settings
      dialogs/           onboarding (new projects, detail tiles), markup (draw on a screenshot), palette (Ctrl+K)
```

A project is a folder in the RoDev folder whose `repo\` has `docs/game/PROJECT.md`, or a game being brought in: its own git repo with `lanes\` next to it, before the template is merged into it. A project's Rocco data lives outside git, next to its `repo\`: `<Game>\rocco\tasks\T-NNN\` holds `task.json`, the user's screenshots, sound options for its questions, and the worker's `notes.md`. Bookmarked commits are in `<Game>\rocco\history.json`.

## Commands

The agent keeps the Workboard current with `rocco.ps1`. Run from a project's `repo\` or a lane, it acts on that project (`-Project <folder>` names another); from `repo\` that's `..\..\_tools\rocco\rocco.ps1`, and from a lane `..\..\..\_tools\rocco\rocco.ps1`. Run it in PowerShell, not through `powershell -File`, which breaks lists like `-Steps` and `-Options` apart. Its header lists every option:

| | |
|---|---|
| `list [-Pending]` | Open tasks in Up next order; `-Pending`: only what waits on the conductor |
| `show T-012` | One task in full |
| `new -Title "..." [-Type bug] [-Plan T-020] [-After T-011]` | Add a task to Up next. `-Plan`: part of that feature. `-After`: it needs those done first, so the user can't drag it ahead of them |
| `suggest -Title "..." [-Summary "why"]` | Put something the agent spotted in the inbox |
| `plan -Title "..." -Summary "..." -Steps "title\|lane\|tier",...` | A feature plan for the user to approve or change. When they ask for changes, `set T-020 -Summary "..." -Steps ...` revises it, then `clear` |
| `ask T-012 -Question "..." -Options "A","B" [-Audio a.ogg,b.ogg]` | Ask the user; more `ask`s while it's stuck add questions. `-Audio` files (one per option, in order) get play buttons |
| `reply T-012 -Text "..."` | Answer a question the user asked from the note box (`list` marks them QUESTION). It shows under the note box until they click Got it, or Ask more, which sends it back |
| `set T-012 -Status working -Lane 3 -Step "..." [-Progress 40]` | Where a task stands. A worker's `log` lines show live on its card |
| `log T-012 -Text "..." [-Who worker]` | Add to a task's history |
| `clear T-012` | What the user asked of it (a plan, answer, reopen, merge, follow-ups) is handled |

## API

All on `http://localhost:34860`. `?p=<project>` names the project: its folder in the RoDev folder.

| | |
|---|---|
| `GET /api/projects` | Every project, and the one Rocco was started from |
| `GET /api/me` | The user: git name and email, GitHub avatar, Claude account, this PC |
| `GET /api/agent` | This PC's agent (`{ id, name, short, installed, chosen }`) and every agent Rocco knows, installed or not |
| `GET /api/onboarding/survey` | The onboarding survey, from the template (for a game that doesn't exist yet) |
| `GET /api/onboarding?p=` | The project's survey, and the answers in its `docs/game/ONBOARDING.md` (`{ flow, source, started, answers }`) |
| `GET /api/state?p=` | The project's tasks, lanes (how many, which are open) and Main's last change |
| `GET /api/connections?p=[&refresh=1]` | Project links and this PC's tools; the PC part is re-checked in the background |
| `GET /api/history?p=` | Main's last 40 commits, branches other than main, and each lane's state and recent reflog |
| `GET /api/docs?p=` | Every Markdown file in the repo: title, preview, sections, last change, uncommitted or not, template-owned or not |
| `GET /api/docs/file?p=&path=` | One doc: its text, a hash of it, and its last commit |
| `GET /api/tasks/<id>/changes?p=` | The files a task changed: its merge into main, else its branch against main |
| `GET /files/<task>/<file>?p=` | A screenshot or a sound option |
| `GET /api/jobs/<id>` | A new project's progress |
| `GET /api/actions/runs/<run>` | An update running in its own window: `{ running, ok, label }` |
| `POST /api/note?p=` | Add the user's note (`{ text, type }`) to Up next, for the conductor to plan; returns its id |
| `POST /api/tasks/<id>/shot?p=` | Attach a screenshot (the image as the body) |
| `POST /api/tasks/<id>/<action>?p=` | What the user does to a task: approve, reopen, answer, queue (an inbox item), remove, followup, undo (the last approve, queue or remove), approve-plan, revise (a plan). `{ text }` for reopen, answer, followup and revise |
| `POST /api/order?p=` | Up next in a new order (`{ ids }`); refused if a task would go before one it waits on |
| `POST /api/history/bookmark?p=` | Bookmark a commit, or remove its bookmark (`{ hash }`) |
| `POST /api/links/elevenlabs?p=` | Link ElevenLabs (`{ key }`): checked with ElevenLabs, then kept as `ELEVENLABS_API_KEY` in the user's environment. The key is never sent back |
| `POST /api/links/elevenlabs/remove?p=` | Unlink it: removes the key from the user's environment |
| `POST /api/docs/save?p=` | The user's edit to a doc (`{ path, text, base, message }`): committed on main and pushed. `{ conflict, hash }` instead if the doc's hash isn't `base` any more; refused for template-owned docs in a game |
| `POST /api/actions/<action>?p=` | A Connections button (`{ value }` for one that needs it, like a GitHub repo address): `{ message }` when it's done, or `{ run, label }` for an update in its own window. Only the actions in `server/actions.ps1` run |
| `POST /api/rocco/update?p=` | Switch to a newer release (`{ tag }`), then restart on it. Refused for a development copy, an older release, or local changes in `_tools\rocco`. `/api/state` and `/api/me` carry the running version as `rocco` |
| `POST /api/send?p=` | Queue everything in the inbox |
| `POST /api/projects/new` | Start a new project: `{ name, code, repo }`, plus `existing: { kind, from }` for a game already made (`github`, `folder` or `place` with where it is, or `studio`). Returns a job for `/api/jobs/<id>` |
| `POST /api/agent` | Pick this PC's agent (`{ id }`) |
| `POST /api/onboarding/answers?p=` | Save answers (`{ flow, source, answers }`; an empty answer clears one) into `docs/game/ONBOARDING.md`: committed as the user, only that file, and pushed when it can be. Returns `{ committed, pushed, note }` |
| `POST /api/onboarding/setup?p=` | Hand the answers to the agent (`{ part: new, existing or more, tiles }`): a Workboard card, and the agent opened in its own window when it's installed. Returns `{ task, opened, agent, prompt }` |

Writes need the header `X-Rocco: 1`, so other websites can't write to it.

## Conventions

- **No build step.** The app is plain HTML, CSS and JavaScript modules, served as they are. A bundler (Vite) can come later without moving files: `web/index.html` is already its entry point.
- **One module per part,** and parts talk through `state.js` events instead of calling each other's renders. `main.js` decides what re-renders.
- **Logos** come from [Simple Icons](https://simpleicons.org) on jsDelivr, pinned to one version in `src/lib/brands.js`; offline, each falls back to a line icon.
- **ASCII .ps1 files.** Windows PowerShell reads a `.ps1` without a BOM as ANSI, so non-ASCII characters break; build them with `[char]` codes.

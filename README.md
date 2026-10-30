# Rocco

Rocco is the web app for making games from this template. One Rocco serves every project in the RoDev folder.

- **Workboard:** a note box for playtest notes (typed, or spoken), screenshots (pasted, dropped, or captured straight from Studio) with a pen to mark them up, and a type (bug, tweak, idea, or question: something you just need to know, answered right under the note box); feature plans waiting for approval; the inbox, where things Claude spotted wait for the user to queue or dismiss; three columns (To test, Stuck, Working); and Up next, the queue in order, which the user can drag but never ahead of a task it waits on. Stuck cards ask their questions on the card, with play buttons for sound options; Working cards show their latest steps and take follow-ups. Each task's sheet shows what it changed.
- **History:** the build live on Roblox and earlier releases, main's recent commits (bookmark any of them), the branches not yet merged, and a card per lane (busy ones first) showing what's been done in it.
- **Connections:** a health summary, what needs attention, then this project's links (template, GitHub, the commit check, Studio sync) and the tools on this PC, with their versions and how to update them. The libraries the game vendors (from ARCHITECTURE.md, and TopbarPlus and Cmdr found in `src/`) show with their latest releases. Accounts the tools use, like ElevenLabs for sound, are linked here.
- **Settings:** desktop notifications, live steps on Working cards (or just a progress bar), Rocco on the note box, voice notes, and hotkeys. Kept per browser.
- **Metrics:** not built yet.

Rocco himself lives on top of the note box: a little pixel guy who does odd jobs (in a hard hat while workers are busy), reacts to the board, watches you type, and carries your note off when you send it. Click him to say hi.

Ctrl+K opens a palette to find any task, view, project or action. Hotkeys work while Rocco's window has focus.

For now it runs on this PC: a small PowerShell server, with nothing to install, serves the app and reads and writes the project folders.

## Run it

Double-click `rocco\Rocco.bat` in any project. It serves Rocco on <http://localhost:34860/> and opens it on that project; if Rocco is already running, it just opens it. Leave its window open while you use it.

To work on the design without real tasks, open <http://localhost:34860/?demo>: sample data, and nothing is saved.

**Voice notes** are off until turned on in Settings, because the browser sends the audio to its maker's speech service (Google for Chrome, Microsoft for Edge) to turn it into text. **Notifications** need the browser's permission, asked when they're turned on, and only show while Rocco is in the background.

## Where things are

```
rocco/
  Rocco.bat              starts the server and opens the app
  rocco.ps1              the server, and the commands Claude uses (below)
  server/                the server's parts
    core.ps1             paths, the open project, small helpers
    tasks.ps1            Workboard tasks on disk
    projects.ps1         projects, lanes, Main, the user, new projects
    connections.ps1      project links and this PC's tools
    history.ps1          main's commits, open branches, each lane's reflog
    http.ps1             static files, the API, the server loop
  web/                   the app
    index.html
    assets/              icon
    styles/              tokens, base, shell, components, then one file per view
    src/
      main.js            entry point: wires the parts and decides what re-renders
      api.js             every server call (demo.js answers them with ?demo)
      state.js           shared state and change events
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
      lib/               dom, format, icons, brands (logos), storage
      ui/                menu, popover, sheet, toast
      views/             workboard, composer, history, connections, settings
      dialogs/           new-project, markup (draw on a screenshot), palette (Ctrl+K)
```

A project's Rocco data lives outside git, next to its `repo\`: `<Game>\rocco\tasks\T-NNN\` holds `task.json`, the user's screenshots, sound options for its questions, and the worker's `notes.md`. Bookmarked commits are in `<Game>\rocco\history.json`.

## Commands

Claude keeps the Workboard current with `rocco\rocco.ps1`, run from the project's `repo\` (its header lists every option):

| | |
|---|---|
| `list [-Pending]` | Open tasks in Up next order; `-Pending`: only what waits on the conductor |
| `show T-012` | One task in full |
| `new -Title "..." [-Type bug] [-Plan T-020] [-After T-011]` | Add a task to Up next. `-Plan`: part of that feature. `-After`: it needs those done first, so the user can't drag it ahead of them |
| `suggest -Title "..." [-Summary "why"]` | Put something Claude spotted in the inbox |
| `plan -Title "..." -Summary "..." -Steps "title\|lane\|tier",...` | A feature plan for the user to approve or change |
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
| `GET /api/state?p=` | The project's tasks, lanes (how many, which are open) and Main's last change |
| `GET /api/connections?p=[&refresh=1]` | Project links and this PC's tools; the PC part is re-checked in the background |
| `GET /api/history?p=` | Main's last 40 commits, branches other than main, and each lane's state and recent reflog |
| `GET /api/tasks/<id>/changes?p=` | The files a task changed: its merge into main, else its branch against main |
| `GET /files/<task>/<file>?p=` | A screenshot or a sound option |
| `GET /api/jobs/<id>` | A new project's progress |
| `POST /api/note?p=` | Add the user's note (`{ text, type }`) to Up next, for the conductor to plan; returns its id |
| `POST /api/tasks/<id>/shot?p=` | Attach a screenshot (the image as the body) |
| `POST /api/tasks/<id>/<action>?p=` | What the user does to a task: approve, reopen, answer, queue (an inbox item), remove, followup, undo (the last approve, queue or remove), approve-plan, revise (a plan). `{ text }` for reopen, answer, followup and revise |
| `POST /api/order?p=` | Up next in a new order (`{ ids }`); refused if a task would go before one it waits on |
| `POST /api/history/bookmark?p=` | Bookmark a commit, or remove its bookmark (`{ hash }`) |
| `POST /api/links/elevenlabs?p=` | Link ElevenLabs (`{ key }`): checked with ElevenLabs, then kept as `ELEVENLABS_API_KEY` in the user's environment. The key is never sent back |
| `POST /api/links/elevenlabs/remove?p=` | Unlink it: removes the key from the user's environment |
| `POST /api/send?p=` | Queue everything in the inbox |
| `POST /api/projects/new` | Start a new project: `{ name, code, repo }` |

Writes need the header `X-Rocco: 1`, so other websites can't write to it.

## Conventions

- **No build step.** The app is plain HTML, CSS and JavaScript modules, served as they are. A bundler (Vite) can come later without moving files: `web/index.html` is already its entry point.
- **One module per part,** and parts talk through `state.js` events instead of calling each other's renders. `main.js` decides what re-renders.
- **Logos** come from [Simple Icons](https://simpleicons.org) on jsDelivr, pinned to one version in `src/lib/brands.js`; offline, each falls back to a line icon.
- **ASCII .ps1 files.** Windows PowerShell reads a `.ps1` without a BOM as ANSI, so non-ASCII characters break; build them with `[char]` codes.

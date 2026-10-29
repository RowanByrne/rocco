# Rocco

Rocco is the web app for making games from this template. One Rocco serves every project in the RoDev folder.

- **Workboard:** the user's playtest notes and Claude's tasks, from the inbox to approved, with screenshots and each task's history.
- **History:** main's recent commits, the branches not yet merged, and a card per lane (busy ones first) showing what's been done in it.
- **Connections:** a health summary, what needs attention, then this project's links (template, GitHub, the commit check, Studio sync) and the tools on this PC, with their versions and how to update them.
- **Metrics:** not built yet.

For now it runs on this PC: a small PowerShell server, with nothing to install, serves the app and reads and writes the project folders.

## Run it

Double-click `rocco\Rocco.bat` in any project. It serves Rocco on <http://localhost:34860/> and opens it on that project; if Rocco is already running, it just opens it. Leave its window open while you use it.

To work on the design without real tasks, open <http://localhost:34860/?demo>: sample data, and nothing is saved.

## Where things are

```
rocco/
  Rocco.bat              starts the server and opens the app
  rocco.ps1              the server, and the commands Claude uses (list, show, new, set, log, clear)
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
      sync.js            polls the open project's tasks
      projects.js        the project list and switching
      router.js          which view shows, kept in the address
      sidebar.js         project picker, navigation, Main and lanes, the user
      demo.js            sample data
      lib/               dom, format, icons, brands (logos), storage
      ui/                menu, popover, sheet, toast
      views/             workboard, composer, history, connections
      dialogs/           new-project
```

A project's Rocco data lives outside git, next to its `repo\`: `<Game>\rocco\tasks\T-NNN\` holds `task.json`, the user's screenshots and the worker's `notes.md`.

## API

All on `http://localhost:34860`. `?p=<project>` names the project: its folder in the RoDev folder.

| | |
|---|---|
| `GET /api/projects` | Every project, and the one Rocco was started from |
| `GET /api/me` | The user: git name and email, GitHub avatar, Claude account, this PC |
| `GET /api/state?p=` | The project's tasks, lanes (how many, which are open) and Main's last change |
| `GET /api/connections?p=[&refresh=1]` | Project links and this PC's tools; the PC part is re-checked in the background |
| `GET /api/history?p=` | Main's last 40 commits, branches other than main, and each lane's state and recent reflog |
| `GET /files/<task>/<image>?p=` | A screenshot |
| `GET /api/jobs/<id>` | A new project's progress |
| `POST /api/note?p=` | Add a note to the inbox; returns its id |
| `POST /api/tasks/<id>/shot?p=` | Attach a screenshot (the image as the body) |
| `POST /api/tasks/<id>/approve\|reopen\|answer\|remove?p=` | What the user does to a task (`{ text }` for reopen and answer) |
| `POST /api/send?p=` | Send the inbox to the conductor |
| `POST /api/projects/new` | Start a new project: `{ name, code, repo }` |

Writes need the header `X-Rocco: 1`, so other websites can't write to it.

## Conventions

- **No build step.** The app is plain HTML, CSS and JavaScript modules, served as they are. A bundler (Vite) can come later without moving files: `web/index.html` is already its entry point.
- **One module per part,** and parts talk through `state.js` events instead of calling each other's renders. `main.js` decides what re-renders.
- **Logos** come from [Simple Icons](https://simpleicons.org) on jsDelivr, pinned to one version in `src/lib/brands.js`; offline, each falls back to a line icon.
- **ASCII .ps1 files.** Windows PowerShell reads a `.ps1` without a BOM as ANSI, so non-ASCII characters break; build them with `[char]` codes.

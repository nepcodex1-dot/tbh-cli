# tbh-cli

A dependency-free Node.js CLI for **TeleBotHost**. It signs in with a Developer API
key and deploys a TBL command project (any folder with a `manifest.json`) straight
into a live bot.

Built against the TeleBotHost OpenAPI 3.0.3 spec (`api.json` · `https://api.telebothost.com/api/v1`).

```
████████╗██████╗ ██╗  ██╗
╚══██╔══╝██╔══██╗██║  ██║
   ██║   ██████╔╝███████║
   ██║   ██╔══██╗██╔══██║
   ██║   ██████╔╝██║  ██║
   ╚═╝   ╚═════╝ ╚═╝  ╚═╝
   TeleBotHost CLI
```

```
manifest.json  ──►  plan (create / update / same)  ──►  POST/PATCH /bot/{id}/commands
```

---

## Requirements

- Node.js **18+** (global `fetch`; zero dependencies)
- A TeleBotHost **Developer API key** (`sk_…`) from the console

---

## Install

Like Wrangler: install it once, then use `tbh` from **any** folder.

```bash
npm i -g tbh-cli        # once, globally
npx tbh-cli deploy      # or run it without installing
```

From GitHub (tracks the newest commit):

```bash
npm i -g github:nepcodex1-dot/tbh-cli
npx github:nepcodex1-dot/tbh-cli deploy
```

From a local clone:

```bash
git clone https://github.com/nepcodex1-dot/tbh-cli.git
cd tbh-cli
npm link          # exposes `tbh` on your PATH
```

There are **no dependencies and no build step** — Node 18+ is all it needs.

```bash
tbh --version     # 1.5.1
```

---

## Run from any folder

`wrangler deploy` works because it finds your project config. `tbh` does the same,
in three steps:

```bash
# 1. anywhere at all
cd ~/Desktop

# 2. point the CLI at the project once
tbh link ~/projects/movie-bot

# 3. deploy from any folder, forever after
tbh deploy
tbh diff
```

`tbh link` only writes `project_dir` into `~/.tbh/config.json` — no API key is
needed for it. Undo with:

```bash
tbh unlink
```

Project resolution order for `deploy`, `new`, `diff` and `doctor`:

| # | Source | Example |
|---|---|---|
| 1 | `--dir` or positional folder | `tbh deploy D:\bots\movie-bot` |
| 2 | `manifest.json` in the cwd **or any parent** | `cd movie-bot/admin && tbh deploy` |
| 3 | the project remembered by `tbh link` | `cd ~ && tbh deploy` |

Whichever one wins is saved as the linked project, so the next run is instant.

---

## Signing in

The API key is the only thing the CLI ever asks you for. There are three ways to
give it — pick whichever fits your workflow:

| # | How | Where the key lives |
|---|---|---|
| 1 | `tbh login` — prompts once, input hidden | `~/.tbh/config.json` |
| 2 | `export TBH_API_KEY=sk_…` | the shell environment |
| 3 | `tbh config set api_key sk_…` | `~/.tbh/config.json` |

Or skip the terminal entirely and use the **[web UI](#web-ui)**.

### API key vs bot token — what do you actually need?

| Task | Needs |
|---|---|
| Deploy / diff / pull commands | **API key** (`sk_…`) + bot id |
| Start / stop / logs / analytics | **API key** (`sk_…`) + bot id |
| Browse everything | **API key** — `pub_…` is enough (read-only) |
| **Register a brand-new bot** in TeleBotHost | API key + **BotFather bot token** (`123456:AAH…`) |

A `bot_token` comes from **@BotFather** in Telegram and is only used once, for
`POST /bot`. Once the bot exists in TeleBotHost, you never touch the token again —
deploying to it needs nothing but the API key and its id. The web UI has an
**Add bot** dialog for exactly that one case.

On the **very first** command that needs the API, if no key is found and you are on
an interactive terminal, the CLI prints the sign-in screen and prompts automatically —
so `tbh deploy movie-bot` works on a fresh install with zero setup. On a
non-interactive shell (CI, pipes) it never blocks: it prints the three options above
and exits with code `3`.

Resolution order: `--key` → `TBH_API_KEY` → config file.

```
  ╭─ Sign in ──────────────────────────────────────────────────────────╮
  │ Paste your Developer API key. It is saved locally in              │
  │ C:\Users\you\.tbh\config.json                                     │
  │ and sent only to api.telebothost.com.                             │
  │                                                                   │
  │ Create one at https://console.telebothost.com/dashboard/developer  │
  ╰───────────────────────────────────────────────────────────────────╯

  API key › ••••••••••••••

  ✔  Key accepted by api.telebothost.com
  ✔  Saved to C:\Users\you\.tbh\config.json
```

---

## Web UI

No ids to copy, no flags to remember.

```bash
tbh ui
```

```
  Open this URL  (token is required — do not share it)

  http://127.0.0.1:7420/?t=9f2c…

  address       http://127.0.0.1:7420
  project root  C:\Users\idkwh\Downloads\savr-files
  config        shared with the CLI (C:\Users\you\.tbh)
```

Your browser opens a local console with:

- **Connect** — paste the API key once (`pub_` is clearly flagged as read-only)
- **Bot list** — searchable, shows status, `@username`, id and command count; the
  bot you click becomes the default and is tagged `default`
- **Overview** — status, commands, users, active 24 h, TBL version, Start/Stop,
  rename, and a **danger zone** that deletes the bot (typed confirmation)
- **Commands** — every command on the bot, with a filter box. Click a row to open
  the **code editor**:
  - edit the TBL code, name, folder, parse mode, aliases, answer, keyboard
  - toggle *reply only*, *groups only*, *case insensitive*, *web endpoint*
  - live line / byte counter (max 1 MB), `Tab` inserts two spaces, `Ctrl+S` saves
  - **Save**, **Delete**, or **+ New command**
  - select rows for **Delete selected**, or **Delete all** (type `DELETE` to confirm)
- **Deploy** — pick the project (`movie-bot` is auto-detected), preview the diff
  (`+ create` / `~ update` / `+ folder`), then deploy with a per-command log
- **Logs** — read and clear runtime errors
- **Add bot** — the only place a BotFather token is used: it registers the bot,
  then uploads the selected project's commands into it automatically

The theme is monochrome glass: near-black background, translucent blurred panels,
white primary buttons, no color accents. It is responsive — a 320 px sidebar next
to the content on a laptop, a slide-in drawer with a ☰ button on a phone, and the
editor collapses to a single column below 700 px.

Safety properties baked in:

- binds to **127.0.0.1 only** — never reachable from your network
- every `/api/*` call needs the random **session token** from the URL, so another
  tab or page cannot drive it (CSRF)
- `bot_token` is stripped from every API response before it reaches the browser
- every write is whitelisted server-side (`commandPayload`) — the browser cannot
  smuggle unknown fields or a token into a command update
- `pub_` keys are read-only in the UI as well: edit/delete controls are disabled
- shares `~/.tbh/config.json` with the CLI — sign in once, use either

Flags: `--port <n>` (default `7420`, falls back to a free port if busy),
`--no-open` (don't launch a browser), `--dir <project>` (where to scan for
`manifest.json`).

### New bot → commands loaded, in one dialog

1. `tbh ui` and paste the API key. Your bots load immediately and the last bot you
   used is opened for you.
2. Click **+ Add bot**, paste the **BotFather** token.
3. Leave *“Deploy these commands to the new bot automatically”* ticked.
4. That's it: the bot is registered, the console waits until it is ready, uploads
   every command from the selected project (creating the `admin` folder), and drops
   you on the Deploy tab showing the per-command log.

Pick the project in the same dialog if you have more than one; with a single
`manifest.json` in range it is preselected. Untick the box to create an empty bot
and deploy later.

---

## Quick start (movie & series bot)

```bash
# once
npm i -g tbh-cli

tbh login                  # paste the sk_… key (hidden), it is verified and saved
tbh ui                     # or do everything in the browser instead
tbh bots                   # see what is on the account
tbh use 123456             # optional: set the default bot

tbh link C:\path\to\movie-bot   # optional: deploy from any folder afterwards
tbh diff                   # 13 create + folder "admin", 0 writes
tbh deploy                 # push all commands to the selected bot
tbh start                  # launch the bot
tbh logs                   # check the first /start after testing on Telegram
```

Brand-new bot, no console visit:

```bash
tbh new C:\path\to\movie-bot   # asks for the @BotFather token, then: create → deploy → start
```

`movie-bot` is a positional argument; `--dir movie-bot` does the same. If you `cd`
inside the project folder (or have run `tbh link`), no argument is needed.

```
  ▌ Deploy  C:\...\movie-bot  →  bot #42

  + create /lib_db
  + create /start
  ...
  + folder admin/

  13 create

  ✔  folder admin
     1/13  created  /lib_db   #101
     2/13  created  /start    #102
  ...
    13/13  created  !         #113

  ╭─ Deployed ──────────────────────────╮
  │ ✔  13 change(s) applied to bot #42  │
  │    13 commands now match the manifest│
  ╰─────────────────────────────────────╯
```

---

## Creating a bot (`tbh new`)

`deploy` needs an existing bot and its id. Creating one needs the **BotFather token** —
once. `tbh new` chains everything and leaves you with a running bot:

```bash
tbh new                 # project = current folder
tbh new movie-bot
tbh deploy new movie-bot   # identical
```

```
  ╭─ Register a new bot ─────────────────────────────────────╮
  │ Open https://t.me/BotFather → /newbot → copy the token.  │
  │ It is sent once to TeleBotHost and never printed again.  │
  ╰──────────────────────────────────────────────────────────╯

  BotFather token › ••••••••••••••••••••

  project    C:\...\movie-bot
  commands   13
  folders    admin
  action     register → deploy → start

  ✔  Registered My Movie Bot  #123456789  @my_movie_bot
  ✔  Bot is ready
    1/13  created  /lib_db   #101
    ...
  ✔  Bot is running
```

Order matters, and the command follows it strictly:

1. **Load the project first** — a broken manifest fails before a bot is created.
2. Ask for the token (hidden input, never echoed, never stored).
3. `POST /bot` with `run_now: false` — create it, don't race the deploy.
4. **Wait until the new bot is actually readable** (retries 404/409/5xx while
   TeleBotHost provisions it).
5. Deploy every command and create missing folders.
6. `PATCH /bot/{id}` with `status: 1` and make it the default bot.

Flags: `--token <123456:AAH…>` skips the prompt, `--name "My Bot"` sets the display
name, `--yes` skips the confirmation. For automation the token can also come from
`TBH_BOT_TOKEN` (the VS Code extension does this so the secret never appears in the
process list).

---

## Which bot am I deploying to?

One **default bot** is shared by the CLI and the web UI:

```bash
tbh use 123456            # by id
tbh use @my_movie_bot     # or by username
tbh bots                  # the default is marked with ▸
```

In the web UI, clicking a bot in the sidebar makes it the default — it is tagged
`default` on the card. `tbh deploy`, `tbh start`, `tbh logs` and friends all use it.

Resolution order for any command:

1. `--bot <id>` — one-off override, never saved
2. the saved default (`tbh use` / web UI / `tbh new`)
3. the only bot on the account
4. an interactive picker (saved as the new default)

So `tbh deploy --bot 987654` deploys to an existing bot by id without touching your
default (`--id 987654` is the same flag), while plain `tbh deploy` uses the bot you
selected.

---

## Commands

| Command | What it does |
|---|---|
| `tbh ui` | Local web console — browse, diff, deploy, logs (no ids to copy) |
| `tbh login` | Asks for the API key once, verifies it, saves it |
| `tbh logout` | Deletes the saved configuration |
| `tbh whoami` | Key mask, config source, bot count, quota |
| `tbh config [show]` | Show the effective configuration |
| `tbh config set <k> <v>` | Set `api_key`, `base_url` or `default_bot` |
| `tbh config get <k>` | Print one value (`--reveal` for the key) |
| `tbh config unset <k>` | Clear one value |
| `tbh config path` | Print the config file path |
| `tbh config reset` | Delete the config file |
| `tbh bots` | Table of bots with online state (`--limit 0` for all) |
| `tbh use <id\|@username>` | Sets the default bot |
| `tbh status` | Details of the selected bot |
| `tbh start` / `tbh stop` | Launch / stop (`PATCH /bot/{id}` `status: 1\|0`) |
| `tbh deploy [dir]` | Create/update every command from the manifest (works from any folder) |
| `tbh new [dir]` | Register a bot from a BotFather token, deploy, and start it |
| `tbh diff [dir]` | Same plan, no writes |
| `tbh pull` | Download remote commands to `./pulled` |
| `tbh link [path]` | Remember a project folder so `tbh deploy` works anywhere |
| `tbh unlink` | Forget the linked project |
| `tbh ls` | List remote commands |
| `tbh get <name\|id>` | Print one remote command's code |
| `tbh rm <name\|id>` | Delete one remote command |
| `tbh logs` | Recent logs (`--limit N`, `--verbose`, `--clear`) |
| `tbh analytics` | Usage stats |
| `tbh export` | Temporary export download URL |
| `tbh env ls` | List environment variables (values masked) |
| `tbh env set NAME VALUE` | Create or update one |
| `tbh env rm NAME` | Delete one |
| `tbh doctor` | Checks node, key, config, project and connectivity |

### Flags

| Flag | Meaning |
|---|---|
| `--dir <path>` | Project folder (default: cwd, then parents, then `tbh link`) |
| `--bot <id>` | Override the selected bot for this call (`--id` is the same) |
| `--key <sk_…>` | Override the stored key for this call |
| `--dry-run` | Plan only, write nothing |
| `--yes`, `-y` | Skip confirmations |
| `--only a,b` | Deploy only these command names |
| `--prune` | Offer to delete remote commands missing from the manifest |
| `--delay <ms>` | Pause between writes (default `120`) |
| `--out <path>` | `pull` output folder (default `./pulled`) |
| `--force` | `pull`: overwrite existing files |
| `--limit N` | `logs`: how many entries |
| `--clear` | `logs`: delete all logs |
| `--verbose` | `logs`: include stack traces |
| `--reveal` | `config get api_key`: print the secret |
| `--json`, `-j` | Machine-readable output |
| `--no-color` | Disable ANSI colors |
| `--truecolor` / `--no-truecolor` | Force 24-bit / 256-color output |
| `--base <url>` | Override the API base URL |
| `--port <n>` | `ui`: port to listen on (default `7420`) |
| `--no-open` | `ui`: do not launch a browser |
| `--token <t>` | `new`: BotFather token (skips the prompt) |
| `--name <n>` | `new`: bot display name |
| `--no-input` | Never prompt; fail with setup instructions instead |

### Colors

`tbh` uses 24-bit color on modern terminals and automatically falls back to
256 colors, then to plain text. It also respects the standard environment:

- `NO_COLOR=1` disables color
- `FORCE_COLOR=1` enables color even when stdout is not a TTY
- `COLORTERM=truecolor` enables 24-bit output

Layout, boxes and the spinner collapse to plain lines when piped, so
`tbh deploy --json | jq` and CI logs stay clean.

---

## How `deploy` decides

1. Loads `manifest.json` and every `code_file` (errors on a missing file or duplicate name).
2. `GET /bot/{id}/commands` to see what exists.
3. Builds a plan **by command name**:
   - not on the bot → **create** (`POST /bot/{id}/commands`)
   - exists but fields differ → **update** (`PATCH /bot/{id}/commands/{commandid}`)
   - identical → **same**
4. Creates any missing folders (`POST /bot/{id}/commands/folders`).
5. Applies the plan, `120 ms` apart, printing each result.

Compared fields: `code`, `answer`, `keyboard`, `parse_mode`, `aliases`,
`allow_only_group`, `need_reply`, `case_insensitive`, `is_web`, `folder`.
`code` is compared with CRLF→LF and trailing whitespace normalized, so a Windows
checkout does not cause phantom updates.

Deploy is **idempotent**: run it as often as you like; a second run with no edits
makes zero write calls.

---

## Project format (standard)

Any folder with a `manifest.json` at its root is a project. The standard layout:

```
my-bot/
├── manifest.json          ← one entry per command (required)
├── tbhai.md               ← the format spec, so AI/humans generate matching code
├── README.md              ← optional
└── commands/
    ├── lib_db.js          ← shared module, require("/lib_db")
    ├── start.js
    ├── admin.js
    └── ...
```

The authoritative, complete spec is **[`tbhai.md`](tbhai.md)**. It covers:

- the full `manifest.json` field table and defaults
- reserved names: `*` (catch-all), `!` (error handler), `/handle_callback_query`
- the TBL code format, the `Api` / `db` / `params` / `chat` / `user` surface
- `db.bot.get/set/incr/push/pull/mget`, `ttl`, and the shared-module pattern
- house rules (no timers, idempotency, HTML escaping) and a pre-deploy checklist

**If you ask an AI agent to write commands, give it `tbhai.md` first** — it is written
to be used as the source of truth for code generation.

A minimal manifest entry:

```json
{
  "commands": [
    {
      "name": "/start",
      "code_file": "commands/start.js",
      "answer": "",
      "keyboard": "",
      "parse_mode": "",
      "aliases": [],
      "need_reply": false,
      "allow_only_group": false,
      "case_insensitive": false,
      "is_web": 0,
      "folder": ""
    }
  ]
}
```

`code_file` is read verbatim and becomes the command Logic.

Rules that bite:

- `answer` and `keyboard` **must stay empty for `*` and `!`**, otherwise every
  unmatched update gets an extra reply.
- `code_file` is relative to the project root and must exist.
- Command `name`s are unique; that is the deploy key.
- Shared modules are normal manifest entries, imported with `require("/name")` —
  not a file path.
- `folder` only groups commands in the console; missing folders are created on deploy.

`tbh pull` writes exactly this layout, so a pulled bot re-deploys with
`tbh deploy --dir pulled`. Both `deploy` and `diff` accept `--json` for scripts and
editors.

---

## Config and security

- Key stored in `%USERPROFILE%\.tbh\config.json` (`~/.tbh/config.json`), `chmod 600`.
- The same file remembers the default bot and the `tbh link`-ed project folder
  (`project_dir`) — no secrets are added by linking.
- Override the location with `TBH_CONFIG_DIR` (used by the tests).
- The CLI never prints the full key (`sk_abc…7890`) unless you pass `--reveal`.
- `tbh logout` and `tbh config reset` only delete the local file — revoke the key in
  the console if it may have leaked.

---

## Rate limits

TeleBotHost limits are plan-dependent and the CLI does not hardcode them — it reads
`X-RateLimit-*` from every response. A live `pub_` key on a FREE account reported
**30 requests/minute** and **2 000/day**, but treat those as examples, not constants.

The client:

- retries on **429** and **5xx**, honoring `Retry-After` / `X-RateLimit-Reset-Minute`,
- retries network failures twice,
- prints the retry wait to stderr, e.g. `!  HTTP 429 - retrying in 5.0s`,
- keeps deploys inside the budget with a `--delay` of 120 ms between writes.

A first deploy is ~15 calls (1 list + 1 folder + 13 creates), which is about half of a
30/minute window. If a 429 does happen mid-deploy, the CLI waits and continues instead
of failing; re-running `tbh deploy` is always safe because it is idempotent.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Not signed in` (exit 3) | `tbh login`, `export TBH_API_KEY=…`, or `tbh config set api_key …` |
| `Key rejected (401)` | Wrong/revoked key |
| `pub_key_readonly` | `pub_…` keys only allow GET/HEAD/OPTIONS — use an `sk_…` key to deploy |
| `No manifest.json found` | Run inside the project or pass `--dir movie-bot` |
| `Missing code file for "/start"` | `code_file` path in the manifest is wrong |
| `HTTP 429` warnings | Normal; the client waits and resumes |
| Commands deploy but the bot does nothing | `tbh start`, then check `tbh logs` |
| `tbh ui` port already in use | It picks a free port automatically, or pass `--port 7500` |
| Port 7420 not reachable from another PC | By design: the UI only listens on `127.0.0.1` |
| Colors look wrong | `--no-color`, `NO_COLOR=1`, or `--truecolor` |

`tbh doctor` checks all of the above in one shot.

---

## Tests

```bash
cd tbh-cli
npm test
```

34 offline checks, no network and no real key: config round-trip, manifest loading,
plan building, drift detection, CRLF normalization, slug mapping, flag parsing,
banner/box rendering (including ANSI-width alignment), `config set/unset`, the
non-interactive "no key" path, a full deploy against an in-memory fake API
(13 creates + 1 folder), idempotent re-deploy, `--only`, `--dry-run`, drift update,
`pull` round-trip, `--version` / `help` smoke tests, the web UI's session-token gate,
project discovery (including nested folders), `tbh link` / `tbh unlink` with a deploy
from an unrelated directory, the `bot_token` stripping guard, "create a bot then load the whole
project into it" (13 commands + 1 folder), the readiness retry for a brand-new bot,
the full `tbh new` flow (create → deploy → activate → default bot), the `--json`
deploy document consumed by the VS Code extension, the command-payload whitelist
(unknown fields and tokens never reach the API), the delete endpoints
(`DELETE /bot/{id}/commands/{cid}`, bulk `{ids}`, `DELETE /bot {ids}`), and the
folder helper tolerating "already exists" but not real errors.

---

## VS Code extension

A companion extension lives in the `tbh-vscode` package. It shells out to this
CLI (no duplicated API code) and adds:

- Command Palette actions for sign-in, default bot, diff, deploy, create, start/stop,
  logs, pull and the web console
- a status bar item showing the account's bot count
- right-click **Deploy** on any `manifest.json` in the Explorer
- deploy progress plus a per-command output panel

Press `F5` in `tbh-vscode/` to run it, or `npx @vscode/vsce package` to build a `.vsix`.

---

## Credits

Made by **[@nepcoder](https://t.me/nepcoder)**.

Built against the TeleBotHost Developer API (`api.json`, OpenAPI 3.0.3).

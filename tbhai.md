# tbhai.md — the standard format for a deployable TeleBotHost project

> **If you are an AI agent generating TBL for this repo: use this file as the single
> source of truth.** Follow the folder layout, the manifest schema and the code rules
> below exactly. Do not invent manifest fields or file names.

Made by **[@nepcoder](https://t.me/nepcoder)**.

---

## 1. Folder layout

Every deployable project is a folder with a `manifest.json` at its root:

```
my-bot/
├── manifest.json          ← required, one entry per command
├── tbhai.md               ← this spec (keep a copy in the project)
├── README.md              ← optional, human docs
└── commands/              ← one .js file per command (any name, see code_file)
    ├── lib_db.js          ← shared helpers, imported with require("/lib_db")
    ├── start.js
    ├── admin.js
    └── ...
```

Rules:

| Rule | Why |
|---|---|
| `manifest.json` must sit in the project root | `tbh deploy` searches upward for it |
| Every `code_file` must exist and be readable UTF-8 | deploy fails early otherwise |
| Two commands may not share the same `name` | the API keys commands by name |
| `code_file` paths are relative to the project root | portable across machines |
| File names are free-form; only `name` matters to Telegram | keeps folders readable |

Nothing else is required. No `package.json`, no build step, no bundler.

---

## 2. `manifest.json`

```json
{
  "bot": "movie-series-downloader",
  "notes": "free-form, ignored by the CLI",
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

### Fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | **required** | Trigger. `/start` for a command, `*` for the catch-all, `!` for the error handler, `/handle_callback_query` for inline buttons |
| `code_file` | string | **required** | Path to the command Logic, relative to the project root |
| `answer` | string | `""` | Auto-reply text. **Must stay empty for `*` and `!`** or every unmatched update gets spammed |
| `keyboard` | string | `""` | JSON keyboard attached to `answer`. Also keep empty unless you really want an auto-reply |
| `parse_mode` | string | `""` | `""`, `"HTML"` or `"Markdown"` — applies to `answer`, not to your own `Api.sendMessage` calls |
| `aliases` | string[] | `[]` | Extra triggers for the same logic |
| `need_reply` | boolean | `false` | Only run when the message is a reply to another message |
| `allow_only_group` | boolean | `false` | Restrict to group chats |
| `case_insensitive` | boolean | `false` | Match `/Start` as `/start` |
| `is_web` | 0 \| 1 | `0` | Expose as an HTTP endpoint instead of a Telegram command |
| `folder` | string \| null | `""` | Grouping in the TeleBotHost console. The CLI creates missing folders automatically |

Unknown keys (like `notes` or `warning`) are ignored by the deployer, so annotating
the manifest is safe.

### Reserved command names

| Name | Role |
|---|---|
| `*` | catch-all — every message that matched nothing else |
| `!` | error handler — fires when another command throws |
| `/handle_callback_query` | inline keyboard callbacks (`callback_query`) |

---

## 3. Command code format (TBL)

Each `code_file` is the **command Logic**. Write it as if it were the body of an
`async` function: top-level `await` is fine, because the runtime wraps the file in an
async IIFE. Do **not** write your own wrapper, and do not add `module.exports` unless
the file is a shared module.

### Available at runtime

| Global | What it is |
|---|---|
| `Api` | Bot API calls — `sendMessage`, `sendVideo`, `sendDocument`, `editMessageText`, `answerCallbackQuery`, `getMe`, and raw `Api.call(method, payload)` |
| `Bot` | Higher-level send helpers |
| `db` | Persistent storage — `db.bot` (shared per bot) and `db.user` (per user) |
| `params` | Text after the command, or the `start=` payload for deep links |
| `chat` | The chat object (`chat.id`, `chat.type`, …) |
| `user` | The sender (`user.id`, `user.first_name`, …) |
| `msg` | The incoming message object |
| `update` | The whole update (`update.callback_query`, …) |
| `error` | In the `!` handler, the thrown error |

### `db` surface

```js
await db.bot.get(key, fallback);            // value | fallback
await db.bot.set(key, value);               // store anything JSON-serialisable
await db.bot.set(key, value, { ttl: 86400 }); // expires in seconds
await db.bot.del(key);
await db.bot.incr(key, 1);                  // atomic counter
await db.bot.push(listKey, value);          // append to an array
await db.bot.pull(listKey, value);          // remove from an array
await db.bot.mget([key1, key2]);            // batch read
```

`db.bot`, `db.user` and `db.chat` share this surface. Never assume a key exists —
always pass a fallback.

### Shared modules

A file that only exports helpers is still a normal command in the manifest (Telegram
users simply never trigger it, because its name is not a real command):

```js
// commands/lib_db.js
async function cfg() {
  return (await db.bot.get("cfg", {})) || {};
}

module.exports = { cfg: cfg };
```

```js
// commands/start.js
const L = require("/lib_db");   // path = "/" + command name, not a file path
const c = await L.cfg();

await Api.sendMessage({ chat_id: chat.id, text: "hello", parse_mode: "HTML" });
```

`require` takes the **command name** from the manifest, prefixed with `/`. It is not a
filesystem path — `require("./lib_db")` will not work.

---

## 4. House rules for generated code

1. **One job per command.** `/get` fetches, `/search` searches, `/list` lists.
2. **Always `await` API calls** and keep `chat_id` explicit.
3. **Escape user text** before putting it in `parse_mode: "HTML"`
   (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`).
4. **No timers, no polling loops, no `setInterval`.** Multi-step flows are a state
   machine in `db` (see the upload flow in `movie-bot`), driven by the next update.
5. **Be idempotent.** The same update may arrive twice.
6. **Fail soft.** A cosmetic counter must never break file delivery:
   ```js
   try { await db.bot.incr("hits", 1); } catch (e) { /* ignore */ }
   ```
7. **Cap output.** List at most ~15–20 rows per message; slice long strings.
8. **Admins.** Persist `admin_id` in `db.bot`, check it before destructive commands,
   and never trust a client-supplied id.
9. **`*` and `!` keep `answer` and `keyboard` empty** in the manifest.
10. **No secrets in code.** Use `tbh env set NAME value` / the console for tokens.

---

## 5. Code conventions used by `movie-bot`

| Kind | Code |
|---|---|
| Movie | `MV0001`, `MV0002`, … (`db.bot.incr("seq", 1)`) |
| Series | `SR0001`, … |
| Episode | `SR0001E2` (series code + `E` + episode number) |
| Share link | `https://t.me/<bot>?start=<CODE>` |

Storage keys:

| Key | Holds |
|---|---|
| `cfg` | `{ admin_id, channel_id, channel_title, bot_username }` |
| `m:<CODE>` | `{ code, title, file_id, chat_id, msg_id, kind, added_at }` |
| `s:<CODE>` | `{ code, title, episodes: [...] }` |
| `idx_movies`, `idx_series` | ordered arrays of codes |
| `p:<id>` | pending upload, `ttl: 86400` |
| `act:<adminId>` | which pending upload the admin is editing |
| `seq` | monotonic counter for codes |

Files are delivered with `Api.call("copyMessage", { from_chat_id, message_id, chat_id })`
against the private storage channel, falling back to `Api.sendVideo` /
`Api.sendDocument` by `file_id`.

---

## 6. Deploying a project

```bash
tbh diff                 # preview: + create  ~ update  = same
tbh deploy               # apply, idempotent
tbh deploy --bot 123     # target a specific bot id
tbh new                  # create a brand-new bot from a @BotFather token, then deploy + start
tbh ui                   # or do all of it in the browser
```

The deployer compares `code` (CRLF-normalised), `answer`, `keyboard`, `parse_mode`,
`aliases`, `allow_only_group`, `need_reply`, `case_insensitive`, `is_web` and `folder`.
It only writes what changed.

A new bot must be registered before it can receive commands — that is what the
BotFather token is for. Deploying to an **existing** bot needs only its id.

---

## 7. Checklist before you deploy

- [ ] `manifest.json` parses and every `code_file` exists
- [ ] command names are unique
- [ ] `*` and `!` have empty `answer` and `keyboard`
- [ ] shared modules are listed in the manifest **and** use `module.exports`
- [ ] `require("/name")` matches a manifest `name`
- [ ] user-supplied text is HTML-escaped
- [ ] `tbh diff` shows what you expect
- [ ] `tbh deploy`, then `tbh logs` for runtime errors

---

Made by **[@nepcoder](https://t.me/nepcoder)**.

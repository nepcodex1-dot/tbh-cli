#!/usr/bin/env node
"use strict";

const io = require("./io");
const config = require("./config");
const http = require("./http");

const auth = require("./commands/auth");
const bots = require("./commands/bots");
const cmds = require("./commands/commands");
const ops = require("./commands/ops");
const cfgCmd = require("./commands/config");
const uiCmd = require("./commands/ui");
const newBot = require("./commands/newbot");
const linkCmd = require("./commands/link");

const VERSION = require("../package.json").version;

const CREDIT = "@nepcoder";

const VALUE_FLAGS = new Set([
  "key", "bot", "id", "dir", "out", "delay", "base", "limit", "only", "config", "port", "token", "name"
]);

/* Commands that talk to the API and therefore need a key. */
const NEEDS_AUTH = new Set([
  "whoami", "me",
  "bots", "use", "status", "start", "stop",
  "deploy", "push", "diff", "pull", "ls", "commands", "get", "rm", "delete",
  "new", "create",
  "logs", "analytics", "stats", "export", "env"
]);

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === "--") {
      positional.push.apply(positional, argv.slice(i + 1));
      break;
    }

    if (token.indexOf("--") === 0) {
      const eq = token.indexOf("=");
      if (eq > -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
        continue;
      }
      const name = token.slice(2);
      if (VALUE_FLAGS.has(name)) {
        const next = argv[i + 1];
        if (next !== undefined && String(next).indexOf("--") !== 0) {
          flags[name] = next;
          i++;
        } else {
          flags[name] = true;
        }
      } else {
        flags[name] = true;
      }
      continue;
    }

    if (token.indexOf("-") === 0 && token.length > 1) {
      const short = token.slice(1);
      if (short === "h") flags.help = true;
      else if (short === "y") flags.yes = true;
      else if (short === "j") flags.json = true;
      else if (short === "v") flags.version = true;
      else positional.push(token);
      continue;
    }

    positional.push(token);
  }

  /* `--id` is a friendlier spelling of `--bot` (same meaning: an existing bot id). */
  if (flags.id !== undefined && flags.bot === undefined) flags.bot = flags.id;

  return { flags: flags, positional: positional };
}

function normalizeBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\/[^\s]+$/i.test(raw)) {
    io.die("Invalid API base URL: " + raw + "\n  Expected something like https://api.telebothost.com/api/v1");
  }
  return raw.replace(/\/+$/, "");
}

function buildCtx(flags) {
  const cfg = config.load();

  const key = typeof flags.key === "string"
    ? flags.key.trim()
    : (process.env.TBH_API_KEY || cfg.api_key || "").trim();

  const base = normalizeBase(
    (typeof flags.base === "string" && flags.base) ||
    process.env.TBH_BASE_URL ||
    cfg.base_url ||
    config.DEFAULT_BASE
  );

  const ctx = {
    flags: flags,
    cfg: cfg,
    key: key,
    base: base,
    botId: flags.bot ? Number(flags.bot) : (cfg.default_bot ? Number(cfg.default_bot) : null),
    client: null,
    json: !!flags.json,
    version: VERSION
  };

  ctx.ensure = function () {
    if (!ctx.key) {
      const e = new Error("Not signed in.");
      e.exitCode = 3;
      e.silent = true;
      throw e;
    }
    if (!ctx.client) {
      ctx.client = http.createClient({ key: ctx.key, base: ctx.base });
    }
    return ctx.client;
  };

  /* Re-read the config after an interactive login. */
  ctx.refresh = function () {
    const next = config.load();
    ctx.cfg = next;
    if (!flags.key && !process.env.TBH_API_KEY) ctx.key = (next.api_key || "").trim();
    if (!flags.bot && next.default_bot) ctx.botId = Number(next.default_bot);
    ctx.client = null;
    return ctx;
  };

  return ctx;
}

/* ------------------------------------------------------------------ */
/*  help                                                               */
/* ------------------------------------------------------------------ */

function row(name, desc, notes) {
  io.out("    " + io.c.brand(io.pad(name, 22)) + desc +
    (notes ? io.c.faint("  " + notes) : ""));
}

function help(ctx) {
  io.banner({
    version: VERSION,
    subtitle: "TeleBotHost CLI",
    tagline: "deploy TBL command projects over the Developer API"
  });

  io.out("  " + io.c.bold("USAGE") + "  " + io.c.muted("tbh <command> [options]"));
  io.out("");

  io.out("  " + io.c.bold("AUTH"));
  row("login", "Save and verify your API key", "prompts once, hidden input");
  row("logout", "Delete the saved configuration");
  row("whoami", "Show the key, bot count and quota");
  row("config", "Show or edit the saved configuration", "show | set | get | unset");
  io.out("");

  io.out("  " + io.c.bold("WEB UI"));
  row("ui", "Open a local console in your browser", "no ids to copy — recommended");
  io.out("");

  io.out("  " + io.c.bold("BOTS"));
  row("bots", "List every bot on the account");
  row("use <id|@name>", "Select the default bot");
  row("status", "Details of the selected bot");
  row("start | stop", "Launch or stop the selected bot");
  io.out("");

  io.out("  " + io.c.bold("DEPLOY") + "  " + io.c.muted("(project = folder with manifest.json)"));
  row("deploy [dir]", "Create or update all commands", "works from any folder after `tbh link`");
  row("new [dir]", "Register a bot, deploy, and start it", "asks for the BotFather token");
  row("diff [dir]", "Preview what deploy would change");
  row("pull", "Download the bot's commands into ./pulled");
  row("ls", "List the commands on the bot");
  row("get <name|id>", "Print one command's code");
  row("rm <name|id>", "Delete one command");
  io.out("");

  io.out("  " + io.c.bold("PROJECT"));
  row("link [path]", "Remember a project folder", "no key needed");
  row("unlink", "Forget the linked project");
  io.out("");

  io.out("  " + io.c.bold("OPS"));
  row("logs", "Recent runtime logs", "--limit N  --verbose");
  row("analytics", "Usage statistics");
  row("export", "Temporary download link for the bot");
  row("env <ls|set|rm>", "Manage environment variables");
  row("doctor", "Check node, key, project and connectivity");
  io.out("");

  io.out("  " + io.c.bold("OPTIONS"));
  row("--dir <path>", "Project folder (default: cwd, searched upward)");
  row("--bot <id>", "Override the selected bot" + io.c.faint("  (--id works too)"));
  row("--key <sk_…>", "Override the stored key");
  row("--dry-run", "Plan only, write nothing");
  row("--yes, -y", "Skip confirmations");
  row("--only a,b", "Deploy only these command names");
  row("--prune", "Delete remote commands missing from the manifest");
  row("--delay <ms>", "Pause between writes" + io.c.faint("  (default 120)"));
  row("--out <path>", "pull output folder" + io.c.faint("  (default ./pulled)"));
  row("--force", "pull: overwrite existing files");
  row("--json, -j", "Machine-readable output");
  row("--no-color", "Disable ANSI colors");
  row("--base <url>", "Override the API base URL");
  row("--port <n>", "ui: port to listen on" + io.c.faint("  (default 7420)"));
  row("--no-open", "ui: do not launch a browser");
  row("--token <t>", "new: BotFather token (skips the prompt)");
  row("--name <n>", "new: bot display name");
  io.out("");

  io.divider();

  const keyset = !!(ctx && ctx.key);
  io.out("  " + io.c.muted("config") + "  " + io.c.faint(config.configFile()));
  io.out("  " + io.c.muted("status") + "  " +
    (keyset
      ? io.c.ok("signed in") + io.c.faint("  " + config.maskKey(ctx.key) + " · " + auth.keySource(ctx))
      : io.c.warn("not signed in") + io.c.faint("  run `tbh login`")));
  io.out("  " + io.c.muted("api") + "     " + io.c.faint(ctx ? ctx.base : config.DEFAULT_BASE));
  io.out("  " + io.c.muted("made by") + " " + io.c.accent(CREDIT));
  io.out("");
  io.out("  " + io.c.muted("Install globally: ") + io.c.brand("npm i -g github:nepcodex1-dot/tbh-cli"));
  io.out("  " + io.c.muted("Try without installing: ") + io.c.brand("npx github:nepcodex1-dot/tbh-cli deploy"));
  io.out("");
}

/* ------------------------------------------------------------------ */
/*  dispatch                                                           */
/* ------------------------------------------------------------------ */

async function main(argv) {
  const parsed = parseArgs(argv);
  const flags = parsed.flags;

  if (flags["no-color"]) io.setColor(false);
  if (flags["truecolor"]) io.setTruecolor(true);
  if (flags["no-truecolor"]) io.setTruecolor(false);
  if (flags.quiet) process.env.TBH_QUIET = "1";

  if (flags.version) {
    io.out(VERSION);
    return;
  }

  const command = parsed.positional[0];

  if (!command || flags.help || command === "help" || command === "-h") {
    help(buildCtx(flags));
    return;
  }

  const ctx = buildCtx(flags);
  const rest = parsed.positional.slice(1);

  /* ---- first-run key prompt -------------------------------------- */
  if (NEEDS_AUTH.has(command) && !ctx.key) {
    const interactive = !!process.stdin.isTTY && !flags.json && !flags["no-input"];

    if (!interactive) {
      io.out("");
      io.out("  " + io.c.bad("✖") + "  " + io.c.bold("No API key available."));
      io.out("");
      io.out("  " + io.c.bold("Three ways to configure it:"));
      io.out("");
      io.out("    1. " + io.c.brand("tbh login") + "                    " + io.c.muted("interactive, hidden input"));
      io.out("    2. " + io.c.brand("export TBH_API_KEY=sk_…") + "     " + io.c.muted("environment variable"));
      io.out("    3. " + io.c.brand("tbh config set api_key sk_…") + "  " + io.c.muted("writes the config file"));
      io.out("");
      io.out("  " + io.c.muted("Non-interactive shell detected, so nothing was prompted."));
      io.out("");

      const err = new Error("Not signed in.");
      err.silent = true;
      err.exitCode = 3;
      throw err;
    }

    await auth.firstRun(ctx);
    ctx.refresh();
    io.out("");
  }

  switch (command) {
    case "login":
    case "signin":
      return auth.login(ctx);
    case "logout":
    case "signout":
      return auth.logout(ctx);
    case "whoami":
    case "me":
      return auth.whoami(ctx);

    case "config":
    case "cfg":
      return cfgCmd.run(ctx, rest);

    case "ui":
    case "web":
      return uiCmd.run(ctx);

    case "bots":
      return bots.list(ctx);
    case "use":
      return bots.use(ctx, rest[0]);
    case "status":
      return bots.status(ctx);
    case "start":
      return bots.setStatus(ctx, 1);
    case "stop":
      return bots.setStatus(ctx, 0);

    case "deploy":
    case "push":
      /* `tbh deploy new` == `tbh new` — the token prompt follows. */
      if (rest[0] === "new") {
        if (!flags.dir && rest[1]) flags.dir = rest[1];
        return newBot.run(ctx);
      }
      if (!flags.dir && rest[0]) flags.dir = rest[0];
      return cmds.deploy(ctx);

    case "new":
    case "create":
      if (!flags.dir && rest[0]) flags.dir = rest[0];
      return newBot.run(ctx);

    case "diff":
      if (!flags.dir && rest[0]) flags.dir = rest[0];
      return cmds.diff(ctx);
    case "link":
      return linkCmd.run(ctx, rest[0]);
    case "unlink":
      return linkCmd.unlink(ctx);
    case "pull":
      return cmds.pull(ctx);
    case "ls":
    case "commands":
      return cmds.ls(ctx);
    case "get":
      return cmds.get(ctx, rest[0]);
    case "rm":
    case "delete":
      return cmds.rm(ctx, rest[0]);

    case "logs":
      return ops.logs(ctx);
    case "analytics":
    case "stats":
      return ops.analytics(ctx);
    case "export":
      return ops.exportLink(ctx);
    case "env":
      return ops.env(ctx, rest);
    case "doctor":
      return ops.doctor(ctx);

    default:
      io.out("");
      io.err("Unknown command: " + io.c.bold(command));
      io.out("");
      io.out("  " + io.c.muted("Run ") + io.c.brand("tbh help") + io.c.muted(" for the full list."));
      if (suggest(command)) io.out("  " + io.c.muted("Did you mean ") + io.c.brand(suggest(command)) + io.c.muted("?"));
      io.out("");
      io.die("Unknown command: " + command, 2);
  }
}

function suggest(word) {
  const names = [
    "login", "logout", "whoami", "config", "bots", "use", "status", "start", "stop",
    "deploy", "new", "diff", "pull", "ls", "get", "rm", "logs", "analytics", "export",
    "env", "doctor", "ui", "link", "unlink", "help"
  ];
  const w = String(word).toLowerCase();

  let best = null;
  let bestScore = Infinity;

  names.forEach(function (n) {
    const d = distance(w, n);
    if (d < bestScore) {
      bestScore = d;
      best = n;
    }
  });

  return bestScore <= 2 ? best : null;
}

function distance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, function (_, i) {
    return Array.from({ length: n + 1 }, function (_, j) {
      return i === 0 ? j : (j === 0 ? i : 0);
    });
  });
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

module.exports = {
  main: main,
  parseArgs: parseArgs,
  buildCtx: buildCtx,
  help: help,
  VERSION: VERSION
};

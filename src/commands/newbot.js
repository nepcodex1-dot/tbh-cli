"use strict";

/*
 * `tbh new` / `tbh deploy new`
 *
 * Register a bot from an @BotFather token, load the local project into it and
 * start it — the whole "brand new bot" path in one command.
 */

const io = require("../io");
const api = require("../api");
const config = require("../config");
const project = require("../project");
const cmds = require("./commands");
const wait = require("../wait");

const BOTFATHER = "https://t.me/BotFather";
const TOKEN_RE = /^\d+:[\w-]{20,}$/;

function looksLikeBotToken(value) {
  return TOKEN_RE.test(String(value || "").trim());
}

/* Never print a bot token: keep the numeric id, hide the secret half. */
function maskToken(token) {
  const s = String(token || "");
  const colon = s.indexOf(":");
  if (colon < 0) return s.slice(0, 3) + "…";
  return s.slice(0, colon) + ":••••••••" + s.slice(-4);
}

function emitJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

/* JSON callers get a JSON error object; humans get the usual red box. */
function fail(ctx, message, code) {
  if (ctx.json) {
    emitJson({ ok: false, error: message });
    const e = new Error(message);
    e.silent = true;
    e.exitCode = code || 1;
    throw e;
  }
  io.die(message, code);
}

async function askToken(ctx) {
  if (typeof ctx.flags.token === "string" && ctx.flags.token.trim()) {
    return ctx.flags.token.trim();
  }

  /* Automation (VS Code, CI): keep the token out of the process arguments. */
  const fromEnv = (process.env.TBH_BOT_TOKEN || "").trim();
  if (fromEnv) return fromEnv;

  if (!process.stdin.isTTY) {
    fail(ctx, 
      "No bot token given.\n" +
      "  Pass one with --token <123456:AAH…>, or run this in an interactive terminal."
    );
  }

  io.box("Register a new bot", [
    "",
    "Open " + io.c.accent(BOTFATHER) + " → /newbot → copy the token.",
    "",
    io.c.muted("It is sent once to TeleBotHost and never printed again."),
    ""
  ]);

  const typed = await io.askHidden("\n  " + io.c.brand("BotFather token") + " " + io.c.faint("›") + " ");
  return String(typed || "").trim();
}

async function confirmPlan(ctx, proj) {
  const folders = [];
  proj.entries.forEach(function (e) {
    if (e.folder && folders.indexOf(e.folder) < 0) folders.push(e.folder);
  });

  io.out("");
  io.out(io.kv([
    ["project", proj.root],
    ["commands", String(proj.entries.length)],
    ["folders", folders.length ? folders.join(", ") : io.c.muted("—")],
    ["action", "register → deploy → start"]
  ]));
  io.out("");

  if (ctx.flags.yes) return true;

  const go = await io.confirm("Create the bot and load these commands into it?", true);
  if (!go) {
    io.info("Aborted — nothing was created.");
    io.out("");
  }
  return go;
}

async function run(ctx) {
  const client = ctx.ensure();

  /* Load the project first: a broken manifest must fail before a bot exists. */
  const proj = project.loadProject(ctx.flags.dir);

  if (ctx.json) process.env.TBH_QUIET = "1";

  const botName = typeof ctx.flags.name === "string" && ctx.flags.name.trim()
    ? ctx.flags.name.trim()
    : undefined;

  const token = await askToken(ctx);

  if (!token) fail(ctx, "No bot token provided. Nothing was created.");
  if (!looksLikeBotToken(token)) {
    fail(ctx, 
      "That does not look like a BotFather token.\n" +
      "  Expected 123456789:AAH… (digits, a colon, then the secret)."
    );
  }

  if (!(await confirmPlan(ctx, proj))) {
    if (ctx.json) emitJson({ ok: false, aborted: true });
    return { ok: false, aborted: true };
  }

  /* ---- 1. register ------------------------------------------------- */

  const spin = io.spinner("Registering the bot with TeleBotHost…");

  let created;
  try {
    created = await api.createBot(client, {
      bot_token: token,
      bot_name: botName,
      run_now: false
    });
  } catch (e) {
    spin.stop();
    if (e.status === 400) {
      fail(ctx, 
        "TeleBotHost rejected the token (HTTP 400).\n" +
        "  Make sure the bot is not already added, and that the token was copied whole."
      );
    }
    throw e;
  }

  const bot = created.bot || created;
  const botId = Number(bot.bot_id || bot.id || 0);

  if (!botId) {
    spin.stop();
    fail(ctx, "TeleBotHost accepted the token but returned no bot id — check the console.");
  }

  spin.succeed(
    "Registered " + io.c.bold(bot.name || bot.bot_name || ("bot #" + botId)) + "  " +
    io.c.accent("#" + botId) +
    (bot.bot_username ? io.c.faint("  @" + bot.bot_username) : "") +
    io.c.faint("  token " + maskToken(token))
  );

  /* Make it the working bot straight away. */
  const cfg = config.load();
  cfg.default_bot = botId;
  config.save(cfg);
  ctx.cfg = cfg;
  ctx.botId = botId;

  /* ---- 2. wait until the API can see it ---------------------------- */

  const ready = io.spinner("Waiting for the new bot to become ready…");
  let readyError = null;

  try {
    await wait.untilReady(client, botId, { delay: 700 });
    ready.succeed("Bot is ready");
  } catch (e) {
    ready.stop();
    readyError = e;
    io.warn("Could not confirm readiness: " + e.message);
    io.note("Trying the deploy anyway — it is idempotent.");
  }

  /* ---- 3. deploy the project --------------------------------------- */

  ctx.flags.dir = proj.root;
  ctx.flags.yes = true;

  let deployed = null;
  let deployError = null;

  /* The deploy prints its own --json document; we emit one for the whole flow. */
  const wasJson = ctx.json;
  ctx.json = false;

  try {
    const result = await cmds.deploy(ctx);
    deployed = {
      applied: result ? result.applied : 0,
      creates: result && result.plan ? result.plan.creates.length : 0,
      updates: result && result.plan ? result.plan.updates.length : 0
    };
  } catch (e) {
    deployError = e;
    io.warn("The deploy did not finish cleanly — the bot still gets activated.");
  } finally {
    ctx.json = wasJson;
  }

  /* ---- 4. activate -------------------------------------------------- */

  const start = io.spinner("Activating the bot…");
  let started = false;

  try {
    await api.updateBot(client, botId, { status: 1 });
    started = true;
    start.succeed("Bot is running");
  } catch (e) {
    start.stop();
    io.warn("Could not start the bot: " + e.message);
    io.note("Start it later with `tbh start --bot " + botId + "`.");
  }

  /* ---- 5. summary --------------------------------------------------- */

  const username = bot.bot_username || "";
  const link = username ? "https://t.me/" + username : "";

  const summary = {
    ok: !deployError,
    bot: {
      bot_id: botId,
      name: bot.name || bot.bot_name || null,
      username: username || null,
      link: link || null,
      status: started ? 1 : 0
    },
    project: proj.root,
    commands: proj.entries.length,
    deployed: deployed,
    deploy_failed: deployError ? deployError.message : null,
    ready: !readyError
  };

  if (ctx.json) {
    emitJson(summary);
  } else {
    io.out("");
    io.box("New bot is live", [
      "",
      io.c.ok("✔") + "  " + io.c.bold(bot.name || bot.bot_name || ("bot #" + botId)) + "  " + io.c.accent("#" + botId),
      username ? io.c.muted("   @" + username + "  ·  ") + io.c.accent(link) : "",
      io.c.muted("   " + proj.entries.length + " command(s) from " + proj.root),
      io.c.muted("   default bot is now #" + botId),
      ""
    ]);
    io.out("");
    io.note("Open Telegram and send /start to @" + (username || "your bot") + ".");
    io.note("Pull the commands back any time with `tbh pull --bot " + botId + "`.");
    io.out("");
  }

  if (deployError) {
    const err = new Error("bot created, but the deploy did not finish");
    err.silent = true;
    err.exitCode = 1;
    throw err;
  }

  return summary;
}

module.exports = {
  run: run,
  looksLikeBotToken: looksLikeBotToken,
  maskToken: maskToken
};

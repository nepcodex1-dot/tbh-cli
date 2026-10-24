"use strict";

const io = require("../io");
const config = require("../config");
const http = require("../http");
const api = require("../api");

const CONSOLE_URL = "https://console.telebothost.com";
const KEYS_URL = "https://console.telebothost.com/dashboard/developer";

function looksLikeKey(key) {
  return /^(sk|pub)_/.test(key);
}

/* Keep long bot names from wrapping the table on narrow terminals. */
function clip(value, max) {
  const s = String(value == null ? "" : value);
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/* Where did the key come from? Used by `tbh config show` and `whoami`. */
function keySource(ctx) {
  if (typeof ctx.flags.key === "string" && ctx.flags.key.trim()) return "--key flag";
  if ((process.env.TBH_API_KEY || "").trim()) return "TBH_API_KEY env";
  if ((config.load().api_key || "").trim()) return "config file";
  return "none";
}

function verify(client) {
  return api.listBots(client);
}

function keyHints() {
  io.note("tbh login                      # paste it once, it is saved");
  io.note("TBH_API_KEY=sk_…  tbh bots     # or pass it by environment");
  io.note("tbh config set api_key sk_…    # or write it manually");
}

async function askFor(ctx) {
  if (typeof ctx.flags.key === "string" && ctx.flags.key.trim()) {
    return { key: ctx.flags.key.trim(), source: "--key" };
  }

  const envKey = (process.env.TBH_API_KEY || "").trim();
  if (envKey) {
    io.info("Using " + io.c.bold("TBH_API_KEY") + " from the environment.");
    return { key: envKey, source: "env" };
  }

  const existing = (config.load().api_key || "").trim();
  const suffix = existing ? io.c.muted(" (enter to keep " + config.maskKey(existing) + ")") : "";

  const typed = await io.askHidden("\n  " + io.c.brand("API key") + " " + io.c.faint("›") + " " + suffix);

  if (!typed) {
    if (existing) {
      io.info("Keeping the stored key.");
      return { key: existing, source: "config" };
    }
    io.die("No API key provided. Nothing to do.");
  }

  return { key: typed, source: "prompt" };
}

async function authenticate(ctx, key) {
  const client = http.createClient({ key: key, base: ctx.base });
  const spin = io.spinner("Verifying key with TeleBotHost…");

  let data;
  try {
    data = await verify(client);
  } catch (e) {
    spin.stop();
    if (e.status === 401 || e.status === 403) {
      io.err("Key rejected by TeleBotHost (HTTP " + e.status + ").");
      io.note("Check that you copied the whole sk_… value and that it has not been revoked.");
      io.note("Read-only pub_… keys cannot deploy commands.");
      io.die("Authentication failed.");
    }
    if (e.status === 429) {
      io.warn("Rate limited while verifying, but the key was accepted.");
    } else {
      spin.fail("Could not reach " + ctx.base);
      io.note(e.message);
      io.die("Network error — the key was not saved.");
    }
  }

  if (!data) data = { success: true, bots: [] };

  spin.succeed("Key accepted by " + io.c.bold(new URL(ctx.base).host));

  const cfg = config.load();
  cfg.api_key = key;
  cfg.base_url = ctx.base;
  cfg.saved_at = new Date().toISOString();

  const bots = data.bots || [];
  if (!cfg.default_bot && bots.length === 1) cfg.default_bot = bots[0].bot_id;

  const file = config.save(cfg);

  io.ok("Saved to " + io.c.muted(file));
  io.ok("Key " + io.c.muted(config.maskKey(key)) + "  " + io.c.faint("(" + key.length + " chars)"));

  if (bots.length) {
    io.section("Bots on this account");
    io.out(io.table(
      ["ID", "NAME", "USERNAME", "STATUS"],
      bots.slice(0, 8).map(function (b) {
        return [
          String(b.bot_id),
          clip(b.name || "?", 34),
          b.bot_username ? "@" + b.bot_username : "?",
          b.status === 1 ? io.c.ok("● online") : io.c.muted("○ stopped")
        ];
      })
    ));

    if (bots.length > 8) {
      io.note("… and " + (bots.length - 8) + " more  ·  `tbh bots --limit 0` lists everything");
    }
    io.out("");

    if (bots.length === 1) {
      io.info("Default bot set to " + io.c.bold("#" + bots[0].bot_id) + "  " + (bots[0].name || ""));
    } else {
      const current = cfg.default_bot;
      if (current) {
        io.info("Default bot: " + io.c.bold("#" + current));
      } else {
        io.note("Pick one with `tbh use <id>` (or add --bot <id> to a single command).");
      }
    }
  } else {
    io.warn("This account has no bots yet.");
    io.note("Create one in the console, then run `tbh bots`.");
  }

  ctx.cfg = cfg;
  ctx.key = key;
  ctx.client = client;
  if (cfg.default_bot) ctx.botId = Number(cfg.default_bot);

  return { cfg: cfg, bots: bots, data: data };
}

/* ------------------------------------------------------------------ */
/*  public entry points                                                */
/* ------------------------------------------------------------------ */

async function login(ctx) {
  io.banner({ version: ctx.version, subtitle: "TeleBotHost CLI", tagline: "deploy TBL commands from your terminal" });

  if (keySource(ctx) === "none") {
    io.box("Sign in", [
      "",
      "Paste your Developer API key. It is saved locally in",
      io.c.muted(config.configFile()),
      "and sent only to " + io.c.accent(new URL(ctx.base).host) + ".",
      "",
      io.c.muted("Create one at ") + io.c.accent(KEYS_URL),
      ""
    ]);
  }

  const picked = await askFor(ctx);

  if (!looksLikeKey(picked.key)) {
    io.warn("That does not look like a TeleBotHost key (expected sk_… or pub_…).");
    io.note("Trying anyway — the server has the final word.");
  }
  if (picked.key.indexOf("pub_") === 0) {
    io.warn("pub_ keys are read-only. Deploy and start will be rejected.");
  }

  io.out("");
  const result = await authenticate(ctx, picked.key);

  io.out("");
  io.ok("You are signed in. Next:");
  io.note("tbh diff movie-bot     see what would change");
  io.note("tbh deploy movie-bot   push the commands");
  io.note("tbh start              launch the bot");
  io.out("");

  return result;
}

/* Called automatically the first time a command needs the API and no key is
 * available. Compact, and safe to run mid-command. */
async function firstRun(ctx) {
  io.banner({ version: ctx.version, subtitle: "First run", tagline: "no API key found — let's fix that" });

  io.box("Where to get the key", [
    "",
    "1. Open " + io.c.accent(CONSOLE_URL),
    "2. Developer API → create a key",
    "3. Paste it below (input is hidden)",
    "",
    io.c.muted("Already configured it? Export TBH_API_KEY instead and re-run.")
  ]);

  io.out("");
  const picked = await askFor(ctx);

  if (!picked.key) io.die("No API key provided.");

  io.out("");
  const result = await authenticate(ctx, picked.key);
  io.out("");

  return result;
}

function logout() {
  const had = !!config.load().api_key;
  const removed = config.clear();

  io.out("");
  if (removed && had) {
    io.ok("Removed " + io.c.muted(config.configFile()));
    io.note("The key on TeleBotHost is untouched — revoke it in the console if needed.");
  } else {
    io.info("No saved key — nothing to remove.");
  }
  io.out("");
}

async function whoami(ctx) {
  const client = ctx.ensure();
  const spin = io.spinner("Contacting " + new URL(ctx.base).host + "…");

  let res;
  try {
    res = await client.get("/bot");
  } catch (e) {
    spin.stop();
    throw e;
  }

  const data = res.data || {};
  const rate = http.rateInfo(res.headers);
  const bots = data.bots || [];
  const online = bots.filter(function (b) { return b.status === 1; }).length;

  spin.succeed("Connected");

  io.section("Account");
  io.out(io.kv([
    ["key", config.maskKey(ctx.key) + "  " + io.c.faint("(" + keySource(ctx) + ")")],
    ["api", ctx.base],
    ["bots", String(bots.length) + io.c.faint("  (" + online + " online)")],
    ["default bot", ctx.botId ? "#" + ctx.botId : io.c.muted("(none — run `tbh use <id>`)")]
  ]));

  if (rate && rate.dailyRemaining != null) {
    io.section("Quota");
    io.out(io.kv([
      ["today", rate.dailyRemaining + io.c.faint(" / " + (rate.dailyLimit || "?")) + " requests left"],
      ["this minute", (rate.minuteRemaining || "?") + io.c.faint(" / " + (rate.minuteLimit || "?"))]
    ]));
  }
  io.out("");
}

module.exports = {
  login: login,
  firstRun: firstRun,
  logout: logout,
  whoami: whoami,
  keySource: keySource,
  looksLikeKey: looksLikeKey
};

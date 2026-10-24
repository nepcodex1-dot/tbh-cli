"use strict";

const fs = require("fs");

const io = require("../io");
const config = require("../config");
const http = require("../http");
const api = require("../api");
const auth = require("./auth");

const WRITABLE = ["api_key", "base_url", "default_bot"];

function show(ctx) {
  const cfg = config.load();
  const hasKey = !!(cfg.api_key || "").trim();

  io.section("Configuration");
  io.out(io.kv([
    ["file", io.c.muted(config.configFile()) + (fs.existsSync(config.configFile()) ? "" : io.c.faint("  (not created yet)"))],
    ["api_key", hasKey ? config.maskKey(cfg.api_key) : io.c.muted("(not set)")],
    ["base_url", cfg.base_url || io.c.muted("(default) " + config.DEFAULT_BASE)],
    ["default_bot", cfg.default_bot ? "#" + cfg.default_bot : io.c.muted("(none)")],
    ["saved_at", cfg.saved_at || io.c.muted("—")]
  ]));

  io.out("");
  io.out("  " + io.c.muted("Resolution order: --key  →  TBH_API_KEY  →  config file"));
  io.out("");
  io.out("  " + io.c.muted("Set with:  ") + "tbh config set api_key sk_…");
  io.out("  " + io.c.muted("           ") + "tbh config set default_bot 123456");
  io.out("");
}

async function setValue(ctx, name, value) {
  if (!name || value === undefined) {
    io.die("Usage: tbh config set <" + WRITABLE.join("|") + "> <value>");
  }

  const field = String(name).toLowerCase();
  if (WRITABLE.indexOf(field) < 0) {
    io.die('Unknown setting "' + name + '". Use one of: ' + WRITABLE.join(", "));
  }

  const cfg = config.load();

  if (field === "api_key") {
    const key = String(value).trim();
    if (!auth.looksLikeKey(key)) {
      io.warn("This does not look like a TeleBotHost key (expected sk_… or pub_…).");
    }

    const spin = io.spinner("Verifying key…");
    let data = null;
    try {
      data = await api.listBots(http.createClient({ key: key, base: ctx.base }));
      spin.succeed("Key verified");
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        spin.fail("Key rejected (HTTP " + e.status + ")");
        io.die("Not saved. Check the key and try again.");
      }
      spin.stop("Could not verify now — saving anyway", io.c.warn("▲"));
      io.note(e.message);
    }

    cfg.api_key = key;
    cfg.base_url = ctx.base;
    cfg.saved_at = new Date().toISOString();

    if (data && Array.isArray(data.bots) && data.bots.length === 1 && !cfg.default_bot) {
      cfg.default_bot = data.bots[0].bot_id;
      io.info("Default bot set to " + io.c.bold("#" + cfg.default_bot));
    }

    config.save(cfg);
    io.ok("api_key saved " + io.c.muted(config.maskKey(key)));
    return;
  }

  if (field === "base_url") {
    const url = String(value).trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^\s]+$/i.test(url)) io.die("base_url must start with http:// or https://");
    cfg.base_url = url;
    config.save(cfg);
    io.ok("base_url set to " + io.c.accent(url));
    return;
  }

  if (field === "default_bot") {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) io.die("default_bot must be a numeric bot id.");
    cfg.default_bot = n;
    config.save(cfg);
    io.ok("default_bot set to " + io.c.bold("#" + n));
  }
}

function getValue(ctx, name) {
  const cfg = config.load();
  const field = String(name || "").toLowerCase();
  if (!field) io.die("Usage: tbh config get <name>");

  if (field === "api_key") {
    if (!cfg.api_key) io.die("api_key is not set.");
    if (!ctx.flags.reveal) {
      io.die("Refusing to print a secret. Re-run with --reveal if you really need it.");
    }
    io.out(cfg.api_key);
    return;
  }

  if (WRITABLE.indexOf(field) < 0 && field !== "saved_at") {
    io.die('Unknown setting "' + name + '".');
  }

  const value = cfg[field];
  if (value === undefined || value === "") {
    io.die(field + " is not set.");
  }
  io.out(String(value));
}

function unset(ctx, name) {
  const field = String(name || "").toLowerCase();
  if (WRITABLE.indexOf(field) < 0) io.die("Usage: tbh config unset <" + WRITABLE.join("|") + ">");

  const cfg = config.load();
  if (!(field in cfg)) {
    io.info(field + " was not set.");
    return;
  }
  delete cfg[field];
  config.save(cfg);
  io.ok(field + " cleared.");
}

async function reset(ctx) {
  if (!ctx.flags.yes) {
    const go = await io.confirm("Delete " + config.configFile() + "?", false);
    if (!go) {
      io.info("Aborted.");
      return;
    }
  }
  const removed = config.clear();
  if (removed) io.ok("Configuration deleted.");
  else io.info("Nothing to delete.");
}

async function run(ctx, args) {
  const sub = String((args && args[0]) || "show").toLowerCase();

  switch (sub) {
    case "show":
    case "ls":
    case "list":
      return show(ctx);
    case "path":
      return io.out(config.configFile());
    case "get":
      return getValue(ctx, args[1]);
    case "set":
      return setValue(ctx, args[1], args.slice(2).join(" "));
    case "unset":
    case "rm":
    case "delete":
      return unset(ctx, args[1]);
    case "reset":
      return reset(ctx);
    default:
      io.die("Unknown config subcommand '" + sub + "' (use show | path | get | set | unset | reset)");
  }
}

module.exports = { run: run, show: show };

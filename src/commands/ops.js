"use strict";

const fs = require("fs");

const io = require("../io");
const config = require("../config");
const http = require("../http");
const api = require("../api");
const bots = require("./bots");

/* ------------------------------------------------------------------ */
/*  logs                                                               */
/* ------------------------------------------------------------------ */

async function logs(ctx) {
  const client = ctx.ensure();
  const botId = await bots.resolveBot(ctx);

  if (ctx.flags.clear) {
    if (!ctx.flags.yes) {
      const go = await io.confirm("Delete all logs for bot #" + botId + "?", false);
      if (!go) {
        io.info("Aborted.");
        return;
      }
    }
    await client.del("/bot/" + botId + "/logs");
    io.ok("Logs cleared for bot #" + botId + ".");
    return;
  }

  const spin = io.spinner("Fetching logs…");
  let data;
  try {
    data = await api.listLogs(client, botId);
  } catch (e) {
    spin.stop();
    throw e;
  }
  spin.stop();

  const all = data.logs || [];

  if (ctx.json) {
    io.out(JSON.stringify(all, null, 2));
    return;
  }

  if (!all.length) {
    io.out("");
    io.ok("No logs for bot #" + botId + " — that usually means no runtime errors.");
    io.out("");
    return;
  }

  const limit = Number(ctx.flags.limit || 20);
  const items = all.slice(0, limit);
  const errors = all.filter(function (l) { return String(l.type || "").toLowerCase() === "error"; }).length;

  io.out("");
  io.out("  " + io.c.brand("▌") + " " + io.c.bold("Logs") + "  " + io.c.accent("bot #" + botId) +
    io.c.faint("  " + all.length + " entries" + (errors ? " · " + errors + " errors" : "")));
  io.out("");

  items.forEach(function (l) {
    const type = String(l.type || "log").toLowerCase();
    const isError = type === "error";
    const label = isError ? io.c.bad(" ERROR ") : io.c.muted(" " + type.toUpperCase() + " ");
    const when = String(l.created_at || l.time || "").replace("T", " ").slice(0, 19);

    io.out("  " + label + "  " + io.c.bold(l.command || "—") + io.c.faint("  " + when));

    if (l.error_message) {
      String(l.error_message).split("\n").slice(0, 4).forEach(function (line) {
        io.out("           " + io.c.bad(line));
      });
    }
    if (l.stack && ctx.flags.verbose) {
      String(l.stack).split("\n").slice(0, 14).forEach(function (line) {
        io.out("           " + io.c.faint(line));
      });
    }
    io.out("");
  });

  io.note("Showing " + items.length + " of " + all.length +
    (all.length > items.length ? " · raise it with --limit " + all.length : "") +
    " · stacks with --verbose");
  io.out("");
}

/* ------------------------------------------------------------------ */
/*  analytics                                                          */
/* ------------------------------------------------------------------ */

async function analytics(ctx) {
  const client = ctx.ensure();
  const botId = await bots.resolveBot(ctx);

  const spin = io.spinner("Loading analytics…");
  let data;
  try {
    data = await api.analytics(client, botId);
  } catch (e) {
    spin.stop();
    throw e;
  }
  spin.stop();

  const stat = data.analytics || data;

  if (ctx.json) {
    io.out(JSON.stringify(stat, null, 2));
    return;
  }

  const pairs = Object.keys(stat)
    .filter(function (k) {
      return k !== "bot_id" && (stat[k] === null || typeof stat[k] !== "object");
    })
    .map(function (k) {
      const label = k.replace(/_/g, " ");
      const raw = stat[k];
      const value = typeof raw === "number" ? io.c.bold(String(raw)) : String(raw);
      return [label, value];
    });

  io.out("");
  io.out("  " + io.c.brand("▌") + " " + io.c.bold("Analytics") + "  " + io.c.accent("bot #" + botId));
  io.out("");

  if (pairs.length) {
    io.out(io.kv(pairs));
  } else {
    io.out("  " + io.c.muted("No counters reported yet."));
  }
  io.out("");
}

/* ------------------------------------------------------------------ */
/*  export                                                             */
/* ------------------------------------------------------------------ */

async function exportLink(ctx) {
  const client = ctx.ensure();
  const botId = await bots.resolveBot(ctx);

  const spin = io.spinner("Requesting export link…");
  let data;
  try {
    data = await api.exportLink(client, botId);
  } catch (e) {
    spin.stop();
    throw e;
  }
  spin.stop();

  io.out("");
  io.box("Export — bot #" + botId, [
    "",
    io.c.muted("url") + "      " + io.c.accent(data.download_url || "(none)"),
    io.c.muted("expires") + "  " + io.c.bold(String(data.expires_in_seconds || 0) + "s"),
    "",
    io.c.faint("Download it now — the link is single-use and short lived."),
    ""
  ]);
  io.out("");
}

/* ------------------------------------------------------------------ */
/*  env                                                                */
/* ------------------------------------------------------------------ */

function maskValue(value) {
  const v = String(value == null ? "" : value);
  if (!v) return io.c.faint("(empty)");
  if (v.length <= 6) return io.c.muted("••••");
  return io.c.muted(v.slice(0, 3) + "••••" + v.slice(-2));
}

async function env(ctx, args) {
  const sub = String((args && args[0]) || "ls").toLowerCase();
  const client = ctx.ensure();
  const botId = await bots.resolveBot(ctx);

  const listAll = async function () {
    const spin = io.spinner("Loading environment…");
    try {
      const data = await api.listEnvs(client, botId);
      spin.stop();
      return data.envs || [];
    } catch (e) {
      spin.stop();
      throw e;
    }
  };

  if (sub === "ls" || sub === "list") {
    const envs = await listAll();

    if (ctx.json) {
      io.out(JSON.stringify(envs, null, 2));
      return;
    }

    if (!envs.length) {
      io.out("");
      io.info("No environment variables on bot #" + botId + ".");
      io.out("");
      return;
    }

    const rows = envs.map(function (e) {
      return [io.c.faint(String(e.id)), io.c.bold(e.name), maskValue(e.value), io.c.muted(e.placeholder || "")];
    });

    io.out("");
    io.out("  " + io.c.brand("▌") + " " + io.c.bold("Environment") + "  " + io.c.accent("bot #" + botId));
    io.out("");
    io.out(io.table(["ID", "NAME", "VALUE", "PLACEHOLDER"], rows, {
      align: ["right", "left", "left", "left"]
    }));
    io.out("");
    io.note(envs.length + " variable(s) · values are masked");
    io.out("");
    return;
  }

  if (sub === "set") {
    const name = args[1];
    const value = args.slice(2).join(" ");
    if (!name || !value) io.die("Usage: tbh env set NAME VALUE");

    const envs = await listAll();
    const found = envs.filter(function (e) { return e.name === name; })[0];

    const spin = io.spinner((found ? "Updating " : "Creating ") + name + "…");
    try {
      if (found) {
        await api.updateEnv(client, botId, found.id, { name: name, value: value });
        spin.succeed("Updated " + io.c.bold(name) + io.c.faint("  #" + found.id));
      } else {
        const res = await api.createEnv(client, botId, { name: name, value: value });
        const id = res.env && res.env.id ? io.c.faint("  #" + res.env.id) : "";
        spin.succeed("Created " + io.c.bold(name) + id);
      }
    } catch (e) {
      spin.stop();
      throw e;
    }
    return;
  }

  if (sub === "rm" || sub === "del" || sub === "delete") {
    const name = args[1];
    if (!name) io.die("Usage: tbh env rm NAME");

    const envs = await listAll();
    const found = envs.filter(function (e) { return e.name === name; })[0];
    if (!found) io.die("No env variable named " + name + ".");

    if (!ctx.flags.yes) {
      const go = await io.confirm("Delete env " + io.c.bold(name) + " (#" + found.id + ")?", false);
      if (!go) {
        io.info("Aborted.");
        return;
      }
    }

    await client.del("/bot/" + botId + "/envs/" + found.id);
    io.ok("Deleted " + name + ".");
    return;
  }

  io.die("Unknown env subcommand: " + sub + " (use ls | set | rm)");
}

/* ------------------------------------------------------------------ */
/*  doctor                                                             */
/* ------------------------------------------------------------------ */

async function doctor(ctx) {
  const checks = [];
  const add = function (label, value, passed, hint) {
    checks.push({ label: label, value: value, passed: passed, hint: hint || "" });
  };

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("node", process.version, nodeMajor >= 18, "upgrade to Node 18+");

  const hasFetch = typeof globalThis.fetch === "function";
  add("fetch", hasFetch ? "available" : "missing", hasFetch, "Node 18+ ships fetch");

  add("api key", ctx.key ? config.maskKey(ctx.key) : "not set", !!ctx.key, "run `tbh login`");
  add("config", fs.existsSync(config.configFile()) ? config.configFile() : "not created yet", true);
  add("base url", ctx.base, /^https?:\/\//.test(ctx.base));

  let proj = null;
  try {
    /* Same resolution as deploy: --dir, then upward search, then `tbh link`. */
    proj = require("./commands").loadProjectForCtx(ctx);
    add("project", proj.root, true);
    add("commands", proj.entries.length + " in manifest", proj.entries.length > 0);
  } catch (e) {
    add("project", "not found", false, "run inside a project or use `tbh link <path>`");
  }

  if (ctx.key) {
    const spin = io.spinner("Checking connectivity…");
    try {
      const res = await ctx.ensure().get("/bot");
      const data = res.data || {};
      spin.stop();
      add("api", "reachable", true);
      add("bots", (data.bots || []).length + " on this account", true);

      const rate = http.rateInfo(res.headers);
      if (rate && rate.dailyRemaining != null) {
        add("quota", rate.dailyRemaining + " / " + (rate.dailyLimit || "?") + " left today", true);
      }
    } catch (e) {
      spin.stop();
      add("api", e.status ? "HTTP " + e.status : "unreachable", false,
        e.status ? e.message : "check your connection or proxy");
    }
  }

  io.out("");
  io.out("  " + io.c.brand("▌") + " " + io.c.bold("Doctor"));
  io.out("");

  const width = Math.max.apply(null, checks.map(function (r) { return r.label.length; }));
  checks.forEach(function (row) {
    const mark = row.passed ? io.c.ok("✔") : io.c.bad("✖");
    const value = row.passed ? io.c.muted(row.value) : io.c.bad(row.value);
    io.out("  " + mark + "  " + io.c.bold(io.pad(row.label, width)) + "  " + value);
    if (!row.passed && row.hint) {
      io.out("     " + io.c.faint(" ".repeat(width)) + "  " + io.c.faint(row.hint));
    }
  });

  io.out("");

  const failed = checks.filter(function (r) { return !r.passed; });
  if (failed.length) {
    io.out("");
    io.err(failed.length + " check(s) failed — fix the items marked ✖ above.");
    io.out("");
    const err = new Error(failed.length + " check(s) failed");
    err.silent = true;
    err.exitCode = 1;
    throw err;
  }

  io.ok("All checks passed — you are ready to deploy.");
  io.out("");
}

module.exports = {
  logs: logs,
  analytics: analytics,
  exportLink: exportLink,
  env: env,
  doctor: doctor
};

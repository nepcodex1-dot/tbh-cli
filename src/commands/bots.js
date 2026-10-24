"use strict";

const io = require("../io");
const config = require("../config");
const api = require("../api");

function statusLabel(status) {
  if (status === 1) return io.c.ok("● online");
  if (status === 0) return io.c.muted("○ stopped");
  return io.c.faint(String(status == null ? "?" : status));
}

async function list(ctx) {
  const spin = io.spinner("Fetching bots…");
  let data;
  try {
    data = await api.listBots(ctx.ensure());
  } catch (e) {
    spin.stop();
    throw e;
  }
  spin.stop();

  const bots = data.bots || [];

  if (ctx.json) {
    io.out(JSON.stringify(data, null, 2));
    return;
  }

  if (!bots.length) {
    io.out("");
    io.warn("No bots on this account.");
    io.note("Create one in the console, then run `tbh bots` again.");
    io.out("");
    return;
  }

  const limitRaw = ctx.flags.limit;
  const limit = limitRaw === undefined ? 25 : Number(limitRaw);
  const shown = limit > 0 ? bots.slice(0, limit) : bots;

  const rows = shown.map(function (b) {
    const isDefault = ctx.cfg && Number(ctx.cfg.default_bot) === Number(b.bot_id);
    let name = String(b.name || "?");
    if (name.length > 40) name = name.slice(0, 39) + "…";

    return [
      (b.pin ? io.c.warn("★") : " ") + " " + io.c.faint(String(b.bot_id)),
      (isDefault ? io.c.brand("▸ ") : "  ") + io.c.bold(name),
      b.bot_username ? io.c.accent("@" + b.bot_username) : io.c.faint("@?"),
      statusLabel(b.status),
      io.c.muted(String(b.commands_count == null ? "–" : b.commands_count))
    ];
  });

  const online = bots.filter(function (b) { return b.status === 1; }).length;

  io.out("");
  io.out("  " + io.c.brand("▌") + " " + io.c.bold("Your bots"));
  io.out("");
  io.out(io.table(["", "NAME", "USERNAME", "STATUS", "CMDS"], rows, {
    align: ["right", "left", "left", "left", "right"]
  }));
  io.out("");
  io.note(shown.length + " of " + bots.length + " bot(s) · " + online + " online" +
    (shown.length < bots.length ? "  ·  --limit 0 for all" : ""));

  if (data.stats) {
    io.out(io.kv([
      ["public store", String(data.stats.public_store || 0)],
      ["transferred", String(data.stats.transferred || 0)]
    ]));
  }

  if (!ctx.cfg || !ctx.cfg.default_bot) {
    io.out("");
    io.note("Select one with `tbh use <id>` — it is remembered for later commands.");
  }
  io.out("");
}

async function use(ctx, target) {
  if (!target) {
    const current = ctx.botId || (ctx.cfg && ctx.cfg.default_bot);
    if (current) {
      io.out("");
      io.info("Default bot: " + io.c.bold("#" + current));
      io.note("Change it with `tbh use <id|@username>`; override one call with `--bot <id>`.");
      io.out("");
      return;
    }
    io.die("Usage: tbh use <bot_id|@username>");
  }

  const data = await api.listBots(ctx.ensure());
  const bots = data.bots || [];
  const needle = String(target).replace(/^@/, "").toLowerCase();

  const found = bots.filter(function (b) {
    return String(b.bot_id) === String(target) ||
      String(b.bot_username || "").toLowerCase() === needle;
  })[0];

  if (!found) io.die("No bot matching " + target + " on this account.");

  const cfg = config.load();
  cfg.default_bot = found.bot_id;
  config.save(cfg);

  io.ok("Default bot: #" + found.bot_id + " (" + found.name + ")");
}

async function resolveBot(ctx) {
  if (ctx.botId) return ctx.botId;

  const data = await api.listBots(ctx.ensure());
  const bots = data.bots || [];

  if (!bots.length) io.die("No bots on this account. Add one in the console first.");

  if (bots.length === 1) {
    ctx.botId = bots[0].bot_id;
    io.info("Using bot #" + bots[0].bot_id + " (" + bots[0].name + ")");
    return ctx.botId;
  }

  const picked = await io.choose(bots, {
    message: "Select a bot: ",
    label: function (b) {
      return b.name + "  @" + (b.bot_username || "?") + "  #" + b.bot_id;
    }
  });

  ctx.botId = picked.bot_id;

  const cfg = config.load();
  cfg.default_bot = picked.bot_id;
  config.save(cfg);
  io.info("Default bot set to #" + picked.bot_id + " (change with `tbh use`)");

  return ctx.botId;
}

async function status(ctx) {
  const client = ctx.ensure();
  const botId = await resolveBot(ctx);

  const spin = io.spinner("Reading bot #" + botId + "…");
  let data;
  try {
    data = await api.getBot(client, botId);
  } catch (e) {
    spin.stop();
    throw e;
  }
  spin.stop();

  const bot = data.bot || {};

  if (ctx.json) {
    io.out(JSON.stringify(bot, null, 2));
    return;
  }

  io.out("");
  io.out("  " + io.c.brand("▌") + " " + io.c.bold(bot.bot_name || bot.name || "Bot") + "  " +
    io.c.accent("#" + botId));
  io.out("");
  io.out(io.kv([
    ["username", bot.bot_username ? io.c.accent("@" + bot.bot_username) : io.c.muted("—")],
    ["status", statusLabel(bot.status)],
    ["commands", io.c.bold(String(bot.commands_count == null ? "?" : bot.commands_count))],
    ["created", io.c.muted(String(bot.created_at || "?"))],
    ["last started", io.c.muted(String(bot.last_started || "never"))],
    ["tbl", io.c.muted(String(bot.tbl_var || "—"))]
  ]));
  io.out("");
}

async function setStatus(ctx, value) {
  const client = ctx.ensure();
  const botId = await resolveBot(ctx);

  const spin = io.spinner((value === 1 ? "Launching" : "Stopping") + " bot #" + botId + "…");
  try {
    await api.updateBot(client, botId, { status: value });
  } catch (e) {
    spin.stop();
    throw e;
  }
  spin.succeed((value === 1 ? "Launch requested" : "Stop requested") + " for bot #" + botId);

  io.out("");
  io.note("Verify with `tbh status`");
  if (value === 1) io.note("Tail the runtime with `tbh logs`");
  io.out("");
}

module.exports = {
  list: list,
  use: use,
  resolveBot: resolveBot,
  status: status,
  setStatus: setStatus
};

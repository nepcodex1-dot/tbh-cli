"use strict";

/*
 * Local web UI for tbh-cli.
 *
 * Binds to 127.0.0.1 only, and every /api call must carry the session token
 * printed in the URL, so another page in your browser cannot drive it.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const config = require("../config");
const tbhHttp = require("../http");
const api = require("../api");
const project = require("../project");
const wait = require("../wait");

const INDEX = path.join(__dirname, "index.html");
const MAX_BODY = 2 * 1024 * 1024;

/* Where the project picker scans for manifest.json files. */
let scanRoot = process.cwd();

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function clientFor() {
  const cfg = config.load();
  if (!cfg.api_key) {
    const e = new Error("Not signed in. Add your API key first.");
    e.status = 401;
    throw e;
  }
  return tbhHttp.createClient({ key: cfg.api_key, base: cfg.base_url || config.DEFAULT_BASE });
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];

    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

/* Find folders that contain a manifest.json, close to where we were started. */
function discoverProjects(startDir) {  const found = [];
  const seen = new Set();

  const add = function (dir) {
    const abs = path.resolve(dir);
    if (seen.has(abs)) return;
    const manifest = path.join(abs, "manifest.json");
    if (!fs.existsSync(manifest)) return;
    seen.add(abs);

    try {
      const proj = project.loadProject(abs);
      found.push({
        name: path.basename(abs),
        dir: abs,
        commands: proj.entries.length
      });
    } catch (e) {
      /* broken manifest — skip it in the picker */
    }
  };

  add(startDir);

  const scan = function (dir, depth) {
    if (depth < 0) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) continue;
      const child = path.join(dir, entry.name);
      add(child);
      scan(child, depth - 1);
    }
  };

  /* siblings of the start dir + one level below each */
  scan(startDir, 2);
  try {
    scan(path.dirname(startDir), 1);
  } catch (e) {
    /* ignore */
  }

  return found;
}

/* The API returns bot_token inside bot objects — never let it reach the browser. */
const SECRET_FIELDS = ["bot_token", "botToken", "webhook_secret", "secret", "api_key"];

function sanitizeBot(bot) {
  if (!bot || typeof bot !== "object") return bot;
  const copy = Object.assign({}, bot);
  SECRET_FIELDS.forEach(function (k) { delete copy[k]; });
  return copy;
}

async function planFor(dir, botId, client) {
  const proj = project.loadProject(dir);
  const apiClient = client || clientFor();
  const remote = await api.listCommands(apiClient, botId);

  const plan = project.buildPlan(proj.entries, remote.commands || []);
  const existingFolders = new Set((remote.folders || []).map(function (f) { return f.name; }));
  const missingFolders = [];

  proj.entries.forEach(function (e) {
    if (e.folder && !existingFolders.has(e.folder) && missingFolders.indexOf(e.folder) < 0) {
      missingFolders.push(e.folder);
    }
  });

  return { proj: proj, client: apiClient, plan: plan, missingFolders: missingFolders };
}

/* A freshly created bot can take a moment before its command list is readable. */
async function waitForBot(client, botId, baseDelay) {
  return wait.untilReady(client, botId, { delay: baseDelay === undefined ? 700 : baseDelay });
}

/* Apply a plan. Shared by /deploy and by "create bot, then load the project". */
async function applyPlan(client, id, proj, plan, missingFolders, delay) {
  const wait = delay === undefined ? 120 : delay;
  const log = [];
  const failures = [];

  for (const name of missingFolders) {
    try {
      await api.createFolder(client, id, name);
      log.push({ kind: "folder", text: name });
    } catch (e) {
      if (e.status !== 400 && e.status !== 409) throw e;
    }
  }

  for (const item of plan.creates) {
    try {
      await api.createCommand(client, id, item.payloadCreate || item.payload);
      log.push({ kind: "create", text: item.entry.name });
    } catch (e) {
      failures.push({ name: item.entry.name, error: e.message });
      log.push({ kind: "error", text: item.entry.name + " — " + e.message });
    }
    await tbhHttp.sleep(wait);
  }

  for (const item of plan.updates) {
    try {
      await api.updateCommand(client, id, item.remote.id, item.payload);
      log.push({ kind: "update", text: item.entry.name + " (" + item.changed.join(", ") + ")" });
    } catch (e) {
      failures.push({ name: item.entry.name, error: e.message });
      log.push({ kind: "error", text: item.entry.name + " — " + e.message });
    }
    await tbhHttp.sleep(wait);
  }

  return { log: log, failures: failures, applied: log.length };
}

/* The only project we know about, when the caller did not name one. */
function defaultProjectDir() {
  const found = discoverProjects(scanRoot);
  return found.length === 1 ? found[0].dir : "";
}

/* Only the fields the API accepts — never forward arbitrary JSON. */
function commandPayload(body, isCreate) {
  const out = {};

  if (typeof body.name === "string" && body.name.trim()) out.name = body.name.trim();
  if (typeof body.code === "string") out.code = body.code;
  if (typeof body.answer === "string") out.answer = body.answer;
  if (typeof body.keyboard === "string") out.keyboard = body.keyboard;
  if (typeof body.parse_mode === "string") out.parse_mode = body.parse_mode;
  if (Array.isArray(body.aliases)) {
    out.aliases = body.aliases.map(String).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 50);
  }
  if (typeof body.allow_only_group === "boolean") out.allow_only_group = body.allow_only_group;
  if (typeof body.need_reply === "boolean") out.need_reply = body.need_reply;
  if (typeof body.case_insensitive === "boolean") out.case_insensitive = body.case_insensitive;
  if (body.is_web === 0 || body.is_web === 1) out.is_web = body.is_web;

  if (body.folder === null) out.folder = null;
  else if (typeof body.folder === "string") out.folder = body.folder.trim() || null;

  if (isCreate) {
    if (out.code === undefined) out.code = "";
    if (out.answer === undefined) out.answer = "";
    if (out.keyboard === undefined) out.keyboard = "";
    if (out.parse_mode === undefined) out.parse_mode = "";
    if (out.aliases === undefined) out.aliases = [];
    if (out.allow_only_group === undefined) out.allow_only_group = false;
    if (out.need_reply === undefined) out.need_reply = false;
    if (out.case_insensitive === undefined) out.case_insensitive = false;
    if (out.is_web === undefined) out.is_web = 0;
  }

  return out;
}

/* Folders must exist before a command can point at them. */
async function ensureFolder(client, botId, folder) {
  if (!folder) return;
  try {
    await api.createFolder(client, botId, folder);
  } catch (e) {
    if (e.status !== 400 && e.status !== 409) throw e;
  }
}

/* ------------------------------------------------------------------ */
/*  routes                                                             */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url, body) {
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const route = parts.join("/");
  const botId = parts[0] === "bot" ? Number(parts[1]) : null;

  /* ---- state ---- */
  if (route === "state") {
    const cfg = config.load();
    return send(res, 200, {
      ok: true,
      hasKey: !!cfg.api_key,
      keyMask: cfg.api_key ? config.maskKey(cfg.api_key) : "",
      base: cfg.base_url || config.DEFAULT_BASE,
      defaultBot: cfg.default_bot || null,
      readOnly: cfg.api_key ? cfg.api_key.indexOf("pub_") === 0 : false,
      projects: discoverProjects(scanRoot)
    });
  }

  /* ---- auth ---- */
  if (route === "login") {
    const key = String(body.key || "").trim();
    if (!key) return send(res, 400, { ok: false, error: "Paste an API key first." });

    const client = tbhHttp.createClient({ key: key, base: config.load().base_url || config.DEFAULT_BASE });
    let data;
    try {
      data = await api.listBots(client);
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        return send(res, 401, { ok: false, error: "Key rejected by TeleBotHost." });
      }
      return send(res, 502, { ok: false, error: e.message });
    }

    const cfg = config.load();
    cfg.api_key = key;
    cfg.base_url = cfg.base_url || config.DEFAULT_BASE;
    cfg.saved_at = new Date().toISOString();

    const bots = data.bots || [];
    if (!cfg.default_bot && bots.length === 1) cfg.default_bot = bots[0].bot_id;
    config.save(cfg);

    return send(res, 200, {
      ok: true,
      keyMask: config.maskKey(key),
      bots: bots.length,
      readOnly: key.indexOf("pub_") === 0
    });
  }

  if (route === "logout") {
    config.clear();
    return send(res, 200, { ok: true });
  }

  /* ---- bots ---- */
  if (route === "bots" && req.method === "GET") {
    const data = await api.listBots(clientFor());
    return send(res, 200, { ok: true, bots: (data.bots || []).map(sanitizeBot), stats: data.stats || null });
  }

  if (route === "bots" && req.method === "POST") {
    const token = String(body.token || "").trim();
    if (!/^\d+:[\w-]{20,}$/.test(token)) {
      return send(res, 400, { ok: false, error: "That does not look like a BotFather token (123456:ABC…)." });
    }

    const client = clientFor();
    const data = await api.createBot(client, {
      bot_token: token,
      bot_name: body.name || undefined,
      run_now: !!body.runNow
    });

    const created = sanitizeBot(data.bot || data);
    const newId = Number(created.bot_id || created.id || 0);
    const dir = String(body.dir || "") || defaultProjectDir();

    /* Remember it straight away, so the console opens on the new bot. */
    if (newId) {
      const cfg = config.load();
      cfg.default_bot = newId;
      config.save(cfg);
    }

    /* "Create the bot and load my commands into it" — one click. */
    let deploy = null;
    if (newId && body.deploy !== false && dir) {
      try {
        await waitForBot(client, newId);
        const { proj, plan, missingFolders } = await planFor(dir, newId, client);
        const result = await applyPlan(client, newId, proj, plan, missingFolders);
        deploy = {
          ok: result.failures.length === 0,
          applied: result.applied,
          total: proj.entries.length,
          failures: result.failures,
          log: result.log,
          project: proj.root
        };
      } catch (e) {
        deploy = {
          ok: false,
          applied: 0,
          failures: [{ name: "project", error: e.message }],
          log: [{ kind: "error", text: "could not load the project — " + e.message }],
          project: dir
        };
      }
    }

    return send(res, 200, { ok: true, bot: created, deploy: deploy });
  }

  if (route === "use") {
    const id = Number(body.botId);
    if (!id) return send(res, 400, { ok: false, error: "botId is required." });
    const cfg = config.load();
    cfg.default_bot = id;
    config.save(cfg);
    return send(res, 200, { ok: true, botId: id });
  }

  /* ---- per bot ---- */
  if (botId) {
    const client = clientFor();
    const sub = parts.slice(2).join("/");

    if (sub === "" && req.method === "GET") {
      const data = await api.getBot(client, botId);
      return send(res, 200, { ok: true, bot: sanitizeBot(data.bot || {}) });
    }

    /* Rename / pin the bot. */
    if (sub === "" && req.method === "PATCH") {
      const patch = {};
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
      if (typeof body.pin === "boolean") patch.pin = body.pin;
      if (!Object.keys(patch).length) return send(res, 400, { ok: false, error: "Nothing to update." });

      const data = await api.updateBot(client, botId, patch);
      return send(res, 200, { ok: true, bot: sanitizeBot(data.bot || data) });
    }

    /* Delete the bot itself. */
    if (sub === "" && req.method === "DELETE") {
      await api.deleteBot(client, botId);

      const cfg = config.load();
      if (Number(cfg.default_bot) === botId) {
        cfg.default_bot = null;
        config.save(cfg);
      }

      return send(res, 200, { ok: true, deleted: botId });
    }

    if (sub === "start") {
      await api.updateBot(client, botId, { status: 1 });
      return send(res, 200, { ok: true });
    }

    if (sub === "stop") {
      await api.updateBot(client, botId, { status: 0 });
      return send(res, 200, { ok: true });
    }

    /* Command collection: list, create, bulk delete. */
    if (sub === "commands" && req.method === "GET") {
      const data = await api.listCommands(client, botId);
      return send(res, 200, {
        ok: true,
        commands: data.commands || [],
        folders: data.folders || []
      });
    }

    if (sub === "commands" && req.method === "POST") {
      const payload = commandPayload(body, true);
      if (!payload.name) return send(res, 400, { ok: false, error: "A command name is required." });

      await ensureFolder(client, botId, payload.folder);

      const data = await api.createCommand(client, botId, payload);
      return send(res, 200, { ok: true, command: data.command || data });
    }

    if (sub === "commands" && req.method === "DELETE") {
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
      if (!ids.length) return send(res, 400, { ok: false, error: "No command ids given." });

      await api.deleteCommands(client, botId, ids);
      return send(res, 200, { ok: true, deleted: ids.length });
    }

    /* One command: read / write the code, delete it. */
    if (sub.indexOf("command/") === 0) {
      const commandId = Number(parts[3]);
      if (!commandId) return send(res, 400, { ok: false, error: "A command id is required." });

      if (req.method === "GET") {
        const data = await api.getCommand(client, botId, commandId);
        return send(res, 200, { ok: true, command: data.command || data });
      }

      if (req.method === "PATCH") {
        const payload = commandPayload(body, false);
        if (!Object.keys(payload).length) return send(res, 400, { ok: false, error: "Nothing to save." });

        await ensureFolder(client, botId, payload.folder);

        const data = await api.updateCommand(client, botId, commandId, payload);
        return send(res, 200, { ok: true, command: data.command || data });
      }

      if (req.method === "DELETE") {
        await api.deleteCommand(client, botId, commandId);
        return send(res, 200, { ok: true, deleted: commandId });
      }
    }

    if (sub === "logs") {
      if (req.method === "DELETE") {
        await api.clearLogs(client, botId);
        return send(res, 200, { ok: true });
      }
      const data = await api.listLogs(client, botId);
      return send(res, 200, { ok: true, logs: data.logs || [] });
    }

    if (sub === "analytics") {
      const data = await api.analytics(client, botId);
      return send(res, 200, { ok: true, analytics: data.analytics || data });
    }
  }

  /* ---- deploy ---- */
  if (route === "plan") {
    const dir = String(body.dir || "");
    const id = Number(body.botId);
    if (!dir || !id) return send(res, 400, { ok: false, error: "dir and botId are required." });

    const { proj, plan, missingFolders } = await planFor(dir, id);

    return send(res, 200, {
      ok: true,
      project: proj.root,
      total: proj.entries.length,
      creates: plan.creates.map(function (i) { return i.entry.name; }),
      updates: plan.updates.map(function (i) { return { name: i.entry.name, fields: i.changed }; }),
      same: plan.same.length,
      folders: missingFolders,
      extra: plan.extra.map(function (c) { return c.name; })
    });
  }

  if (route === "deploy") {
    const dir = String(body.dir || "");
    const id = Number(body.botId);
    if (!dir || !id) return send(res, 400, { ok: false, error: "dir and botId are required." });

    const { proj, client, plan, missingFolders } = await planFor(dir, id);
    const dryRun = !!body.dryRun;

    if (dryRun) {
      return send(res, 200, {
        ok: true,
        dryRun: true,
        applied: 0,
        log: [],
        creates: plan.creates.length,
        updates: plan.updates.length,
        folders: missingFolders
      });
    }

    const result = await applyPlan(client, id, proj, plan, missingFolders);

    return send(res, 200, {
      ok: result.failures.length === 0,
      applied: result.applied,
      failures: result.failures,
      log: result.log,
      total: proj.entries.length
    });
  }

  return send(res, 404, { ok: false, error: "Unknown endpoint: " + route });
}

/* ------------------------------------------------------------------ */
/*  server                                                             */
/* ------------------------------------------------------------------ */

function start(options) {
  const opts = options || {};
  if (opts.dir && typeof opts.dir === "string") scanRoot = path.resolve(opts.dir);

  const token = crypto.randomBytes(18).toString("hex");
  const host = "127.0.0.1";

  const server = http.createServer(function (req, res) {
    const url = new URL(req.url, "http://" + host);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      fs.readFile(INDEX, function (err, buf) {
        if (err) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("UI files missing: " + err.message);
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        });
        res.end(buf);
      });
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    /* token gate for everything under /api */
    const supplied = req.headers["x-tbh-token"] || url.searchParams.get("t");
    if (supplied !== token) {
      send(res, 403, { ok: false, error: "Bad or missing session token. Reload the URL printed in the terminal." });
      return;
    }

    const run = async function () {
      let body = {};
      if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
        body = await readBody(req);
      }
      await handleApi(req, res, url, body);
    };

    run().catch(function (e) {
      if (e.status === 401) {
        send(res, 401, { ok: false, error: e.message });
        return;
      }
      send(res, e.status || 500, {
        ok: false,
        error: e.message || "Request failed",
        hint: e.data && e.data.hint ? e.data.hint : undefined
      });
    });
  });

  return new Promise(function (resolve, reject) {
    const desired = opts.port === undefined || opts.port === null ? 7420 : Number(opts.port);
    if (!Number.isInteger(desired) || desired < 0 || desired > 65535) {
      reject(new Error("Invalid port: " + opts.port));
      return;
    }

    const listen = function (port, isFallback) {
      server.once("error", function (err) {
        if (err.code === "EADDRINUSE" && !isFallback) {
          listen(0, true);
          return;
        }
        reject(err);
      });

      server.listen(port, host, function () {
        const actual = server.address().port;
        resolve({
          server: server,
          port: actual,
          token: token,
          url: "http://" + host + ":" + actual + "/?t=" + token,
          close: function () {
            return new Promise(function (r) { server.close(r); });
          }
        });
      });
    };

    listen(desired, false);
  });
}

module.exports = {
  start: start,
  sanitizeBot: sanitizeBot,
  applyPlan: applyPlan,
  waitForBot: waitForBot,
  commandPayload: commandPayload,
  ensureFolder: ensureFolder
};

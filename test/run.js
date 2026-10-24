"use strict";

// Offline test suite - no network, no real API key needed.
// Run: cd tbh-cli && npm test

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tbh-cli-test-"));
process.env.TBH_CONFIG_DIR = path.join(TMP, "config");
process.env.TBH_QUIET = "1";

const config = require("../src/config");
const project = require("../src/project");
const { parseArgs } = require("../src/cli");
const { deploy, pull } = require("../src/commands/commands");

const MOVIE_BOT = path.resolve(__dirname, "..", "..", "movie-bot");

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write("  PASS  " + name + "\n");
  } catch (e) {
    failed++;
    failures.push({ name: name, error: e });
    process.stdout.write("  FAIL  " + name + "\n        " + (e && e.message) + "\n");
  }
}

function fakeClient() {
  let nextId = 1;
  const store = new Map();
  const folders = new Map();
  const calls = [];
  const headers = new Headers({
    "x-ratelimit-remaining": "900",
    "x-ratelimit-limit": "1000"
  });

  function fail(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
  }

  return {
    calls: calls,
    store: store,
    folders: folders,
    async get(p) {
      calls.push({ method: "GET", path: p });
      if (p === "/bot") {
        return { data: { success: true, bots: [{ bot_id: 42, name: "Test Bot", bot_username: "test_bot", status: 1 }] }, headers: headers, status: 200 };
      }
      if (/^\/bot\/\d+\/commands$/.test(p)) {
        return {
          data: { success: true, commands: Array.from(store.values()), folders: Array.from(folders.values()) },
          headers: headers,
          status: 200
        };
      }
      throw new Error("unexpected GET " + p);
    },
    async post(p, body) {
      calls.push({ method: "POST", path: p, body: body });
      if (p === "/bot") {
        return {
          data: {
            success: true,
            bot: { bot_id: 77, name: "New Bot", bot_username: "new_bot", status: 0, commands_count: 0 }
          },
          headers: headers,
          status: 201
        };
      }
      if (/\/commands\/folders$/.test(p)) {
        if (folders.has(body.name)) throw fail(400, "Folder already exists");
        const folder = { id: nextId++, name: body.name };
        folders.set(body.name, folder);
        return { data: { success: true, folder: folder }, headers: headers, status: 201 };
      }
      if (/\/commands$/.test(p)) {
        if (store.has(body.name)) throw fail(400, "Command already exists");
        const command = Object.assign({ id: nextId++ }, body);
        store.set(command.name, command);
        return { data: { success: true, command: command }, headers: headers, status: 201 };
      }
      throw new Error("unexpected POST " + p);
    },
    async patch(p, body) {
      calls.push({ method: "PATCH", path: p, body: body });
      if (/^\/bot\/\d+$/.test(p)) {
        return { data: { success: true, bot: { bot_id: Number(p.split("/").pop()), status: body.status } }, headers: headers, status: 200 };
      }
      const m = p.match(/\/commands\/(\d+)$/);
      if (!m) throw new Error("unexpected PATCH " + p);
      const id = Number(m[1]);
      const command = Array.from(store.values()).filter(function (c) { return c.id === id; })[0];
      if (!command) throw fail(404, "not found");
      Object.assign(command, body);
      return { data: { success: true, command: command }, headers: headers, status: 200 };
    },
    async del(p, body) {
      calls.push({ method: "DELETE", path: p, body: body });
      return { data: { success: true }, headers: headers, status: 200 };
    }
  };
}

function makeCtx(client, extra) {
  const flags = Object.assign({ yes: true, delay: 0, dir: MOVIE_BOT }, extra || {});
  return {
    flags: flags,
    cfg: {},
    key: "sk_test_key",
    base: "http://fake",
    botId: 42,
    client: client,
    json: false,
    ensure: function () { return client; }
  };
}

function countWrites(client) {
  return client.calls.filter(function (c) { return c.method !== "GET"; }).length;
}

/* A tiny valid project: one command, no folders. */
function makeTempProject(name) {
  const root = path.join(TMP, name);
  fs.mkdirSync(path.join(root, "commands"), { recursive: true });
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({
    bot: name,
    commands: [
      { name: "/start", code_file: "commands/start.js" }
    ]
  }, null, 2));
  fs.writeFileSync(path.join(root, "commands", "start.js"), "Bot.sendMessage('hello from " + name + "');\n");
  return root;
}

async function main() {
  process.stdout.write("\ntbh-cli tests\n\n");

  await test("config: save, load, mask", function () {
    const file = config.save({ api_key: "sk_abcdef1234567890", default_bot: 42 });
    assert.ok(fs.existsSync(file));
    const loaded = config.load();
    assert.strictEqual(loaded.api_key, "sk_abcdef1234567890");
    assert.strictEqual(loaded.default_bot, 42);
    assert.strictEqual(config.maskKey("sk_abcdef1234567890"), "sk_abc…7890");
  });

  await test("project: loads movie-bot manifest and 13 command files", function () {
    const proj = project.loadProject(MOVIE_BOT);
    assert.strictEqual(proj.entries.length, 13);
    assert.strictEqual(proj.entries[0].name, "/lib_db");
    proj.entries.forEach(function (e) {
      assert.ok(e.code.length > 0, e.name + " has empty code");
    });
  });

  await test("project: plan against an empty bot creates all 13", function () {
    const proj = project.loadProject(MOVIE_BOT);
    const plan = project.buildPlan(proj.entries, []);
    assert.strictEqual(plan.creates.length, 13);
    assert.strictEqual(plan.updates.length, 0);
    assert.strictEqual(plan.same.length, 0);
  });

  await test("project: identical remote produces no changes", function () {
    const proj = project.loadProject(MOVIE_BOT);
    const remote = proj.entries.map(function (e, i) {
      return Object.assign({ id: i + 1 }, project.payloadFor(e, { forUpdate: true }));
    });
    const plan = project.buildPlan(proj.entries, remote);
    assert.strictEqual(plan.creates.length, 0);
    assert.strictEqual(plan.updates.length, 0);
    assert.strictEqual(plan.same.length, 13);
  });

  await test("project: changed code is detected as a single update", function () {
    const proj = project.loadProject(MOVIE_BOT);
    const remote = proj.entries.map(function (e, i) {
      return Object.assign({ id: i + 1 }, project.payloadFor(e, { forUpdate: true }));
    });
    remote[0].code = remote[0].code + "\n// drift";
    const plan = project.buildPlan(proj.entries, remote);
    assert.strictEqual(plan.updates.length, 1);
    assert.deepStrictEqual(plan.updates[0].changed, ["code"]);
    assert.strictEqual(plan.updates[0].remote.id, 1);
  });

  await test("project: crlf vs lf is not a change", function () {
    const proj = project.loadProject(MOVIE_BOT);
    const remote = proj.entries.map(function (e, i) {
      return Object.assign({ id: i + 1 }, project.payloadFor(e, { forUpdate: true }));
    });
    remote.forEach(function (c) { c.code = String(c.code).replace(/\n/g, "\r\n"); });
    const plan = project.buildPlan(proj.entries, remote);
    assert.strictEqual(plan.updates.length, 0);
    assert.strictEqual(plan.same.length, 13);
  });

  await test("project: slug mapping for special commands", function () {
    assert.strictEqual(project.slugFor("/lib_db"), "lib_db");
    assert.strictEqual(project.slugFor("*"), "star");
    assert.strictEqual(project.slugFor("!"), "bang");
    assert.strictEqual(project.slugFor("/handle_callback_query"), "handle_callback_query");
  });

  await test("cli: parses flags, --key=value and positional args", function () {
    const a = parseArgs(["deploy", "--dir", "movie-bot", "--bot=42", "--dry-run", "--only", "/start,/admin"]);
    assert.strictEqual(a.positional[0], "deploy");
    assert.strictEqual(a.flags.dir, "movie-bot");
    assert.strictEqual(a.flags.bot, "42");
    assert.strictEqual(a.flags["dry-run"], true);
    assert.strictEqual(a.flags.only, "/start,/admin");
  });

  await test("cli: --id is an alias for --bot", function () {
    const a = parseArgs(["deploy", "--id", "250188370222056"]);
    assert.strictEqual(a.flags.bot, "250188370222056");
    assert.strictEqual(a.positional.length, 1, "the id must not be read as the project dir");
  });

  await test("io: banner renders the TBH art and a subtitle", function () {
    const io = require("../src/io");
    const chunks = [];
    const origWrite = process.stdout.write;
    const origQuiet = process.env.TBH_QUIET;

    delete process.env.TBH_QUIET;
    io.setColor(false);
    process.stdout.write = function (s) { chunks.push(String(s)); return true; };

    try {
      io.banner({ version: "9.9.9", subtitle: "TeleBotHost CLI", tagline: "demo" });
    } finally {
      process.stdout.write = origWrite;
      if (origQuiet === undefined) delete process.env.TBH_QUIET; else process.env.TBH_QUIET = origQuiet;
    }

    const text = chunks.join("");
    assert.ok(text.indexOf("████████╗") > -1, "banner art missing");
    assert.ok(text.indexOf("TeleBotHost CLI") > -1);
    assert.ok(text.indexOf("v9.9.9") > -1);
    assert.strictEqual(text.indexOf("\u001b["), -1, "no colors when disabled");
  });

  await test("io: box borders stay aligned with colored content", function () {
    const io = require("../src/io");
    const chunks = [];
    const origWrite = process.stdout.write;
    const origQuiet = process.env.TBH_QUIET;

    delete process.env.TBH_QUIET;
    io.setColor(true);
    process.stdout.write = function (s) { chunks.push(String(s)); return true; };

    try {
      io.box("Sign in", [
        "",
        "Paste your Developer API key.",
        io.c.muted("C:\\Users\\someone\\AppData\\Local\\Temp\\tbh\\config.json"),
        io.c.muted("Create one at ") + io.c.accent("https://console.telebothost.com/dashboard/developer")
      ]);
    } finally {
      process.stdout.write = origWrite;
      if (origQuiet === undefined) delete process.env.TBH_QUIET; else process.env.TBH_QUIET = origQuiet;
      io.setColor(false);
    }

    const lines = chunks.join("").split("\n").filter(Boolean);
    const widths = Array.from(new Set(lines.map(io.visibleLen)));
    assert.strictEqual(widths.length, 1, "misaligned box widths: " + widths.join(", "));
  });

  await test("config: set and unset default_bot", async function () {
    const cfgCmd = require("../src/commands/config");
    const ctx = { flags: {}, base: "https://api.telebothost.com/api/v1" };

    await cfgCmd.run(ctx, ["set", "default_bot", "77"]);
    assert.strictEqual(config.load().default_bot, 77);

    await cfgCmd.run(ctx, ["unset", "default_bot"]);
    assert.strictEqual(config.load().default_bot, undefined);
  });

  await test("config: rejects unknown settings", async function () {
    const cfgCmd = require("../src/commands/config");
    const ctx = { flags: {}, base: "https://api.telebothost.com/api/v1" };

    let threw = false;
    try {
      await cfgCmd.run(ctx, ["set", "nonsense", "1"]);
    } catch (e) {
      threw = true;
    }
    assert.ok(threw, "expected an error for an unknown setting");
  });

  await test("cli: explains how to configure a key instead of prompting when not a TTY", function () {
    const bin = path.resolve(__dirname, "..", "bin", "tbh.js");
    const env = Object.assign({}, process.env, {
      TBH_CONFIG_DIR: path.join(TMP, "empty-config"),
      TBH_QUIET: "",
      NO_COLOR: "1"
    });
    delete env.TBH_API_KEY;
    delete env.NODE_EXTRA_CA_CERTS;

    let status = 0;
    let stderr = "";

    try {
      execFileSync(process.execPath, [bin, "bots"], {
        encoding: "utf8",
        env: env,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (e) {
      status = e.status;
      stderr = String(e.stderr || "") + String(e.stdout || "");
    }

    assert.strictEqual(status, 3, "expected exit code 3");
    assert.ok(stderr.indexOf("TBH_API_KEY") > -1, "should mention the env var");
    assert.ok(stderr.indexOf("tbh login") > -1, "should mention tbh login");
  });

  await test("deploy: creates 13 commands and 1 folder on an empty bot", async function () {
    const client = fakeClient();
    const result = await deploy(makeCtx(client));
    assert.strictEqual(result.applied, 13);
    assert.strictEqual(client.store.size, 13);
    assert.strictEqual(client.folders.size, 1);
    assert.ok(client.store.has("/lib_db"));
    assert.ok(client.store.has("*"));
    assert.ok(client.store.has("!"));
    const libCreate = client.calls.filter(function (c) {
      return c.method === "POST" && c.body && c.body.name === "/lib_db";
    })[0];
    assert.ok(libCreate.body.code.indexOf("module.exports") > -1, "module exports its helpers");
    assert.strictEqual(libCreate.body.answer, "");
    assert.strictEqual(libCreate.body.need_reply, false);
  });

  await test("deploy: --json emits one machine-readable document", async function () {
    const client = fakeClient();
    const ctx = makeCtx(client);
    ctx.json = true;

    let captured = "";
    const original = process.stdout.write;

    process.stdout.write = function (chunk) {
      captured += String(chunk);
      return true;
    };

    try {
      await deploy(ctx);
    } finally {
      process.stdout.write = original;
    }

    const data = JSON.parse(captured);
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.bot, 42);
    assert.strictEqual(data.applied, 13);
    assert.strictEqual(data.create.length, 13);
    assert.strictEqual(data.folders.length, 1);
    assert.strictEqual(data.folders[0], "admin");
  });

  await test("deploy: second run is a no-op", async function () {
    const client = fakeClient();
    await deploy(makeCtx(client));
    const before = countWrites(client);
    const result = await deploy(makeCtx(client));
    assert.strictEqual(result.applied, 0);
    assert.strictEqual(countWrites(client), before);
  });

  await test("deploy: --only touches a single command", async function () {
    const client = fakeClient();
    client.calls.length = 0;
    const result = await deploy(makeCtx(client, { only: "/start" }));
    assert.strictEqual(result.applied, 1);
    assert.strictEqual(client.store.size, 1);
    assert.ok(client.store.has("/start"));
  });

  await test("deploy: --dry-run writes nothing", async function () {
    const client = fakeClient();
    const result = await deploy(makeCtx(client, { "dry-run": true }));
    assert.strictEqual(result.applied, 0);
    assert.strictEqual(client.store.size, 0);
    assert.strictEqual(countWrites(client), 0);
  });

  await test("deploy: drift updates exactly one command", async function () {
    const client = fakeClient();
    await deploy(makeCtx(client));
    client.store.get("/start").code = "// drifted";
    const result = await deploy(makeCtx(client));
    assert.strictEqual(result.plan.updates.length, 1);
    assert.strictEqual(result.plan.updates[0].entry.name, "/start");
    assert.strictEqual(result.applied, 1);
  });

  await test("pull: writes command files and a reusable manifest", async function () {
    const client = fakeClient();
    await deploy(makeCtx(client));

    const out = path.join(TMP, "pulled");
    await pull(makeCtx(client, { out: out }));

    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    assert.strictEqual(manifest.commands.length, 13);
    assert.ok(fs.existsSync(path.join(out, "commands", "lib_db.js")));
    assert.ok(fs.existsSync(path.join(out, "commands", "star.js")));
    assert.ok(fs.existsSync(path.join(out, "commands", "bang.js")));

    const reloaded = project.loadProject(out);
    assert.strictEqual(reloaded.entries.length, 13);

    const plan = project.buildPlan(reloaded.entries, Array.from(client.store.values()));
    assert.strictEqual(plan.creates.length, 0);
    assert.strictEqual(plan.updates.length, 0);
    assert.strictEqual(plan.same.length, 13);
  });

  await test("cli smoke: --version and help run", function () {
    const bin = path.resolve(__dirname, "..", "bin", "tbh.js");
    const env = Object.assign({}, process.env, { TBH_QUIET: "" });
    delete env.NODE_EXTRA_CA_CERTS;
    const opts = { encoding: "utf8", env: env, stdio: ["ignore", "pipe", "pipe"] };

    const version = execFileSync(process.execPath, [bin, "--version"], opts).trim();
    assert.ok(/^\d+\.\d+\.\d+$/.test(version), "unexpected version output: " + version);

    const helpText = execFileSync(process.execPath, [bin, "help"], opts);
    assert.ok(helpText.indexOf("deploy") > -1);
    assert.ok(helpText.indexOf("login") > -1);
  });

  await test("ui: bot objects never leak the bot token", function () {
    const { sanitizeBot } = require("../src/ui/server");
    const clean = sanitizeBot({ bot_id: 1, name: "x", bot_token: "123:secret" });
    assert.strictEqual(clean.bot_token, undefined);
    assert.strictEqual(clean.name, "x");
    assert.strictEqual(clean.bot_id, 1);
  });

  await test("ui: session token gate and state payload", async function () {
    const { start } = require("../src/ui/server");
    const s = await start({ port: 0 });

    try {
      const denied = await fetch("http://127.0.0.1:" + s.port + "/api/state");
      assert.strictEqual(denied.status, 403, "unauthenticated request must be rejected");

      const ok = await fetch("http://127.0.0.1:" + s.port + "/api/state", {
        headers: { "X-Tbh-Token": s.token }
      });
      assert.strictEqual(ok.status, 200);

      const data = await ok.json();
      assert.strictEqual(data.ok, true);
      assert.ok(Array.isArray(data.projects), "projects must be an array");
      assert.ok(data.projects.some(function (p) { return p.name === "movie-bot"; }),
        "should discover the movie-bot project, got: " + JSON.stringify(data.projects));
    } finally {
      await s.close();
    }
  });

  await test("ui: a new bot gets the whole project loaded into it", async function () {
    const { applyPlan } = require("../src/ui/server");
    const proj = project.loadProject(MOVIE_BOT);
    const plan = project.buildPlan(proj.entries, []);

    const folders = [];
    proj.entries.forEach(function (e) {
      if (e.folder && folders.indexOf(e.folder) < 0) folders.push(e.folder);
    });

    const client = fakeClient();
    const result = await applyPlan(client, 42, proj, plan, folders, 0);

    assert.strictEqual(result.failures.length, 0, JSON.stringify(result.failures));
    assert.strictEqual(result.applied, 14, "13 commands + 1 folder");
    assert.strictEqual(client.store.size, 13);
    assert.strictEqual(client.folders.size, 1);
    assert.ok(client.store.has("/lib_db"));
    assert.ok(client.store.has("admin") === false, "the folder is not a command");
  });

  await test("ui: waitForBot retries while a brand-new bot warms up", async function () {
    const { waitForBot } = require("../src/ui/server");
    let attempts = 0;

    const client = {
      async get() {
        attempts++;
        if (attempts < 3) {
          const e = new Error("not found");
          e.status = 404;
          throw e;
        }
        return { data: { success: true, commands: [], folders: [] }, status: 200, headers: new Headers() };
      }
    };

    const ready = await waitForBot(client, 7, 0);
    assert.strictEqual(ready, true);
    assert.strictEqual(attempts, 3);
  });

  await test("ui: command payload is whitelisted and gets create defaults", function () {
    const { commandPayload } = require("../src/ui/server");

    const created = commandPayload(
      { name: " /ping ", code: "x", bot_token: "secret", bogus: true, folder: " Tools " },
      true
    );

    assert.strictEqual(created.name, "/ping");
    assert.strictEqual(created.code, "x");
    assert.strictEqual(created.folder, "Tools");
    assert.strictEqual(created.bot_token, undefined, "must never forward a token");
    assert.strictEqual(created.bogus, undefined, "must never forward unknown fields");
    assert.deepStrictEqual(created.aliases, []);
    assert.strictEqual(created.need_reply, false);
    assert.strictEqual(created.is_web, 0);

    const patch = commandPayload({ folder: null, aliases: [" a ", "", "b"] }, false);
    assert.deepStrictEqual(patch, { folder: null, aliases: ["a", "b"] });
  });

  await test("ui: delete helpers hit the right endpoints with ids", async function () {
    const api = require("../src/api");
    const client = fakeClient();

    await api.deleteCommand(client, 42, 9);
    await api.deleteCommands(client, 42, [1, 2]);
    await api.deleteBot(client, 42);

    const deletes = client.calls.filter(function (c) { return c.method === "DELETE"; });
    assert.strictEqual(deletes.length, 3);
    assert.strictEqual(deletes[0].path, "/bot/42/commands/9");
    assert.strictEqual(deletes[1].path, "/bot/42/commands");
    assert.deepStrictEqual(deletes[1].body, { ids: [1, 2] });
    assert.strictEqual(deletes[2].path, "/bot");
    assert.deepStrictEqual(deletes[2].body, { ids: [42] });
  });

  await test("ui: ensureFolder tolerates an existing folder but not a real error", async function () {
    const { ensureFolder } = require("../src/ui/server");
    const client = fakeClient();

    client.post = async function () {
      const e = new Error("Folder already exists");
      e.status = 409;
      throw e;
    };
    await ensureFolder(client, 42, "Admin");

    client.post = async function () {
      const e = new Error("server error");
      e.status = 500;
      throw e;
    };

    let threw = false;
    try {
      await ensureFolder(client, 42, "Admin");
    } catch (e) {
      threw = true;
    }
    assert.strictEqual(threw, true, "a 500 must surface");
  });

  await test("new: registers a bot, deploys the project, and starts it", async function () {
    const newBot = require("../src/commands/newbot");
    const client = fakeClient();

    /* The VS Code extension passes the token through the environment. */
    process.env.TBH_BOT_TOKEN = "123456789:AAFakeTokenValueForTheTestSuite";

    const ctx = makeCtx(client, { name: "Test New Bot" });
    ctx.json = false;

    let result;
    try {
      result = await newBot.run(ctx);
    } finally {
      delete process.env.TBH_BOT_TOKEN;
    }

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.bot.bot_id, 77);
    assert.strictEqual(result.bot.username, "new_bot");
    assert.strictEqual(result.bot.status, 1, "bot must be activated");

    const create = client.calls.filter(function (c) { return c.method === "POST" && c.path === "/bot"; })[0];
    assert.ok(create, "should call POST /bot");
    assert.strictEqual(create.body.run_now, false, "create first, start after the deploy");
    assert.strictEqual(create.body.bot_name, "Test New Bot");

    assert.strictEqual(client.store.size, 13, "all commands deployed");
    assert.strictEqual(client.folders.size, 1, "admin folder created");

    const start = client.calls.filter(function (c) {
      return c.method === "PATCH" && c.path === "/bot/77";
    })[0];
    assert.ok(start, "should activate the bot with PATCH /bot/77");
    assert.strictEqual(start.body.status, 1);

    assert.strictEqual(Number(config.load().default_bot), 77, "new bot becomes the default");
  });

  await test("new: rejects a token that is not from BotFather", async function () {
    const newBot = require("../src/commands/newbot");
    assert.strictEqual(newBot.looksLikeBotToken("123456789:AAH-abcdefghijklmnop"), true);
    assert.strictEqual(newBot.looksLikeBotToken("hello"), false);
    assert.strictEqual(newBot.maskToken("123456789:AAHsecretvalue"), "123456789:••••••••alue");
  });

  await test("project: finds the root from a nested folder", function () {
    const root = makeTempProject("nested-proj");
    const deep = path.join(root, "commands", "a", "b");
    fs.mkdirSync(deep, { recursive: true });

    assert.strictEqual(project.findRoot(deep), root);
    const proj = project.loadProject(deep);
    assert.strictEqual(proj.root, root);
    assert.strictEqual(proj.entries.length, 1);
  });

  await test("link: remembers a project and deploy uses it from anywhere", async function () {
    const linkCmd = require("../src/commands/link");
    const cmds = require("../src/commands/commands");

    const root = makeTempProject("linked-proj");
    const nested = path.join(root, "commands");
    const quietCtx = { flags: {}, json: true };

    /* Link resolves upward to the manifest and saves the root. */
    const linked = linkCmd.run(quietCtx, nested);
    assert.strictEqual(linked.ok, true);
    assert.strictEqual(linked.project, root);
    assert.strictEqual(config.load().project_dir, root);

    /* Run from an unrelated folder with no manifest anywhere above it. */
    const elsewhere = path.join(TMP, "elsewhere");
    fs.mkdirSync(elsewhere, { recursive: true });
    const cwd = process.cwd();
    const client = fakeClient();

    try {
      process.chdir(elsewhere);
      const ctx = makeCtx(client, { dir: undefined });
      await cmds.deploy(ctx);
    } finally {
      process.chdir(cwd);
    }

    assert.ok(client.store.has("/start"), "linked project was deployed");
    assert.strictEqual(client.store.size, 1);
    assert.strictEqual(config.load().project_dir, root, "resolution is remembered");

    /* Unlink forgets it. */
    const removed = linkCmd.unlink(quietCtx);
    assert.strictEqual(removed.removed, true);
    assert.strictEqual(config.load().project_dir, undefined);
  });

  await test("link: refuses a folder without manifest.json", async function () {
    const linkCmd = require("../src/commands/link");
    const empty = path.join(TMP, "empty-dir");
    fs.mkdirSync(empty, { recursive: true });

    assert.throws(function () {
      linkCmd.run({ flags: {}, json: true }, empty);
    }, /No manifest\.json/);
  });

  process.stdout.write("\n" + passed + " passed, " + failed + " failed\n\n");
  if (failed) process.exitCode = 1;
}

main().catch(function (e) {
  process.stderr.write("\nTest runner crashed: " + (e && e.stack ? e.stack : e) + "\n");
  process.exitCode = 1;
});

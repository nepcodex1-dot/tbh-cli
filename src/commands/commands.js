"use strict";

const fs = require("fs");
const path = require("path");

const io = require("../io");
const api = require("../api");
const config = require("../config");
const project = require("../project");
const http = require("../http");
const bots = require("./bots");

/*
 * Project resolution, in this order:
 *   1. --dir <path>
 *   2. manifest.json in the cwd or any parent (works from any sub-folder)
 *   3. the project remembered by `tbh link` (works from any folder at all)
 * The root that wins is remembered, so the next `tbh deploy` is instant.
 */
function loadProjectForCtx(ctx) {
  const cfg = config.load();
  let proj;

  try {
    proj = project.loadProject(ctx.flags.dir);
  } catch (e) {
    if (e.code !== "NO_PROJECT" || !cfg.project_dir) throw e;

    try {
      proj = project.loadProject(cfg.project_dir);
    } catch (linkError) {
      if (linkError.code !== "NO_PROJECT") throw linkError;

      const broken = new Error(
        "The linked project no longer has a manifest.json:\n" +
        "  " + cfg.project_dir + "\n" +
        "  Fix it with `tbh link <path>`, or forget it with `tbh unlink`."
      );
      broken.code = "NO_PROJECT";
      throw broken;
    }

    if (!ctx.json) {
      io.note("No manifest.json here — using the linked project");
      io.note(io.c.accent(proj.root) + io.c.faint("  (change it with `tbh link <path>`)"));
    }
  }

  if (proj.root !== cfg.project_dir) {
    cfg.project_dir = proj.root;
    config.save(cfg);
  }

  return proj;
}

function loadSelected(ctx) {
  const proj = loadProjectForCtx(ctx);
  let entries = proj.entries;

  if (typeof ctx.flags.only === "string" && ctx.flags.only) {
    const wanted = ctx.flags.only.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    entries = entries.filter(function (e) { return wanted.indexOf(e.name) >= 0; });
    if (!entries.length) io.die("--only matched no commands in the manifest.");
  }

  return { proj: proj, entries: entries };
}

function folderList(remoteFolders, entries) {
  const existing = new Set((remoteFolders || []).map(function (f) { return f.name; }));
  const missing = [];
  entries.forEach(function (e) {
    if (e.folder && !existing.has(e.folder) && missing.indexOf(e.folder) < 0) missing.push(e.folder);
  });
  return missing;
}

function printPlan(plan, missingFolders) {
  const items = [];
  const MAX_SAME = 6;

  plan.creates.forEach(function (i) {
    items.push({ mark: io.c.ok("+"), verb: "create", name: i.entry.name, detail: "" });
  });
  plan.updates.forEach(function (i) {
    items.push({ mark: io.c.warn("~"), verb: "update", name: i.entry.name, detail: i.changed.join(", ") });
  });
  plan.same.slice(0, MAX_SAME).forEach(function (i) {
    items.push({ mark: io.c.faint("="), verb: "same", name: i.entry.name, detail: "" });
  });
  if (plan.same.length > MAX_SAME) {
    items.push({
      mark: io.c.faint("·"),
      verb: "",
      name: "+" + (plan.same.length - MAX_SAME) + " more unchanged",
      detail: ""
    });
  }
  missingFolders.forEach(function (f) {
    items.push({ mark: io.c.accent("+"), verb: "folder", name: f + "/", detail: "" });
  });

  const nameWidth = Math.max.apply(null, items.map(function (i) { return i.name.length; }).concat([12]));

  io.out("");
  items.forEach(function (it) {
    io.out(
      "  " + it.mark + " " +
      io.c.muted(io.pad(it.verb, 7)) +
      io.c.bold(io.pad(it.name, nameWidth)) +
      (it.detail ? io.c.faint("  " + it.detail) : "")
    );
  });

  if (plan.extra.length) {
    io.out("  " + io.c.faint("? ") + io.c.muted(io.pad("remote", 7)) +
      io.c.muted(plan.extra.map(function (c) { return c.name; }).join(", ")));
  }

  io.out("");
  const parts = [
    plan.creates.length ? io.c.ok(plan.creates.length + " create") : null,
    plan.updates.length ? io.c.warn(plan.updates.length + " update") : null,
    plan.same.length ? io.c.muted(plan.same.length + " unchanged") : null,
    plan.extra.length ? io.c.muted(plan.extra.length + " remote-only") : null
  ].filter(Boolean);

  io.out("  " + parts.join(io.c.faint("  ·  ")));
  io.out("");
}

async function deploy(ctx) {
  const client = ctx.ensure();
  const botId = await bots.resolveBot(ctx);
  const selected = loadSelected(ctx);

  /* --json: silence the human output and emit one machine-readable document. */
  const asJson = !!ctx.json;
  if (asJson) process.env.TBH_QUIET = "1";

  const finish = function (payload) {
    if (asJson) process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return Object.assign({ plan: plan }, payload);
  };

  io.out("");
  io.out("  " + io.c.brand("▌") + " " + io.c.bold("Deploy") + "  " +
    io.c.muted(selected.proj.root) + io.c.faint("  →  ") + io.c.accent("bot #" + botId));

  const spin = io.spinner("Reading commands from the bot…");
  let remote;
  try {
    remote = await api.listCommands(client, botId);
  } catch (e) {
    spin.stop();
    throw e;
  }
  spin.stop();

  const plan = project.buildPlan(selected.entries, remote.commands || []);
  const missingFolders = folderList(remote.folders, selected.entries);

  printPlan(plan, missingFolders);

  const writes = plan.creates.length + plan.updates.length + missingFolders.length;

  const summary = function (applied, extra) {
    return Object.assign({
      ok: true,
      bot: botId,
      project: selected.proj.root,
      commands: selected.proj.entries.length,
      applied: applied,
      create: plan.creates.map(function (i) { return i.entry.name; }),
      update: plan.updates.map(function (i) { return { name: i.entry.name, fields: i.changed }; }),
      folders: missingFolders,
      remote_only: plan.extra.map(function (c) { return c.name; })
    }, extra || {});
  };

  if (ctx.flags["dry-run"]) {
    io.info("Dry run — nothing was written.");
    io.out("");
    return finish(summary(0, { dryRun: true }));
  }

  if (!writes) {
    io.ok("Already up to date.");
    io.out("");
    return finish(summary(0, { upToDate: true }));
  }

  if (!ctx.flags.yes) {
    const go = await io.confirm("Apply " + writes + " change(s) to bot #" + botId + "?", true);
    if (!go) {
      io.info("Aborted.");
      io.out("");
      return finish(summary(0, { aborted: true }));
    }
    io.out("");
  }

  for (const name of missingFolders) {
    try {
      await api.createFolder(client, botId, name);
      io.ok("folder " + io.c.bold(name));
    } catch (e) {
      if (e.status === 400 || e.status === 409) io.warn("folder '" + name + "' already exists");
      else throw e;
    }
  }

  const delay = ctx.flags.delay === undefined ? 120 : (Number(ctx.flags.delay) || 0);
  const failures = [];
  const total = plan.creates.length + plan.updates.length;
  let applied = 0;
  let done = 0;

  const stamp = function () {
    done++;
    return io.c.faint(io.pad(done + "/" + total, 7, "right")) + "  ";
  };

  for (const item of plan.creates) {
    try {
      const res = await api.createCommand(client, botId, item.payloadCreate || item.payload);
      applied++;
      const id = res.command && res.command.id ? io.c.faint("  #" + res.command.id) : "";
      io.out("  " + stamp() + io.c.ok("created") + "  " + io.c.bold(item.entry.name) + id);
    } catch (e) {
      failures.push({ name: item.entry.name, message: e.message });
      io.err("failed   " + item.entry.name + io.c.faint("  — " + e.message));
    }
    if (delay) await http.sleep(delay);
  }

  for (const item of plan.updates) {
    try {
      await api.updateCommand(client, botId, item.remote.id, item.payload);
      applied++;
      io.out("  " + stamp() + io.c.warn("updated") + "  " + io.c.bold(item.entry.name) +
        io.c.faint("  " + item.changed.join(", ")));
    } catch (e) {
      failures.push({ name: item.entry.name, message: e.message });
      io.err("failed   " + item.entry.name + io.c.faint("  — " + e.message));
    }
    if (delay) await http.sleep(delay);
  }

  if (ctx.flags.prune && plan.extra.length) {
    io.out("");
    io.warn("Remote-only commands: " + plan.extra.map(function (c) { return c.name; }).join(", "));
    const go = ctx.flags.yes ? true : await io.confirm("Delete them?", false);
    if (go) {
      await api.deleteCommands(client, botId, plan.extra.map(function (c) { return c.id; }));
      io.ok("pruned " + plan.extra.length + " command(s)");
    }
  }

  io.out("");

  if (failures.length) {
    io.box("Deploy incomplete", [
      "",
      io.c.bad(failures.length + " of " + total + " command(s) failed"),
      "",
      io.c.muted("The deploy is idempotent — fix the cause and re-run `tbh deploy`."),
      new URL(ctx.base).host === "api.telebothost.com"
        ? io.c.muted("Rate limited? Wait a minute or add --delay 500.")
        : "",
      ""
    ]);
    io.out("");

    finish(summary(applied, { ok: false, failures: failures }));

    const err = new Error("deploy finished with failures");
    err.silent = true;
    err.exitCode = 1;
    throw err;
  }

  io.box("Deployed", [
    "",
    io.c.ok("✔") + "  " + io.c.bold(applied + " change(s)") + " applied to bot " + io.c.accent("#" + botId),
    io.c.muted("   " + selected.proj.entries.length + " commands now match the manifest"),
    ""
  ]);

  io.out("");
  io.note("Launch it with `tbh start` if it is not running.");
  io.note("Check for runtime errors with `tbh logs`.");
  io.out("");

  return finish(summary(applied));
}

async function diff(ctx) {
  const client = ctx.ensure();
  const botId = await bots.resolveBot(ctx);
  const selected = loadSelected(ctx);

  const spin = io.spinner("Comparing with the bot…");
  let remote;
  try {
    remote = await api.listCommands(client, botId);
  } catch (e) {
    spin.stop();
    throw e;
  }
  spin.stop();

  const plan = project.buildPlan(selected.entries, remote.commands || []);
  const missingFolders = folderList(remote.folders, selected.entries);

  if (ctx.json) {
    io.out(JSON.stringify({
      bot: botId,
      project: selected.proj.root,
      create: plan.creates.map(function (i) { return i.entry.name; }),
      update: plan.updates.map(function (i) { return { name: i.entry.name, fields: i.changed }; }),
      same: plan.same.map(function (i) { return i.entry.name; }),
      folders: missingFolders,
      remote_only: plan.extra.map(function (c) { return c.name; })
    }, null, 2));
    return;
  }

  io.out("");
  io.out("  " + io.c.brand("▌") + " " + io.c.bold("Diff") + "  " +
    io.c.muted(selected.proj.root) + io.c.faint("  ↔  ") + io.c.accent("bot #" + botId));

  printPlan(plan, missingFolders);

  if (!plan.creates.length && !plan.updates.length && !missingFolders.length) {
    io.ok("Bot #" + botId + " already matches the manifest — nothing to deploy.");
    io.out("");
  } else {
    io.note("Run `tbh deploy` to apply these changes.");
    io.out("");
  }
}

async function pull(ctx) {
  const client = ctx.ensure();
  const botId = await bots.resolveBot(ctx);

  const spin = io.spinner("Downloading commands…");
  let data;
  try {
    data = await api.listCommands(client, botId);
  } catch (e) {
    spin.stop();
    throw e;
  }
  const commands = data.commands || [];
  spin.stop();

  if (!commands.length) io.die("No commands on bot #" + botId + " to pull.");

  const outDir = path.resolve(ctx.flags.out || "pulled");
  const commandsDir = path.join(outDir, "commands");
  fs.mkdirSync(commandsDir, { recursive: true });

  const used = new Set();
  const manifest = {
    bot: botId,
    pulled_at: new Date().toISOString(),
    commands: []
  };

  commands.forEach(function (cmd) {
    const slug = project.uniqueSlug(used, cmd.name);
    const rel = "commands/" + slug + ".js";
    const file = path.join(outDir, rel);

    if (fs.existsSync(file) && !ctx.flags.force) {
      io.warn("skip existing " + rel + " (use --force to overwrite)");
    } else {
      fs.writeFileSync(file, cmd.code || "", "utf8");
      io.ok("pulled " + cmd.name + " → " + rel);
    }

    manifest.commands.push({
      name: cmd.name,
      code_file: rel,
      answer: cmd.answer || "",
      parse_mode: cmd.parse_mode || "",
      keyboard: cmd.keyboard || "",
      aliases: cmd.aliases || [],
      allow_only_group: !!cmd.allow_only_group,
      need_reply: !!cmd.need_reply,
      case_insensitive: !!cmd.case_insensitive,
      is_web: Number(cmd.is_web || 0),
      folder: cmd.folder || null
    });
  });

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  io.out("");
  io.box("Pulled", [
    "",
    io.c.ok("✔") + "  " + io.c.bold(commands.length + " command(s)") + " → " + io.c.muted(outDir),
    io.c.muted("   manifest.json + commands/*.js"),
    ""
  ]);
  io.out("");
  io.note('Deploy from there with: tbh deploy "' + outDir + '"');
  io.out("");
}

async function ls(ctx) {
  const client = ctx.ensure();
  const botId = await bots.resolveBot(ctx);
  const data = await api.listCommands(client, botId);
  const commands = data.commands || [];

  if (ctx.json) {
    io.out(JSON.stringify(commands, null, 2));
    return;
  }

  if (!commands.length) {
    io.info("No commands on bot #" + botId + ".");
    return;
  }

  const rows = commands.map(function (c) {
    return [
      io.c.faint(String(c.id)),
      io.c.bold(c.name),
      c.folder ? io.c.accent(c.folder) : io.c.faint("—"),
      c.need_reply ? io.c.ok("yes") : io.c.faint("no"),
      io.c.muted(String((c.code || "").length))
    ];
  });

  io.out("");
  io.out("  " + io.c.brand("▌") + " " + io.c.bold("Commands") + "  " + io.c.accent("bot #" + botId));
  io.out("");
  io.out(io.table(["ID", "NAME", "FOLDER", "NEED_REPLY", "BYTES"], rows, {
    align: ["right", "left", "left", "center", "right"]
  }));
  io.out("");
  io.note(commands.length + " command(s) on bot #" + botId);
  io.out("");
}

async function findRemote(ctx, client, botId, target) {
  if (!target) return null;
  const data = await api.listCommands(client, botId);
  const commands = data.commands || [];

  if (/^\d+$/.test(String(target))) {
    const byId = commands.filter(function (c) { return String(c.id) === String(target); })[0];
    if (byId) return byId;
  }

  return commands.filter(function (c) { return c.name === target; })[0] || null;
}

async function get(ctx, target) {
  if (!target) io.die("Usage: tbh get <command name|id>");

  const client = ctx.ensure();
  const botId = await bots.resolveBot(ctx);
  const cmd = await findRemote(ctx, client, botId, target);

  if (!cmd) io.die('Command "' + target + '" not found on bot #' + botId + ".");

  if (ctx.json) {
    io.out(JSON.stringify(cmd, null, 2));
    return;
  }

  io.out("");
  io.out(io.c.bold(cmd.name) + io.c.gray("  #" + cmd.id +
    "  folder=" + (cmd.folder || "-") +
    "  need_reply=" + (cmd.need_reply ? "yes" : "no")));
  io.out(io.c.gray("─".repeat(50)));
  io.out(cmd.code || "(empty)");
  io.out("");
}

async function rm(ctx, target) {
  if (!target) io.die("Usage: tbh rm <command name|id>");

  const client = ctx.ensure();
  const botId = await bots.resolveBot(ctx);
  const cmd = await findRemote(ctx, client, botId, target);

  if (!cmd) io.die('Command "' + target + '" not found on bot #' + botId + ".");

  if (!ctx.flags.yes) {
    const go = await io.confirm("Delete " + cmd.name + " (#" + cmd.id + ") from bot #" + botId + "?", false);
    if (!go) {
      io.info("Aborted.");
      return;
    }
  }

  await client.del("/bot/" + botId + "/commands/" + cmd.id);
  io.ok("Deleted " + cmd.name + " (#" + cmd.id + ").");
}

module.exports = {
  loadProjectForCtx: loadProjectForCtx,
  deploy: deploy,
  diff: diff,
  pull: pull,
  ls: ls,
  get: get,
  rm: rm
};

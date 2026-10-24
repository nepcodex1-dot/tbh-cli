"use strict";

/*
 * `tbh link [path]` / `tbh unlink`
 *
 * Remember a project folder so `tbh deploy` works from any directory — the
 * same way `wrangler deploy` finds your project. Nothing here talks to the
 * API, so a link can be created before signing in.
 */

const fs = require("fs");
const path = require("path");

const io = require("../io");
const config = require("../config");
const project = require("../project");

function run(ctx, arg) {
  const start = (typeof ctx.flags.dir === "string" && ctx.flags.dir) || arg || process.cwd();
  const abs = path.resolve(String(start));

  if (!fs.existsSync(abs)) {
    io.die("No such folder: " + abs);
  }

  const root = project.findRoot(abs);
  if (!root) {
    io.die(
      "No manifest.json in " + abs + " or its parents.\n" +
      "  Run this inside a project folder, or pass the folder: tbh link <path>"
    );
  }

  /* Validates manifest.json and every command file before saving anything. */
  const proj = project.loadProject(root);

  const cfg = config.load();
  cfg.project_dir = proj.root;
  config.save(cfg);

  const result = {
    ok: true,
    project: proj.root,
    commands: proj.entries.length,
    bot: cfg.default_bot ? Number(cfg.default_bot) : null
  };

  if (ctx.json) {
    io.out(JSON.stringify(result, null, 2));
    return result;
  }

  io.out("");
  io.ok("Linked " + io.c.bold(proj.root));
  io.out(io.kv([
    ["commands", String(proj.entries.length)],
    ["bot", cfg.default_bot ? "#" + cfg.default_bot : io.c.muted("(none — run `tbh use <id>`)")],
    ["config", io.c.muted(config.configFile())]
  ]));
  io.out("");
  io.note("`tbh deploy` now works from any folder.");
  io.note("Change it later with `tbh link <path>`, undo with `tbh unlink`.");
  io.out("");

  return result;
}

function unlink(ctx) {
  const cfg = config.load();

  if (!cfg.project_dir) {
    if (ctx && ctx.json) {
      io.out(JSON.stringify({ ok: false, removed: false }, null, 2));
      return { ok: false, removed: false };
    }
    io.info("No project is linked.");
    return { ok: false, removed: false };
  }

  const old = cfg.project_dir;
  delete cfg.project_dir;
  config.save(cfg);

  if (ctx && ctx.json) {
    io.out(JSON.stringify({ ok: true, removed: true, project: old }, null, 2));
    return { ok: true, removed: true, project: old };
  }

  io.ok("Unlinked " + io.c.bold(old));
  io.note("`tbh deploy` will only search the current folder again.");
  io.out("");

  return { ok: true, removed: true, project: old };
}

module.exports = {
  run: run,
  unlink: unlink
};

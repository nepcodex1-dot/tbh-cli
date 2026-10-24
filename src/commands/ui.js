"use strict";

const { spawn } = require("child_process");
const os = require("os");

const io = require("../io");

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
    return true;
  } catch (e) {
    return false;
  }
}

async function run(ctx) {
  const { start } = require("../ui/server");

  const port = ctx.flags.port === undefined ? 7420 : Number(ctx.flags.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.die("--port must be a number between 0 and 65535.");
  }

  let handle;
  try {
    handle = await start({ port: port, dir: ctx.flags.dir });
  } catch (e) {
    const err = new Error("Could not start the web UI on 127.0.0.1:" + port + " — " + e.message);
    err.silent = true;
    io.err(err.message);
    process.exitCode = 1;
    return;
  }

  io.banner({
    version: ctx.version,
    subtitle: "Web Console",
    tagline: "local, loopback-only, one session token"
  });

  io.out("  " + io.c.bold("Open this URL") + "  " + io.c.faint("(token is required — do not share it)"));
  io.out("");
  io.out("  " + io.c.accent(io.c.underline(handle.url)));
  io.out("");

  io.out(io.kv([
    ["address", "http://127.0.0.1:" + handle.port],
    ["project root", process.cwd()],
    ["config", "shared with the CLI (" + (process.env.TBH_CONFIG_DIR || os.homedir() + "\\.tbh") + ")"]
  ]));

  io.out("");
  io.note("Add a key inside the page (pub_ = browse only, sk_ = deploy).");
  io.note("Press Ctrl+C to stop the server.");
  io.out("");

  if (!ctx.flags["no-open"]) {
    const opened = openBrowser(handle.url);
    if (opened) io.info("Opened your default browser.");
    else io.note("Could not open a browser — paste the URL manually.");
  }

  await new Promise(function (resolve) {
    let stopping = false;

    const stop = function () {
      if (stopping) return;
      stopping = true;
      io.out("");
      io.info("Shutting down…");
      handle.close().then(resolve, resolve);
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });

  io.ok("Web UI stopped.");
}

module.exports = { run: run };

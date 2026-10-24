#!/usr/bin/env node
"use strict";

const io = require("../src/io");
const { main } = require("../src/cli");

/* Piping into `head` / `more` closes stdout early — don't crash on EPIPE. */
process.stdout.on("error", function (e) {
  if (e && e.code === "EPIPE") process.exit(0);
});

process.on("SIGINT", function () {
  io.killSpinner();
  io.closeRl();
  process.stderr.write("\n");
  process.exit(130);
});

main(process.argv.slice(2))
  .then(function () {
    io.killSpinner();
    io.closeRl();
  })
  .catch(function (err) {
    io.killSpinner();
    io.closeRl();

    if (err && err.silent) {
      process.exitCode = err.exitCode || 1;
      return;
    }

    const message = err && err.message ? err.message : String(err);
    const status = err && err.status ? err.status : null;

    process.stderr.write("\n" + io.c.bad("  ✖  ") + io.c.bold(message) + "\n");

    if (err && err.data && err.data.hint) {
      process.stderr.write("     " + io.c.muted(err.data.hint) + "\n");
    }
    if (status === 401 || status === 403) {
      process.stderr.write("     " + io.c.muted("Run `tbh login` with a valid sk_… key.") + "\n");
    } else if (status === 429) {
      process.stderr.write("     " + io.c.muted("Rate limited — retry in a minute or raise --delay.") + "\n");
    }
    process.stderr.write("\n");

    if (process.env.TBH_DEBUG && err && err.stack) {
      process.stderr.write(io.c.faint(err.stack) + "\n");
    }

    process.exitCode = 1;
  });

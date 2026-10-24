"use strict";

/*
 * A freshly registered bot is not instantly usable: the API can keep returning
 * 404/409/5xx for a few seconds while TeleBotHost provisions it. Everything that
 * talks to a just-created bot goes through this helper instead of sleeping blindly.
 */

const api = require("./api");
const http = require("./http");

const RETRYABLE = new Set([404, 409, 425, 500, 502, 503, 504]);

async function untilReady(client, botId, options) {
  const opts = options || {};
  const attempts = opts.attempts || 8;
  const base = opts.delay === undefined ? 700 : opts.delay;
  const onWait = opts.onWait;

  let lastError = null;

  for (let i = 0; i < attempts; i++) {
    try {
      await api.listCommands(client, botId);
      return true;
    } catch (e) {
      lastError = e;

      if (!RETRYABLE.has(e.status)) throw e;
      if (i === attempts - 1) break;

      if (typeof onWait === "function") onWait(i + 1, e);
      if (base) await http.sleep(base + i * 300);
    }
  }

  const err = new Error(
    "Bot #" + botId + " was created but did not become ready in time" +
    (lastError ? " (" + lastError.message + ")" : "") + "."
  );
  err.status = lastError ? lastError.status : null;
  throw err;
}

module.exports = { untilReady: untilReady, RETRYABLE: RETRYABLE };

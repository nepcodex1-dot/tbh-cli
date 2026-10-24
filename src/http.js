"use strict";

const { c } = require("./io");

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status || 0;
    this.data = data || null;
  }
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function messageFrom(data, status) {
  if (data && typeof data === "object") {
    if (data.message) return String(data.message);
    if (data.reason) return String(data.reason);
    if (data.hint) return String(data.hint);
    if (data.error) return typeof data.error === "string" ? data.error : JSON.stringify(data.error);
  }
  if (typeof data === "string" && data.trim()) return data.trim().slice(0, 300);
  return "HTTP " + status;
}

function retryDelayMs(headers, attempt) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const n = Number(retryAfter);
    if (Number.isFinite(n) && n > 0) return Math.min(n * 1000, 70000);
  }
  const resetMinute = headers.get("x-ratelimit-reset-minute");
  if (resetMinute) {
    const target = Number(resetMinute) * 1000;
    const wait = target - Date.now();
    if (Number.isFinite(wait) && wait > 0 && wait < 70000) return wait + 500;
  }
  return Math.min(1500 * (attempt + 1), 10000);
}

function createClient(options) {
  const opts = options || {};
  const root = String(opts.base || "").replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const retries = opts.retries == null ? 2 : opts.retries;
  const timeout = opts.timeout == null ? 30000 : opts.timeout;
  const apiKey = opts.key || "";

  if (typeof fetchImpl !== "function") {
    throw new Error("Node 18+ is required (global fetch is not available).");
  }
  if (!root) throw new Error("API base URL is empty.");

  async function request(method, apiPath, body) {
    const url = root + (apiPath.charAt(0) === "/" ? apiPath : "/" + apiPath);

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, timeout);

      const headers = {
        Accept: "application/json",
        Authorization: "Bearer " + apiKey,
        "X-Api-Key": apiKey,
        "User-Agent": "tbh-cli/1.0"
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";

      let res;
      let text;

      try {
        res = await fetchImpl(url, {
          method: method,
          headers: headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
        text = await res.text();
      } catch (e) {
        clearTimeout(timer);
        const aborted = e && e.name === "AbortError";
        const retriable = aborted || /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(String(e && e.message));
        if (retriable && attempt < retries) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        throw new ApiError(
          aborted
            ? "Request timed out after " + timeout + "ms"
            : "Network error: " + (e && e.message ? e.message : e) +
              (e && e.cause && e.cause.code ? " (" + e.cause.code + ")" : ""),
          0,
          null
        );
      }

      clearTimeout(timer);

      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = text;
        }
      }

      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const wait = retryDelayMs(res.headers, attempt);
        if (!process.env.TBH_QUIET) {
          process.stderr.write(c.yellow("  !  ") + "HTTP " + res.status + " - retrying in " +
            (wait / 1000).toFixed(1) + "s\n");
        }
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        throw new ApiError(messageFrom(data, res.status), res.status, data);
      }

      return { data: data, headers: res.headers, status: res.status };
    }
  }

  return {
    get: function (p) { return request("GET", p); },
    post: function (p, b) { return request("POST", p, b); },
    patch: function (p, b) { return request("PATCH", p, b); },
    del: function (p, b) { return request("DELETE", p, b); },
    request: request
  };
}

function rateInfo(headers) {
  if (!headers) return null;
  return {
    dailyRemaining: headers.get("x-ratelimit-remaining"),
    dailyLimit: headers.get("x-ratelimit-limit"),
    minuteRemaining: headers.get("x-ratelimit-remaining-minute"),
    minuteLimit: headers.get("x-ratelimit-limit-minute"),
    resetMinute: headers.get("x-ratelimit-reset-minute")
  };
}

module.exports = {
  ApiError: ApiError,
  createClient: createClient,
  rateInfo: rateInfo,
  sleep: sleep
};

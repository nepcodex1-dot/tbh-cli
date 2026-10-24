"use strict";

/*
 * io.js — terminal presentation layer.
 *
 * Everything user-visible goes through here so the CLI looks the same everywhere:
 * truecolor (with 256/16-color fallbacks), an ASCII banner, framed boxes, a
 * spinner, progress bars and tables. All of it collapses to plain text when
 * output is piped, NO_COLOR is set, or TBH_QUIET=1.
 */

const readline = require("readline");

/* ------------------------------------------------------------------ */
/*  color support                                                      */
/* ------------------------------------------------------------------ */

const hasEnv = function (k) {
  return Object.prototype.hasOwnProperty.call(process.env, k);
};

const NO_COLOR = hasEnv("NO_COLOR");
const FORCE_COLOR = hasEnv("FORCE_COLOR") && process.env.FORCE_COLOR !== "0";

let colorEnabled = !NO_COLOR && (!!process.stdout.isTTY || FORCE_COLOR);
let truecolor = /truecolor|24bit/i.test(process.env.COLORTERM || "");

function setColor(value) {
  colorEnabled = NO_COLOR ? false : !!value;
}

function setTruecolor(value) {
  truecolor = !!value;
}

function supportsColor() {
  return colorEnabled;
}

function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(rgb) {
  return "#" + rgb.map(function (v) {
    return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  }).join("");
}

function rgbTo256(r, g, b) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return 16 +
    36 * Math.round((r / 255) * 5) +
    6 * Math.round((g / 255) * 5) +
    Math.round((b / 255) * 5);
}

function fg(hex) {
  const rgb = hexToRgb(hex);
  const open = truecolor
    ? "\u001b[38;2;" + rgb[0] + ";" + rgb[1] + ";" + rgb[2] + "m"
    : "\u001b[38;5;" + rgbTo256(rgb[0], rgb[1], rgb[2]) + "m";
  return function (s) {
    return colorEnabled ? open + String(s) + "\u001b[0m" : String(s);
  };
}

function attr(code) {
  return function (s) {
    return colorEnabled ? "\u001b[" + code + "m" + String(s) + "\u001b[0m" : String(s);
  };
}

const PALETTE = {
  brand: "#8B5CF6",
  brandDeep: "#6D28D9",
  accent: "#22D3EE",
  ok: "#22C55E",
  info: "#60A5FA",
  warn: "#F59E0B",
  bad: "#EF4444",
  muted: "#7C8794",
  faint: "#4B5563"
};

const c = {
  brand: fg(PALETTE.brand),
  accent: fg(PALETTE.accent),
  ok: fg(PALETTE.ok),
  info: fg(PALETTE.info),
  warn: fg(PALETTE.warn),
  bad: fg(PALETTE.bad),
  muted: fg(PALETTE.muted),
  faint: fg(PALETTE.faint),

  bold: attr("1"),
  dim: attr("2"),
  italic: attr("3"),
  underline: attr("4")
};

/* short aliases kept for readability in command modules */
c.green = c.ok;
c.red = c.bad;
c.yellow = c.warn;
c.cyan = c.accent;
c.blue = c.info;
c.gray = c.muted;
c.magenta = c.brand;

/* ------------------------------------------------------------------ */
/*  output                                                             */
/* ------------------------------------------------------------------ */

function quiet() {
  return !!process.env.TBH_QUIET;
}

function out(line) {
  if (!quiet()) process.stdout.write(String(line == null ? "" : line) + "\n");
}

function raw(text) {
  if (!quiet()) process.stdout.write(String(text == null ? "" : text));
}

function ok(line) {
  if (!quiet()) process.stdout.write("  " + c.ok("✔") + "  " + line + "\n");
}

function info(line) {
  if (!quiet()) process.stdout.write("  " + c.accent("›") + "  " + line + "\n");
}

function note(line) {
  if (!quiet()) process.stdout.write("  " + c.muted("·") + "  " + c.muted(line) + "\n");
}

function warn(line) {
  if (!quiet()) process.stderr.write("  " + c.warn("▲") + "  " + line + "\n");
}

function err(line) {
  if (!quiet()) process.stderr.write("  " + c.bad("✖") + "  " + line + "\n");
}

function step(line) {
  if (!quiet()) process.stdout.write("\n" + c.bold(line) + "\n");
}

function die(msg, code) {
  if (!quiet()) {
    process.stderr.write("\n" + c.bad("  ✖  ") + c.bold(String(msg)) + "\n\n");
  }
  const e = new Error(String(msg));
  e.exitCode = code || 1;
  e.silent = true;
  throw e;
}

/* ------------------------------------------------------------------ */
/*  layout helpers                                                     */
/* ------------------------------------------------------------------ */

const ANSI_RE = /\u001b\[[0-9;]*m/g;

function stripAnsi(s) {
  return String(s == null ? "" : s).replace(ANSI_RE, "");
}

function visibleLen(s) {
  return stripAnsi(s).length;
}

function cols() {
  return Math.max(60, Math.min(Number(process.stdout.columns) || 100, 120));
}

function pad(s, width, align) {
  const str = String(s == null ? "" : s);
  const diff = width - visibleLen(str);
  if (diff <= 0) return str;
  if (align === "right") return " ".repeat(diff) + str;
  if (align === "center") {
    const left = Math.floor(diff / 2);
    return " ".repeat(left) + str + " ".repeat(diff - left);
  }
  return str + " ".repeat(diff);
}

function truncate(s, width) {
  const str = String(s == null ? "" : s);
  /* Never cut a string that carries escape codes — slicing would break them. */
  if (str.indexOf("\u001b[") >= 0) return str;
  if (str.length <= width) return str;
  if (width <= 1) return str.slice(0, width);
  return str.slice(0, width - 1) + "…";
}

/* ------------------------------------------------------------------ */
/*  banner                                                             */
/* ------------------------------------------------------------------ */

const BANNER_LINES = [
  "████████╗██████╗ ██╗  ██╗",
  "╚══██╔══╝██╔══██╗██║  ██║",
  "   ██║   ██████╔╝███████║",
  "   ██║   ██╔══██╗██╔══██║",
  "   ██║   ██████╔╝██║  ██║",
  "   ╚═╝   ╚═════╝ ╚═╝  ╚═╝"
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function banner(opts) {
  const o = opts || {};
  if (quiet()) return;

  const from = hexToRgb(o.from || PALETTE.brand);
  const to = hexToRgb(o.to || PALETTE.accent);
  const last = BANNER_LINES.length - 1;

  const art = BANNER_LINES.map(function (line, i) {
    const t = last === 0 ? 0 : i / last;
    const hex = rgbToHex([
      lerp(from[0], to[0], t),
      lerp(from[1], to[1], t),
      lerp(from[2], to[2], t)
    ]);
    return "  " + fg(hex)(line);
  });

  process.stdout.write("\n" + art.join("\n") + "\n");

  const title = o.subtitle || "TeleBotHost CLI";
  const version = o.version ? "  v" + o.version : "";
  process.stdout.write("  " + c.bold(title) + c.muted(version) + "\n");

  if (o.tagline) {
    process.stdout.write("  " + c.muted(o.tagline) + "\n");
  }

  if (o.rule !== false) {
    const width = Math.min(cols() - 4, 62);
    process.stdout.write("  " + c.faint("─".repeat(width)) + "\n");
  }
  process.stdout.write("\n");
}

/* ------------------------------------------------------------------ */
/*  boxes / sections                                                   */
/* ------------------------------------------------------------------ */

function box(title, lines, opts) {
  const o = opts || {};
  if (quiet()) return;

  const body = (lines || []).map(String);
  const titleText = title ? " " + title + " " : "";
  const titleLen = visibleLen(titleText);
  const limit = Math.min(o.width || 72, cols() - 4);

  let inner = titleLen;
  body.forEach(function (l) {
    inner = Math.max(inner, visibleLen(l));
  });
  inner = Math.min(Math.max(inner, 24), Math.max(24, limit - 4));

  const border = o.accent ? c.accent : c.faint;
  const head = o.accent ? c.accent(titleText) : c.brand(titleText);
  const topDashes = Math.max(0, inner + 1 - titleLen);

  process.stdout.write(
    "  " + border("╭─") + head + border("─".repeat(topDashes) + "╮") + "\n"
  );

  body.forEach(function (l) {
    process.stdout.write(
      "  " + border("│") + " " + pad(truncate(l, inner), inner) + " " + border("│") + "\n"
    );
  });

  process.stdout.write("  " + border("╰" + "─".repeat(inner + 2) + "╯") + "\n");
}

function section(title) {
  if (quiet()) return;
  out("");
  out("  " + c.brand("▌") + " " + c.bold(title));
}

function divider(width) {
  if (quiet()) return;
  out("  " + c.faint("─".repeat(width || Math.min(cols() - 4, 62))));
}

/* ------------------------------------------------------------------ */
/*  table                                                              */
/* ------------------------------------------------------------------ */

function table(headers, rows, opts) {
  const o = opts || {};
  const all = [headers].concat(rows);
  const widths = headers.map(function (h, i) {
    return Math.max.apply(null, all.map(function (r) {
      return visibleLen(r[i] == null ? "" : r[i]);
    }));
  });

  const lines = [];
  lines.push(
    "  " + headers.map(function (h, i) {
      return c.muted(c.bold(pad(h, widths[i], o.align ? o.align[i] : "left")));
    }).join("   ")
  );
  lines.push(
    "  " + widths.map(function (w) {
      return c.faint("─".repeat(w));
    }).join("   ")
  );
  rows.forEach(function (r) {
    lines.push(
      "  " + r.map(function (cell, i) {
        return pad(cell == null ? "" : cell, widths[i], o.align ? o.align[i] : "left");
      }).join("   ")
    );
  });

  return lines.join("\n");
}

function kv(pairs, opts) {
  const o = opts || {};
  const width = Math.max.apply(null, pairs.map(function (p) { return String(p[0]).length; }));
  return pairs.map(function (p) {
    return "  " + c.muted(pad(p[0], width, "right")) + "  " + c.faint("│") + "  " + p[1];
  }).join("\n");
}

/* ------------------------------------------------------------------ */
/*  spinner / progress                                                 */
/* ------------------------------------------------------------------ */

let activeSpinner = null;

function canAnimate() {
  return colorEnabled && !!process.stderr.isTTY && !quiet();
}

function spinner(text) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let label = String(text || "");
  let frame = 0;
  let timer = null;

  const draw = function () {
    process.stderr.write("\r\u001b[2K  " + c.accent(frames[frame]) + "  " + label);
    frame = (frame + 1) % frames.length;
  };

  const api = {
    update: function (next) {
      label = String(next || "");
      if (timer) draw();
      return api;
    },
    succeed: function (final) {
      api.stop(final, c.ok("✔"));
    },
    fail: function (final) {
      api.stop(final, c.bad("✖"));
    },
    stop: function (final, symbol) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (activeSpinner === api) activeSpinner = null;

      if (quiet()) return api;
      if (!final && !canAnimate()) return api;
      if (canAnimate()) process.stderr.write("\r\u001b[2K");

      if (final) {
        process.stderr.write("  " + (symbol || c.ok("✔")) + "  " + final + "\n");
      }
      return api;
    }
  };

  if (canAnimate()) {
    draw();
    timer = setInterval(draw, 80);
    if (timer.unref) timer.unref();
    activeSpinner = api;
  }

  return api;
}

function killSpinner() {
  if (activeSpinner) {
    activeSpinner.stop();
    activeSpinner = null;
  }
}

function bar(done, total, width) {
  const w = width || 20;
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const filled = Math.round(ratio * w);
  return c.ok("█".repeat(filled)) + c.faint("░".repeat(Math.max(0, w - filled)));
}

function progress(done, total, label) {
  if (quiet()) return;
  if (!process.stdout.isTTY || !colorEnabled) return;
  const line = "  " + bar(done, total) + "  " + c.muted(done + "/" + total) +
    (label ? "  " + label : "");
  process.stdout.write("\r\u001b[2K" + line);
  if (done >= total) process.stdout.write("\n");
}

/* ------------------------------------------------------------------ */
/*  prompts                                                            */
/* ------------------------------------------------------------------ */

let rl = null;

function getRl() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return rl;
}

function closeRl() {
  if (rl) {
    try {
      rl.close();
    } catch (e) {
      /* ignore */
    }
    rl = null;
  }
}

function ask(question) {
  return new Promise(function (resolve) {
    const iface = getRl();
    let settled = false;

    const finish = function (value) {
      if (settled) return;
      settled = true;
      iface.removeListener("close", onClose);
      resolve(value);
    };

    const onClose = function () {
      finish("");
    };

    iface.once("close", onClose);
    iface.question(question, finish);
  });
}

function askHidden(question) {
  return new Promise(function (resolve) {
    const stdin = process.stdin;

    /* Not a TTY (piped input, CI): fall back to a normal visible read. */
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      resolve(ask(question).then(function (v) { return String(v || "").trim(); }));
      return;
    }

    closeRl();
    process.stdout.write(question);

    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const finish = function (result) {
      stdin.removeListener("data", onData);
      try {
        stdin.setRawMode(false);
      } catch (e) {
        /* ignore */
      }
      stdin.pause();
      process.stdout.write("\n");
      resolve(result);
    };

    const onData = function (chunk) {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          finish(value);
          return;
        }
        if (ch === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (ch === "\u0015") {
          value = "";
          continue;
        }
        if (ch < " ") continue;
        value += ch;
      }
    };

    stdin.on("data", onData);
  });
}

async function confirm(question, defaultValue) {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";

  if (!process.stdin.isTTY) {
    note(question + " → " + (defaultValue ? "yes" : "no") + "  (non-interactive)");
    return !!defaultValue;
  }

  const answer = String(await ask("  " + question + c.muted(suffix))).trim().toLowerCase();
  if (!answer) return !!defaultValue;
  return answer === "y" || answer === "yes";
}

async function choose(items, options) {
  const opts = options || {};
  const label = opts.label || function (x) {
    return String(x);
  };

  if (!process.stdin.isTTY) {
    die("Interactive selection is not available here — pass an explicit value (for example --bot <id>).");
  }

  out("");
  items.forEach(function (item, i) {
    out("   " + c.accent(String(i + 1).padStart(2)) + c.faint(" │ ") + label(item));
  });
  out("");

  for (;;) {
    const raw = String(await ask("  " + c.muted("select") + " " + c.faint("›") + " ")).trim();
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1];
    if (opts.allowEmpty && raw === "") return null;
    warn("Enter a number between 1 and " + items.length + ".");
  }
}

module.exports = {
  c: c,
  PALETTE: PALETTE,
  setColor: setColor,
  setTruecolor: setTruecolor,
  supportsColor: supportsColor,

  out: out,
  raw: raw,
  ok: ok,
  info: info,
  note: note,
  warn: warn,
  err: err,
  step: step,
  die: die,

  banner: banner,
  box: box,
  section: section,
  divider: divider,
  table: table,
  kv: kv,
  bar: bar,
  progress: progress,
  spinner: spinner,
  killSpinner: killSpinner,

  ask: ask,
  askHidden: askHidden,
  confirm: confirm,
  choose: choose,
  closeRl: closeRl,

  stripAnsi: stripAnsi,
  visibleLen: visibleLen,
  pad: pad
};

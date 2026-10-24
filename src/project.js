"use strict";

const fs = require("fs");
const path = require("path");

const BOOLEAN_FIELDS = ["allow_only_group", "need_reply", "case_insensitive"];
const TEXT_FIELDS = ["code", "answer", "keyboard", "parse_mode"];

function findRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());

  for (let depth = 0; depth < 8; depth++) {
    const candidate = path.join(dir, "manifest.json");
    if (fs.existsSync(candidate)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadProject(startDir) {
  const root = findRoot(startDir);

  if (!root) {
    const err = new Error(
      "No manifest.json found in " + path.resolve(startDir || process.cwd()) +
      " or its parents. Run inside a project folder or pass --dir <path>."
    );
    err.code = "NO_PROJECT";
    throw err;
  }

  const manifestPath = path.join(root, "manifest.json");
  let manifest;

  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new Error("Invalid JSON in " + manifestPath + ": " + e.message);
  }

  if (!manifest || !Array.isArray(manifest.commands)) {
    throw new Error(manifestPath + ' must contain a "commands" array.');
  }

  const seen = new Set();
  const entries = manifest.commands.map(function (item, index) {
    if (!item || typeof item.name !== "string" || !item.name.trim()) {
      throw new Error("manifest command #" + (index + 1) + " has no valid name.");
    }
    if (seen.has(item.name)) {
      throw new Error('Duplicate command name in manifest: "' + item.name + '".');
    }
    seen.add(item.name);

    if (!item.code_file) {
      throw new Error('Command "' + item.name + '" has no code_file.');
    }

    const file = path.resolve(root, item.code_file);
    if (!fs.existsSync(file)) {
      throw new Error('Missing code file for "' + item.name + '": ' + item.code_file);
    }

    const normalized = {
      name: item.name,
      code_file: item.code_file,
      answer: item.answer || "",
      parse_mode: item.parse_mode || "",
      keyboard: item.keyboard || "",
      aliases: Array.isArray(item.aliases) ? item.aliases : [],
      allow_only_group: !!item.allow_only_group,
      need_reply: !!item.need_reply,
      case_insensitive: !!item.case_insensitive,
      is_web: Number(item.is_web || 0),
      folder: item.folder || null,
      code: fs.readFileSync(file, "utf8")
    };

    return normalized;
  });

  return { root: root, manifestPath: manifestPath, manifest: manifest, entries: entries };
}

function payloadFor(entry, options) {
  const opts = options || {};
  const payload = {
    name: entry.name,
    code: entry.code,
    answer: entry.answer || "",
    keyboard: entry.keyboard || "",
    aliases: entry.aliases || [],
    allow_only_group: !!entry.allow_only_group,
    need_reply: !!entry.need_reply,
    case_insensitive: !!entry.case_insensitive,
    is_web: Number(entry.is_web || 0)
  };

  if (entry.parse_mode) payload.parse_mode = entry.parse_mode;
  if (entry.folder) payload.folder = entry.folder;
  else if (opts.forUpdate) payload.folder = null;

  return payload;
}

function comparable(value, field) {
  if (field === "code") {
    return String(value == null ? "" : value).replace(/\r\n/g, "\n").trim();
  }
  if (field === "aliases") {
    return JSON.stringify((value || []).map(String));
  }
  if (field === "folder") {
    return value == null || value === "" ? null : String(value);
  }
  if (field === "is_web") {
    return Number(value || 0);
  }
  if (BOOLEAN_FIELDS.indexOf(field) >= 0) {
    return !!value;
  }
  if (field === "parse_mode") {
    return String(value || "").toLowerCase();
  }
  if (TEXT_FIELDS.indexOf(field) >= 0) {
    return String(value == null ? "" : value).replace(/\r\n/g, "\n").trim();
  }
  return String(value == null ? "" : value);
}

function changedFields(localPayload, remoteCommand) {
  const changed = [];

  Object.keys(localPayload).forEach(function (field) {
    if (field === "name") return;
    if (comparable(localPayload[field], field) !== comparable(remoteCommand[field], field)) {
      changed.push(field);
    }
  });

  return changed;
}

function buildPlan(entries, remoteCommands) {
  const byName = new Map();
  (remoteCommands || []).forEach(function (cmd) {
    if (cmd && cmd.name) byName.set(cmd.name, cmd);
  });

  const creates = [];
  const updates = [];
  const same = [];

  entries.forEach(function (entry) {
    const payload = payloadFor(entry, { forUpdate: true });
    const remote = byName.get(entry.name);

    if (!remote) {
      creates.push({
        entry: entry,
        payload: payload,
        payloadCreate: payloadFor(entry, { forUpdate: false })
      });
      return;
    }

    const changed = changedFields(payload, remote);
    if (changed.length) {
      updates.push({ entry: entry, remote: remote, changed: changed, payload: payload });
    } else {
      same.push({ entry: entry, remote: remote });
    }
  });

  const localNames = new Set(entries.map(function (e) { return e.name; }));
  const extra = (remoteCommands || []).filter(function (cmd) {
    return cmd && cmd.name && !localNames.has(cmd.name);
  });

  return { creates: creates, updates: updates, same: same, extra: extra };
}

const SPECIAL_SLUGS = {
  "*": "star",
  "!": "bang",
  "@": "at",
  "@@": "at_at",
  "/": "root"
};

function slugFor(name) {
  if (SPECIAL_SLUGS[name]) return SPECIAL_SLUGS[name];
  const base = String(name)
    .replace(/^\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return base || "command";
}

function uniqueSlug(used, name) {
  let slug = slugFor(name);
  let candidate = slug;
  let n = 2;
  while (used.has(candidate)) {
    candidate = slug + "_" + n;
    n++;
  }
  used.add(candidate);
  return candidate;
}

module.exports = {
  findRoot: findRoot,
  loadProject: loadProject,
  payloadFor: payloadFor,
  changedFields: changedFields,
  buildPlan: buildPlan,
  slugFor: slugFor,
  uniqueSlug: uniqueSlug
};

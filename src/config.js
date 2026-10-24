"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_BASE = "https://api.telebothost.com/api/v1";

function configDir() {
  return process.env.TBH_CONFIG_DIR || path.join(os.homedir(), ".tbh");
}

function configFile() {
  return path.join(configDir(), "config.json");
}

function load() {
  try {
    const raw = fs.readFileSync(configFile(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function save(cfg) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2) + "\n", "utf8");
  try {
    fs.chmodSync(configFile(), 0o600);
  } catch (e) {
    /* Windows: chmod is a no-op */
  }
  return configFile();
}

function clear() {
  try {
    fs.unlinkSync(configFile());
    return true;
  } catch (e) {
    return false;
  }
}

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 12) return key.slice(0, 3) + "…";
  return key.slice(0, 6) + "…" + key.slice(-4);
}

module.exports = {
  DEFAULT_BASE: DEFAULT_BASE,
  configDir: configDir,
  configFile: configFile,
  load: load,
  save: save,
  clear: clear,
  maskKey: maskKey
};

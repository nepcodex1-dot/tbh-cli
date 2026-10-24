"use strict";

// Thin wrappers over the TeleBotHost Developer API (OpenAPI 3.0.3).
// Base: https://api.telebothost.com/api/v1

function body(res) {
  return res && res.data ? res.data : {};
}

async function listBots(client) {
  return body(await client.get("/bot"));
}

async function createBot(client, payload) {
  return body(await client.post("/bot", payload));
}

async function getBot(client, botId) {
  return body(await client.get("/bot/" + botId));
}

async function updateBot(client, botId, payload) {
  return body(await client.patch("/bot/" + botId, payload));
}

async function listCommands(client, botId) {
  return body(await client.get("/bot/" + botId + "/commands"));
}

async function getCommand(client, botId, commandId) {
  return body(await client.get("/bot/" + botId + "/commands/" + commandId));
}

async function createCommand(client, botId, payload) {
  return body(await client.post("/bot/" + botId + "/commands", payload));
}

async function updateCommand(client, botId, commandId, payload) {
  return body(await client.patch("/bot/" + botId + "/commands/" + commandId, payload));
}

async function deleteCommand(client, botId, commandId) {
  return body(await client.del("/bot/" + botId + "/commands/" + commandId));
}

async function deleteBot(client, botId) {
  return body(await client.del("/bot", { ids: [botId] }));
}

async function deleteCommands(client, botId, ids) {
  return body(await client.del("/bot/" + botId + "/commands", { ids: ids }));
}

async function listFolders(client, botId) {
  return body(await client.get("/bot/" + botId + "/commands/folders"));
}

async function createFolder(client, botId, name) {
  return body(await client.post("/bot/" + botId + "/commands/folders", { name: name }));
}

async function listEnvs(client, botId) {
  return body(await client.get("/bot/" + botId + "/envs"));
}

async function createEnv(client, botId, payload) {
  return body(await client.post("/bot/" + botId + "/envs", payload));
}

async function updateEnv(client, botId, envId, payload) {
  return body(await client.patch("/bot/" + botId + "/envs/" + envId, payload));
}

async function listLogs(client, botId) {
  return body(await client.get("/bot/" + botId + "/logs"));
}

async function clearLogs(client, botId) {
  return body(await client.del("/bot/" + botId + "/logs"));
}

async function analytics(client, botId) {
  return body(await client.get("/bot/" + botId + "/analytics"));
}

async function exportLink(client, botId) {
  return body(await client.get("/bot/" + botId + "/export"));
}

module.exports = {
  listBots: listBots,
  createBot: createBot,
  getBot: getBot,
  updateBot: updateBot,
  listCommands: listCommands,
  getCommand: getCommand,
  createCommand: createCommand,
  updateCommand: updateCommand,
  deleteCommand: deleteCommand,
  deleteCommands: deleteCommands,
  deleteBot: deleteBot,
  listFolders: listFolders,
  createFolder: createFolder,
  listEnvs: listEnvs,
  createEnv: createEnv,
  updateEnv: updateEnv,
  listLogs: listLogs,
  clearLogs: clearLogs,
  analytics: analytics,
  exportLink: exportLink
};

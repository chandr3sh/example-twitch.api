const axios = require("axios").default;
const createError = require("http-errors");
const FileSync = require("lowdb/adapters/FileSync");
const lowdb = require("lowdb");
const YAML = require("yaml");

require("dotenv").config();

/**
 * Config for token, secrets, etc.
 */

const adapter = new FileSync("twitch.config", {
  serialize: (obj) => YAML.stringify(obj),
  deserialize: (str) => YAML.parse(str),
});
const appConfig = lowdb(adapter);

appConfig.defaults({
  token: "",
  id: process.env.TWITCH_APP_CLIENT_ID,
  secret: process.env.TWITCH_APP_CLIENT_SECRET,
}).write();

function saveConfig(key, value) {
  appConfig.set(key, value).write();
}

function getConfig(key) {
  return appConfig.get(key).value();
}

/**
 * Twitch Authentication API
 */

const oauth = axios.create({
  baseURL: "https://id.twitch.tv/oauth2",
  validateStatus: (status) => status === 200,
});
function validateToken(token) {
  return oauth.get("/validate", { headers: { Authorization: `OAuth ${token}` } });
}
function revokeToken(token, client_id) {
  return oauth.post("/revoke", null, { params: { token, client_id } });
}
function getNewToken(client_id, client_secret, grant_type = "client_credentials") {
  return oauth.post("/token", null, { params: { client_id, client_secret, grant_type } });
}

/**
 * Validate old token or acquire new one
 */

async function refreshToken() {
  try {
    await validateToken(getConfig("token"));
  } catch (error) {
    if (error.response?.status === 401) { // unauthorized
      const response = await getNewToken(getConfig("id"), getConfig("secret"));
      if (!response.data?.access_token) {
        throw createError(500, "Failed to acquire new token");
      }
      saveConfig("token", response.data.access_token);
    } else {
      throw error;
    }
  }
  return getConfig("token");
}

/**
 * Revoke old token and acquire new one
 */

async function renewToken() {
  try {
    await revokeToken(getConfig("token"), getConfig("id"));
  } catch (error) {
    if (error.response?.status === 400) { // invalid token
      /* do nothing */
    } else {
      throw error;
    }
  }
  const response = await getNewToken(getConfig("id"), getConfig("secret"));
  if (!response.data?.access_token) {
    throw createError(500, "Failed to acquire new token");
  }
  saveConfig("token", response.data.access_token);
  return getConfig("token");
}

/**
 * Twitch Data API
 */

const helix = axios.create({
  baseURL: "https://api.twitch.tv/helix",
  validateStatus: (status) => status === 200,
});

/**
 * Request user data
 */

async function getUser(username) {
  let user = new User();
  try {
    const response = await helix.get("/users", {
      params: { login: username },
      headers: {
        Authorization: `Bearer ${getConfig("token")}`,
        "Client-Id": getConfig("id"),
      },
    });
    user = Object.assign(user, response.data.data?.[0]);
    if (!user.username) {
      throw createError(404, `User ${username} doesn't exist`);
    }
  } catch (error) {
    if (error.response?.status === 401 && error.response?.data) { // unauthorized
      const unrefreshedToken = getConfig("token");
      const refreshedToken = await refreshToken();
      if (unrefreshedToken === refreshedToken) {
        throw createError(401, error.response.data.message ?? error.response.message);
      }
      user = await getUser(username);
    } else if (error.response) {
      throw createError(error.response.status, error.response.data?.message ?? error.response.message);
    } else {
      throw error;
    }
  }
  return Object.freeze(user);
}

class User {
  get username() { return this.login; }

  get displayName() { return this.display_name; }

  get isPartner() { return this.broadcaster_type.toLowerCase() === "partner"; }

  get isAffiliate() { return this.broadcaster_type.toLowerCase() === "affiliate"; }

  get isStaff() { return this.type.toLowerCase() === "staff"; }

  get isAdmin() { return this.type.toLowerCase() === "admin"; }

  get isGlobalMod() { return this.type.toLowerCase() === "global_mod"; }

  get viewCount() { return parseInt(this.view_count, 10); }

  get createdAt() { return new Date(this.created_at); }

  get avatarUrl() { return this.profile_image_url; }
}

module.exports = { getUser };

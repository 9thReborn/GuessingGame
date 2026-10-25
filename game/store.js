const crypto = require("node:crypto");
const { GameSession } = require("./GameSession");

const sessions = new Map(); // sessionId -> GameSession

// No 0/O or 1/I: codes get read aloud and typed on phones.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode() {
  let code;
  do {
    code = Array.from(
      { length: 6 },
      () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)],
    ).join("");
  } while (sessions.has(code)); // retry on the (rare) collision
  return code;
}

function createSession() {
  const session = new GameSession(generateCode());
  sessions.set(session.id, session);
  return session;
}

function getSession(id) {
  if (typeof id !== "string") return undefined;
  return sessions.get(id.trim().toUpperCase());
}

function deleteSession(id) {
  sessions.delete(id);
}

module.exports = { createSession, getSession, deleteSession };

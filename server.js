const http = require("node:http");
const path = require("node:path");
const express = require("express");
const { Server } = require("socket.io");
const store = require("./game/store");
const { ROUND_DURATION_MS, MAX_ATTEMPTS } = require("./game/GameSession");

const app = express();
const server = http.createServer(app); // one HTTP server...
const io = new Server(server); // ...shared by Express and Socket.IO

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ---------- broadcast helpers ----------
const send = (room, type, text) => io.to(room).emit("message", { type, text });
const broadcastState = (session) =>
  io.to(session.id).emit("state", session.getPublicState());

function announceRoundEnd(session, result) {
  if (result.winnerId) {
    // Every socket is automatically in a room named after its own id,
    // so io.to(winnerId) targets just the winner.
    io.to(result.winnerId).emit("message", {
      type: "win",
      text: `🎉 You have won! The answer was "${result.answer}". +10 points.`,
    });
    io.to(session.id)
      .except(result.winnerId)
      .emit("message", {
        type: "system",
        text: `🏆 ${result.winnerName} won! The answer was "${result.answer}".`,
      });
  } else {
    send(
      session.id,
      "system",
      `⏰ Time's up! No winner this round. The answer was "${result.answer}".`,
    );
  }

  const newMaster = session.players.get(result.newMasterId);
  if (newMaster)
    send(session.id, "system", `${newMaster.name} is now the game master.`);
  broadcastState(session);
}

io.on("connection", (socket) => {
  let session = null; // the session THIS connection is in

  const reply = (callback, payload) => {
    if (typeof callback === "function") callback(payload);
  };
  const notInSession = (callback) =>
    reply(callback, { ok: false, error: "You are not in a session." });

  function enter(target, callback) {
    session = target;
    socket.join(target.id);
    reply(callback, { ok: true, sessionId: target.id });
  }

  socket.on("create_session", (payload, callback) => {
    if (session)
      return reply(callback, {
        ok: false,
        error: "Leave your current session first.",
      });

    const newSession = store.createSession();
    const result = newSession.addPlayer(socket.id, payload?.name);
    if (!result.ok) {
      store.deleteSession(newSession.id); // don't leave an empty session behind
      return reply(callback, result);
    }

    enter(newSession, callback);
    send(
      session.id,
      "system",
      `Session created. Share the code ${session.id}. You are the game master.`,
    );
    broadcastState(session);
  });

  socket.on("join_session", (payload, callback) => {
    if (session)
      return reply(callback, {
        ok: false,
        error: "Leave your current session first.",
      });

    const target = store.getSession(payload?.sessionId);
    if (!target)
      return reply(callback, {
        ok: false,
        error: "Session not found. Check the code.",
      });

    const result = target.addPlayer(socket.id, payload?.name);
    if (!result.ok) return reply(callback, result);

    enter(target, callback);
    send(session.id, "system", `${payload.name.trim()} joined the game.`);
    broadcastState(session);
  });

  socket.on("set_question", (payload, callback) => {
    if (!session) return notInSession(callback);

    const result = session.setQuestion(
      socket.id,
      payload?.question,
      payload?.answer,
    );
    reply(callback, result);
    if (!result.ok) return;

    send(
      session.id,
      "system",
      "The game master has set a question. Waiting for the game to start…",
    );
    broadcastState(session);
  });

  socket.on("start_game", (_payload, callback) => {
    if (!session) return notInSession(callback);

    const current = session; // capture it: the timer must announce to THIS session
    const result = current.start(socket.id, (roundResult) =>
      announceRoundEnd(current, roundResult),
    );
    reply(callback, result);
    if (!result.ok) return;

    send(
      current.id,
      "system",
      `🚀 Game started! ${ROUND_DURATION_MS / 1000}s on the clock, ${MAX_ATTEMPTS} attempts each.`,
    );
    broadcastState(current);
  });

  socket.on("guess", (payload, callback) => {
    if (!session) return notInSession(callback);

    const player = session.players.get(socket.id);
    const result = session.submitGuess(socket.id, payload?.guess);
    reply(callback, result);
    if (!result.ok) return;

    send(
      session.id,
      "guess",
      `${player.name}: ${payload.guess.trim()} ${result.correct ? "✅" : "❌"}`,
    );
    if (result.correct) announceRoundEnd(session, result.result);
    else broadcastState(session); // attempts changed
  });

  function leave() {
    if (!session) return;
    const current = session;
    session = null;

    const player = current.players.get(socket.id);
    socket.leave(current.id);
    const outcome = current.removePlayer(socket.id);

    if (outcome.isEmpty) {
      store.deleteSession(current.id); // requirement 13
      console.log(`Session ${current.id} deleted (everyone left).`);
      return;
    }

    send(current.id, "system", `${player.name} left the game.`);

    if (outcome.roundResult) {
      send(
        current.id,
        "system",
        "The game master left, so this round has ended.",
      );
      return announceRoundEnd(current, outcome.roundResult);
    }
    if (outcome.newMasterId) {
      send(
        current.id,
        "system",
        `${current.players.get(outcome.newMasterId).name} is now the game master.`,
      );
    }
    broadcastState(current);
  }

  socket.on("leave_session", leave);
  socket.on("disconnect", leave); // closing the tab counts as leaving
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
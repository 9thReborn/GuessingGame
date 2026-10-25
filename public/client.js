// public/client.js
const socket = io(); // connects back to the server that served this page
const $ = (id) => document.getElementById(id);

let state = null;
let timerInterval = null;

// ---------- view helpers ----------
function addMessage(text, type = "system") {
  const li = document.createElement("li");
  li.className = `msg ${type}`;
  li.textContent = text; // NEVER innerHTML with user input (see note below)
  $("messages").append(li);
  li.scrollIntoView({ block: "end" });
}

function showGame(sessionId) {
  $("lobby").hidden = true;
  $("game").hidden = false;
  $("session-code").textContent = sessionId;
  $("messages").replaceChildren();
}

function showLobby(error = "") {
  $("game").hidden = true;
  $("lobby").hidden = false;
  $("lobby-error").textContent = error;
  state = null;
  stopTimer();
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  $("timer").textContent = "";
}

function startTimer(endsAt) {
  stopTimer();
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    $("timer").textContent = `⏱ ${seconds}s`;
  };
  tick();
  timerInterval = setInterval(tick, 250);
}

function render() {
  const me = state.players.find((p) => p.id === socket.id);
  const iAmMaster = state.masterId === socket.id;
  const inProgress = state.status === "in_progress";

  $("player-count").textContent =
    `${state.playerCount} player${state.playerCount === 1 ? "" : "s"} connected`;

  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  $("players").replaceChildren(
    ...sorted.map((p) => {
      const li = document.createElement("li");
      const tags = [p.isMaster ? "👑" : "", p.id === socket.id ? "(you)" : ""]
        .filter(Boolean)
        .join(" ");
      li.textContent = `${p.name} ${tags} — ${p.score} pts`;
      return li;
    }),
  );

  $("question-banner").hidden = !inProgress;
  if (inProgress) $("question-banner").textContent = `❓ ${state.question}`;

  $("master-form").hidden = !(iAmMaster && !inProgress);
  $("guess-form").hidden = !(inProgress && !iAmMaster);

  if (inProgress) startTimer(state.endsAt);
  else stopTimer();

  let status;
  if (inProgress) {
    status = iAmMaster
      ? "Round in progress. You are the game master, so watch them guess!"
      : `Attempts left: ${me?.attemptsLeft ?? 0}`;
  } else if (iAmMaster) {
    status = state.hasQuestion
      ? `Question set. Start when there are at least ${state.minPlayers} players.`
      : "You are the game master. Set a question and answer.";
  } else {
    status = "Waiting for the game master to start the round…";
  }
  $("status-line").textContent = status;
}

// ---------- user actions ----------
function handleJoin(res) {
  if (!res.ok) return ($("lobby-error").textContent = res.error);
  showGame(res.sessionId);
}

$("create-btn").addEventListener("click", () => {
  socket.emit("create_session", { name: $("name").value }, handleJoin);
});

$("join-btn").addEventListener("click", () => {
  socket.emit(
    "join_session",
    { name: $("name").value, sessionId: $("code").value },
    handleJoin,
  );
});

$("master-form").addEventListener("submit", (e) => {
  e.preventDefault(); // stop the browser from reloading the page
  socket.emit(
    "set_question",
    { question: $("q-input").value, answer: $("a-input").value },
    (res) => {
      if (!res.ok) return addMessage(res.error, "error");
      $("q-input").value = "";
      $("a-input").value = "";
    },
  );
});

$("start-btn").addEventListener("click", () => {
  socket.emit("start_game", null, (res) => {
    if (!res.ok) addMessage(res.error, "error");
  });
});

$("guess-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("guess-input");
  socket.emit("guess", { guess: input.value }, (res) => {
    if (!res.ok) return addMessage(res.error, "error");
    input.value = "";
  });
});

$("leave-btn").addEventListener("click", () => {
  socket.emit("leave_session");
  showLobby();
});

// ---------- server events ----------
socket.on("state", (newState) => {
  state = newState;
  render();
});
socket.on("message", (m) => addMessage(m.text, m.type));
socket.on("disconnect", () => showLobby("Connection lost. Please join again."));

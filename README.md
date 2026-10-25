# Guessing Game 🎯

A real-time multiplayer guessing game. One player (the game master) sets a question and answer, the others race to guess it, and everyone sees guesses, winners and scores live, in a chat-style interface.

**Live demo:** _add your Render URL here_
> Hosted on Render's free tier: the first load after a quiet period can take ~50 seconds while the server wakes up.

---

## How to play

1. Enter your name and **Create a game**. You become the game master and get a 6-character session code.
2. Friends enter the code and **Join** before the round starts.
3. The game master sets a **question and answer**, then **starts** the game (at least 3 players needed).
4. Each player has **3 attempts** and **60 seconds** to guess.
5. First correct guess wins **10 points**. If time runs out, nobody scores and the answer is revealed.
6. The next player becomes game master, and a new round begins.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js (≥18) | Event-driven, well suited to many long-lived connections |
| Realtime | Socket.IO | Bidirectional events, rooms per session, acknowledgements, auto-reconnect |
| HTTP | Express | Serves the frontend from the same server and port as the sockets, so no CORS setup is needed |
| Frontend | Vanilla HTML/CSS/JS | No build step; the client only renders state |
| Storage | In-memory `Map` | Sessions are short-lived; see *Limitations* |

**Why WebSockets?** Every player must see joins, guesses and results instantly. Short polling wastes requests, long polling and SSE are server→client only, and players also need to send events to the server. A chat-style game needs two-way communication, which is what WebSockets provide.

---

## Architecture

```
Browser (public/)  ──socket events──►  server.js  ──method calls──►  GameSession (rules)
       ▲                                   │                                │
       └──────── broadcast state/messages ─┘◄──────── results ─────────────┘
                                           │
                                       store.js (Map of sessions)
```

- **`game/GameSession.js`**: all game rules as a state machine (`waiting` ⇄ `in_progress`). It has no socket code, so the rules can be tested in isolation (`sandbox.js`).
- **`game/store.js`**: the session registry and room-code generation. It's the only file that would change if storage moved to Redis.
- **`server.js`**: translates socket events into `GameSession` calls and broadcasts results to the session's room.
- **`public/`**: the chat-style UI. It renders whatever state the server sends.

### Key design decisions

- **Authoritative server.** All rules (attempts, timer, permissions) are enforced on the server. The answer is never sent to clients until the round ends: `getPublicState()` builds the client view field by field and leaves `answer` out.
- **Server-side timer.** The 60-second limit is a `setTimeout` on the server and is cleared with `clearTimeout` when someone wins, so a stale timer can't end a later round. The client countdown is display only.
- **Race-free winning.** Node processes events one at a time on its event loop. If two correct guesses arrive together, the first ends the round and the second is rejected by the `status` guard.
- **Validation everywhere.** Every socket payload is type- and length-checked, and answers are compared after normalising case and whitespace (`"  nnamdi   AZIKIWE "` matches `"Nnamdi Azikiwe"`).
- **XSS-safe rendering.** All user text is rendered with `textContent`, never `innerHTML`.
- **Room codes** avoid look-alike characters (`0/O`, `1/I`) and are generated with `crypto.randomInt`.

### Interpretation of the requirements

- **"More than two players"** is read as **at least 3 people, including the game master** (master + 2 guessers), since the master can't guess their own question. It's one constant (`MIN_PLAYERS`) if a different reading is needed.
- **Master rotation:** after a round, the next player in join order becomes master (wrapping around).
- **Master leaves while waiting:** the next player becomes master.
- **Master leaves mid-round:** the round ends with no winner, the answer is revealed, and the next player becomes master.

---

## Socket events

| Client → Server | Payload | Purpose |
|---|---|---|
| `create_session` | `{ name }` | Create a session and become master |
| `join_session` | `{ sessionId, name }` | Join a waiting session |
| `set_question` | `{ question, answer }` | Master only, before the round |
| `start_game` | — | Master only, needs ≥ 3 players |
| `guess` | `{ guess }` | Players only, during a round |
| `leave_session` | — | Leave (closing the tab also counts) |

| Server → Client | Purpose |
|---|---|
| `state` | Public session state: players, scores, master, status, question, end time |
| `message` | Chat feed entries: system notices, guesses, win announcements |

Client → server events use Socket.IO acknowledgements, so errors go only to the sender.

---

## Running locally

```bash
npm install
npm run dev        # auto-restarts on file changes (node --watch)
# open http://localhost:3000 in three or more browser tabs
```

Production: `npm start`. The port comes from `PORT` (default `3000`).

---

## Testing

### Game logic (no browser)
```bash
node sandbox.js
```
This exercises the rules directly: join limits, master-only actions, attempt counting, answer normalisation, winning and master rotation. The script exits immediately after printing, which confirms the round timer is cleared on a win (a pending `setTimeout` would keep the process alive for 60 seconds).

### Manual multiplayer test (one browser tab per player)

| # | Scenario | Result |
|---|---|---|
| 1 | Create a game → creator becomes master, code shown | ✅ |
| 2 | Second player joins → player count updates live in all tabs | ✅ |
| 3 | Master starts with only 2 players → rejected ("Need at least 3 players") | ✅ |
| 4 | Third player joins → master sets question and starts | ✅ |
| 5 | Fourth player tries to join mid-round → rejected | ✅ |
| 6 | Wrong guess reduces attempts; correct guess wins, shows "You have won" to the winner, winner + answer to others, +10 points | ✅ |
| 7 | Master rotates to the next player after the round | ✅ |
| 8 | Round times out → no winner, no points, answer revealed | ✅ |
| 9 | Master leaves while waiting → next player becomes master | ✅ |
| 10 | All players leave → session deleted (server logs `Session <code> deleted (everyone left).`) | ✅ |

**Session deletion check:** a solo creator who leaves empties the session, so it is deleted at once. A second player then trying to join with that code correctly gets "Session not found". This confirms requirement 13.

---

## Limitations & future improvements

- **Single instance only.** Sessions live in memory, so they disappear on restart and can't be shared across multiple server instances. To scale horizontally, move session state to Redis and use the Socket.IO Redis adapter so broadcasts reach sockets on every instance.
- **Refresh = new player.** Socket.IO gives each connection a new id, so a page refresh rejoins as a new player. A fix: issue each player a reconnect token stored in `localStorage`.
- **One answer per question.** Multiple accepted answers (e.g. "countries starting with P") would be a natural extension.
- No automated test suite yet; `sandbox.js` would be the starting point for unit tests with `node:test`.

---

## Project structure

```
├── game/
│   ├── GameSession.js   # game rules / state machine
│   └── store.js         # session registry + room codes
├── public/
│   ├── index.html
│   ├── client.js
│   └── styles.css
├── sandbox.js           # rule checks without a browser
├── server.js            # Express + Socket.IO wiring
└── package.json
```
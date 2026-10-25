// game/GameSession.js
// Pure game rules. No sockets, no I/O — just state and the checks that protect it.

const MIN_PLAYERS = 3; // master + 2 guessers ("more than two players")
const MAX_ATTEMPTS = 3;
const ROUND_DURATION_MS = 60_000;
const POINTS_FOR_WIN = 10;
const MAX_NAME_LENGTH = 20;
const MAX_TEXT_LENGTH = 200;

const STATUS = Object.freeze({
  WAITING: "waiting",
  IN_PROGRESS: "in_progress",
});

const fail = (error) => ({ ok: false, error });

// "  Nnamdi   AZIKIWE " and "nnamdi azikiwe" should count as the same answer.
function normalize(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// Payload validation: never trust what a client sends.
function isValidText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

class GameSession {
  constructor(id) {
    this.id = id;
    this.players = new Map(); // playerId -> { id, name, score, attemptsLeft }
    this.masterId = null;
    this.status = STATUS.WAITING;
    this.question = null;
    this.answer = null;
    this.timer = null;
    this.endsAt = null; // timestamp, so clients can show a countdown
  }

  addPlayer(id, name) {
    if (this.status !== STATUS.WAITING) {
      return fail("A round is in progress. Try again when it ends.");
    }
    if (!isValidText(name, MAX_NAME_LENGTH)) {
      return fail(`Name must be 1-${MAX_NAME_LENGTH} characters.`);
    }
    if (this.players.has(id)) {
      return fail("You are already in this session.");
    }

    const cleanName = name.trim();
    const nameTaken = [...this.players.values()].some(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase(),
    );
    if (nameTaken) return fail("That name is already taken in this session.");

    this.players.set(id, {
      id,
      name: cleanName,
      score: 0,
      attemptsLeft: MAX_ATTEMPTS,
    });

    // Whoever creates the session (the first player) is the first master.
    if (this.players.size === 1) this.masterId = id;

    return { ok: true };
  }

  setQuestion(playerId, question, answer) {
    if (playerId !== this.masterId)
      return fail("Only the game master can set the question.");
    if (this.status !== STATUS.WAITING)
      return fail("You can only set a question before the round starts.");
    if (
      !isValidText(question, MAX_TEXT_LENGTH) ||
      !isValidText(answer, MAX_TEXT_LENGTH)
    ) {
      return fail(
        `Question and answer must be 1-${MAX_TEXT_LENGTH} characters.`,
      );
    }

    this.question = question.trim();
    this.answer = answer.trim();
    return { ok: true };
  }

  start(playerId, onTimeUp) {
    if (playerId !== this.masterId)
      return fail("Only the game master can start the game.");
    if (this.status !== STATUS.WAITING)
      return fail("The game has already started.");
    if (!this.question) return fail("Set a question and answer first.");
    if (this.players.size < MIN_PLAYERS) {
      return fail(
        `Need at least ${MIN_PLAYERS} players to start (currently ${this.players.size}).`,
      );
    }

    for (const player of this.players.values())
      player.attemptsLeft = MAX_ATTEMPTS;

    this.status = STATUS.IN_PROGRESS;
    this.endsAt = Date.now() + ROUND_DURATION_MS;
    this.timer = setTimeout(() => {
      if (this.status !== STATUS.IN_PROGRESS) return; // defensive double-check
      const result = this._endRound(null); // null = no winner, no points
      onTimeUp(result);
    }, ROUND_DURATION_MS);

    return { ok: true };
  }

  submitGuess(playerId, guess) {
    // Order matters: the cheapest, most general checks come first.
    if (this.status !== STATUS.IN_PROGRESS)
      return fail("There is no round in progress.");

    const player = this.players.get(playerId);
    if (!player) return fail("You are not in this session.");
    if (playerId === this.masterId)
      return fail("The game master cannot guess.");
    if (player.attemptsLeft <= 0)
      return fail("You have no attempts left this round.");
    if (!isValidText(guess, MAX_TEXT_LENGTH))
      return fail("Your guess cannot be empty.");

    player.attemptsLeft -= 1;

    if (normalize(guess) !== normalize(this.answer)) {
      return { ok: true, correct: false, attemptsLeft: player.attemptsLeft };
    }

    player.score += POINTS_FOR_WIN;
    const result = this._endRound(playerId);
    return { ok: true, correct: true, result };
  }

  removePlayer(playerId) {
    if (!this.players.has(playerId))
      return { isEmpty: this.players.size === 0 };

    const wasMaster = playerId === this.masterId;
    // Work out the successor BEFORE deleting, while we still know the master's position.
    const successorId = wasMaster ? this._nextPlayerAfter(playerId) : null;

    this.players.delete(playerId);

    if (this.players.size === 0) {
      this._clearTimer(); // don't leave a timer firing for a session that no longer exists
      return { isEmpty: true };
    }

    if (!wasMaster) return { isEmpty: false };

    if (this.status === STATUS.IN_PROGRESS) {
      // The master left mid-round: end it with no winner and reveal the answer.
      return { isEmpty: false, roundResult: this._endRound(null, successorId) };
    }

    this.masterId = successorId;
    this.question = null;
    this.answer = null;
    return { isEmpty: false, newMasterId: successorId };
  }

  // What clients are allowed to see. Built explicitly, field by field.
  getPublicState() {
    return {
      id: this.id,
      status: this.status,
      masterId: this.masterId,
      question: this.status === STATUS.IN_PROGRESS ? this.question : null,
      hasQuestion: this.question !== null,
      endsAt: this.endsAt,
      playerCount: this.players.size,
      minPlayers: MIN_PLAYERS,
      players: [...this.players.values()].map(
        ({ id, name, score, attemptsLeft }) => ({
          id,
          name,
          score,
          attemptsLeft,
          isMaster: id === this.masterId,
        }),
      ),
    };
  }

  // --- private helpers (the _ prefix is a convention meaning "internal use") ---

  _endRound(winnerId, nextMasterId = null) {
    this._clearTimer();

    const winner = winnerId ? this.players.get(winnerId) : null;
    const answer = this.answer;

    this.masterId = nextMasterId ?? this._nextPlayerAfter(this.masterId);
    this.status = STATUS.WAITING;
    this.question = null;
    this.answer = null;
    this.endsAt = null;

    return {
      winnerId,
      winnerName: winner ? winner.name : null,
      answer,
      newMasterId: this.masterId,
    };
  }

  // A Map remembers insertion order, so "next" means "next person who joined", wrapping around.
  _nextPlayerAfter(id) {
    const ids = [...this.players.keys()];
    const index = ids.indexOf(id);
    return ids[(index + 1) % ids.length];
  }

  _clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = {
  GameSession,
  STATUS,
  MIN_PLAYERS,
  MAX_ATTEMPTS,
  ROUND_DURATION_MS,
};




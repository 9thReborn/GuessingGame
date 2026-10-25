// sandbox.js — exercise the rules directly. Run: node sandbox.js
const { GameSession } = require("./game/GameSession");

const game = new GameSession("ABC123");

console.log("1", game.addPlayer("p1", "Silas"));
console.log("2", game.addPlayer("p2", "Tolu"));
console.log(
  "3",
  game.setQuestion(
    "p1",
    "Who was Nigeria's first president?",
    "Nnamdi Azikiwe",
  ),
);
console.log(
  "4",
  game.start("p1", () => {}),
);
console.log("5", game.addPlayer("p3", "Ada"));
console.log(
  "6",
  game.start("p2", () => {}),
);
console.log(
  "7",
  game.start("p1", (r) => console.log("TIME UP", r)),
);
console.log("8", game.addPlayer("p4", "Latecomer"));
console.log("9", game.submitGuess("p1", "anything"));
console.log("10", game.submitGuess("p2", "Obasanjo"));
console.log("11", game.submitGuess("p3", "  nnamdi   AZIKIWE "));
console.log("12", game.submitGuess("p2", "Nnamdi Azikiwe"));
console.log("13", game.getPublicState());




     

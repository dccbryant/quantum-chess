const boardEl = document.getElementById("board");
const messageHistoryEl = document.getElementById("message-history");
const historyUpBtn = document.getElementById("history-up");
const historyDownBtn = document.getElementById("history-down");
const quantumToggleBtn = document.getElementById("quantum-toggle");
const quantumCountEl = document.getElementById("quantum-count");
const modeEl = document.getElementById("mode");
const newGameBtn = document.getElementById("new-game");
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");
const winModalEl = document.getElementById("win-modal");
const winTextEl = document.getElementById("win-text");
const closeModalBtn = document.getElementById("close-modal");

const FILES = "abcdefgh";
const PIECES = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

let game;
let audioCtx;
let historyNeedsScrollToBottom = true;

function initialGameState() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let c = 0; c < 8; c++) {
    board[0][c] = { type: back[c], color: "b", moved: false };
    board[1][c] = { type: "p", color: "b", moved: false };
    board[6][c] = { type: "p", color: "w", moved: false };
    board[7][c] = { type: back[c], color: "w", moved: false };
  }
  return {
    board,
    turn: "w",
    selected: null,
    legalMoves: [],
    quantumMode: false,
    pendingQuantum: null,
    quantumPieces: [],
    quantumUses: { w: 3, b: 3 },
    enPassantTarget: null,
    mode: "pvp",
    moveHistory: [],
    messageHistory: ["Select a piece to move."],
    currentMessage: "Select a piece to move.",
    gameOver: false,
    undoStack: [],
    redoStack: [],
  };
}

function getAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
}

function playTone(kind) {
  const ctx = getAudio();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  const profile = {
    select: { f1: 310, f2: 340, dur: 0.05, type: "triangle", vol: 0.06 },
    move: { f1: 240, f2: 190, dur: 0.08, type: "square", vol: 0.08 },
    quantumIgnite: { f1: 180, f2: 860, dur: 0.22, type: "sawtooth", vol: 0.09 },
    quantumCollapse: { f1: 760, f2: 130, dur: 0.18, type: "sawtooth", vol: 0.08 },
    button: { f1: 420, f2: 360, dur: 0.035, type: "triangle", vol: 0.045 },
    restart: { f1: 300, f2: 520, dur: 0.12, type: "triangle", vol: 0.07 },
  }[kind];

  if (!profile) return;
  osc.type = profile.type;
  osc.frequency.setValueAtTime(profile.f1, now);
  osc.frequency.exponentialRampToValueAtTime(profile.f2, now + profile.dur);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(profile.vol, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.dur);

  osc.start(now);
  osc.stop(now + profile.dur + 0.01);
}

function toCoord(square) {
  return [8 - Number(square[1]), FILES.indexOf(square[0])];
}
function toSquare(r, c) {
  return `${FILES[c]}${8 - r}`;
}
function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}
function cloneBoard(board) {
  return board.map((row) => row.map((p) => (p ? { ...p } : null)));
}
function getQuantumAtSquare(square) {
  return game.quantumPieces.find((q) => q.positions.includes(square));
}
function pieceAt(board, r, c, quantumAsSolid = true) {
  const piece = board[r][c];
  if (piece) return piece;
  if (!quantumAsSolid) return null;
  const sq = toSquare(r, c);
  const qPiece = game.quantumPieces.find((q) => q.positions.includes(sq));
  return qPiece ? { type: qPiece.type, color: qPiece.color, quantumId: qPiece.id } : null;
}
function pushMove(moves, r, c, opts = {}) {
  if (inBounds(r, c)) moves.push({ r, c, ...opts });
}

function pseudoMoves(board, r, c, color, forAttack = false) {
  const piece = board[r][c];
  if (!piece || piece.color !== color) return [];
  const moves = [];
  const dir = color === "w" ? -1 : 1;

  switch (piece.type) {
    case "p": {
      const one = r + dir;
      if (!forAttack && inBounds(one, c) && !pieceAt(board, one, c)) {
        pushMove(moves, one, c, { kind: "move" });
        const two = r + dir * 2;
        if (!piece.moved && inBounds(two, c) && !pieceAt(board, two, c)) pushMove(moves, two, c, { kind: "double" });
      }
      for (const dc of [-1, 1]) {
        const tr = r + dir;
        const tc = c + dc;
        if (!inBounds(tr, tc)) continue;
        if (forAttack) pushMove(moves, tr, tc, { kind: "attack" });
        else {
          const target = pieceAt(board, tr, tc);
          if (target && target.color !== color) pushMove(moves, tr, tc, { kind: "capture" });
        }
      }
      if (!forAttack && game.enPassantTarget) {
        const [er, ec] = toCoord(game.enPassantTarget);
        if (er === r + dir && Math.abs(ec - c) === 1) pushMove(moves, er, ec, { kind: "enpassant" });
      }
      break;
    }
    case "n": {
      const jumps = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
      for (const [dr, dc] of jumps) {
        const tr = r + dr;
        const tc = c + dc;
        if (!inBounds(tr, tc)) continue;
        const t = pieceAt(board, tr, tc);
        if (!t || t.color !== color) pushMove(moves, tr, tc, { kind: t ? "capture" : "move" });
      }
      break;
    }
    case "b":
    case "r":
    case "q": {
      const dirs = [];
      if (piece.type !== "b") dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
      if (piece.type !== "r") dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
      for (const [dr, dc] of dirs) {
        let tr = r + dr;
        let tc = c + dc;
        while (inBounds(tr, tc)) {
          const t = pieceAt(board, tr, tc);
          if (!t) pushMove(moves, tr, tc, { kind: "move" });
          else {
            if (t.color !== color) pushMove(moves, tr, tc, { kind: "capture" });
            break;
          }
          tr += dr;
          tc += dc;
        }
      }
      break;
    }
    case "k": {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const tr = r + dr;
          const tc = c + dc;
          if (!inBounds(tr, tc)) continue;
          const t = pieceAt(board, tr, tc);
          if (!t || t.color !== color) pushMove(moves, tr, tc, { kind: t ? "capture" : "move" });
        }
      }
      if (!forAttack && !piece.moved) {
        const row = color === "w" ? 7 : 0;
        if (r === row && c === 4 && !isSquareAttacked(board, row, 4, color)) {
          const rookK = board[row][7];
          if (rookK && rookK.type === "r" && rookK.color === color && !rookK.moved && !pieceAt(board, row, 5) && !pieceAt(board, row, 6) && !isSquareAttacked(board, row, 5, color) && !isSquareAttacked(board, row, 6, color)) pushMove(moves, row, 6, { kind: "castle-k" });
          const rookQ = board[row][0];
          if (rookQ && rookQ.type === "r" && rookQ.color === color && !rookQ.moved && !pieceAt(board, row, 1) && !pieceAt(board, row, 2) && !pieceAt(board, row, 3) && !isSquareAttacked(board, row, 3, color) && !isSquareAttacked(board, row, 2, color)) pushMove(moves, row, 2, { kind: "castle-q" });
        }
      }
      break;
    }
  }
  return moves;
}

function isSquareAttacked(board, r, c, ownColor) {
  const enemy = ownColor === "w" ? "b" : "w";
  for (let rr = 0; rr < 8; rr++) {
    for (let cc = 0; cc < 8; cc++) {
      const p = board[rr][cc];
      if (!p || p.color !== enemy) continue;
      if (pseudoMoves(board, rr, cc, enemy, true).some((m) => m.r === r && m.c === c)) return true;
    }
  }
  return false;
}
function findKing(board, color) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (p && p.type === "k" && p.color === color) return [r, c];
  }
  return null;
}
function applyMove(board, from, move, color) {
  const copy = cloneBoard(board);
  const piece = copy[from.r][from.c];
  copy[from.r][from.c] = null;
  if (move.kind === "enpassant") copy[color === "w" ? move.r + 1 : move.r - 1][move.c] = null;
  if (move.kind === "castle-k") {
    copy[move.r][5] = copy[move.r][7];
    copy[move.r][7] = null;
    if (copy[move.r][5]) copy[move.r][5].moved = true;
  }
  if (move.kind === "castle-q") {
    copy[move.r][3] = copy[move.r][0];
    copy[move.r][0] = null;
    if (copy[move.r][3]) copy[move.r][3].moved = true;
  }
  if (piece) {
    piece.moved = true;
    copy[move.r][move.c] = piece;
    if (piece.type === "p" && (move.r === 0 || move.r === 7)) piece.type = "q";
  }
  return copy;
}
function legalMovesForSquare(r, c, color = game.turn) {
  const piece = game.board[r][c];
  if (!piece || piece.color !== color) return [];
  return pseudoMoves(game.board, r, c, color, false).filter((m) => {
    const after = applyMove(game.board, { r, c }, m, color);
    const king = findKing(after, color);
    return king && !isSquareAttacked(after, king[0], king[1], color);
  });
}
function allLegalMoves(color) {
  const moves = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = game.board[r][c];
    if (!p || p.color !== color) continue;
    legalMovesForSquare(r, c, color).forEach((m) => moves.push({ from: { r, c }, move: m }));
  }
  return moves;
}


function snapshotState() {
  return JSON.parse(JSON.stringify({
    board: game.board,
    turn: game.turn,
    selected: game.selected,
    legalMoves: game.legalMoves,
    quantumMode: game.quantumMode,
    pendingQuantum: game.pendingQuantum,
    quantumPieces: game.quantumPieces,
    quantumUses: game.quantumUses,
    enPassantTarget: game.enPassantTarget,
    mode: game.mode,
    moveHistory: game.moveHistory,
    messageHistory: game.messageHistory,
    currentMessage: game.currentMessage,
    gameOver: game.gameOver,
    winModalOpen: !winModalEl.classList.contains("hidden"),
  }));
}

function restoreSnapshot(state) {
  game.board = state.board;
  game.turn = state.turn;
  game.selected = state.selected;
  game.legalMoves = state.legalMoves;
  game.quantumMode = state.quantumMode;
  game.pendingQuantum = state.pendingQuantum;
  game.quantumPieces = state.quantumPieces;
  game.quantumUses = state.quantumUses;
  game.enPassantTarget = state.enPassantTarget;
  game.mode = state.mode;
  modeEl.value = game.mode;
  game.moveHistory = state.moveHistory;
  game.messageHistory = state.messageHistory;
  game.currentMessage = state.currentMessage;
  game.gameOver = state.gameOver;
  if (state.winModalOpen) winModalEl.classList.remove("hidden");
  else winModalEl.classList.add("hidden");
}

function pushUndoSnapshot() {
  game.undoStack.push(snapshotState());
  if (game.undoStack.length > 200) game.undoStack.shift();
  game.redoStack = [];
}

function undoMove() {
  if (!game.undoStack.length) return;
  const current = snapshotState();
  const prev = game.undoStack.pop();
  game.redoStack.push(current);
  restoreSnapshot(prev);
  historyNeedsScrollToBottom = true;
  render();
}

function redoMove() {
  if (!game.redoStack.length) return;
  const current = snapshotState();
  const next = game.redoStack.pop();
  game.undoStack.push(current);
  restoreSnapshot(next);
  historyNeedsScrollToBottom = true;
  render();
}

function setMessage(msg) {
  game.currentMessage = msg;
  game.messageHistory.push(msg);
  historyNeedsScrollToBottom = true;
}

function showWinModal(text) {
  winTextEl.textContent = text;
  winModalEl.classList.remove("hidden");
}

function completeTurn(baseMessage = "") {
  game.turn = game.turn === "w" ? "b" : "w";
  game.selected = null;
  game.legalMoves = [];
  game.pendingQuantum = null;
  game.quantumMode = false;

  const opponentMoves = allLegalMoves(game.turn);
  const king = findKing(game.board, game.turn);
  const inCheck = king ? isSquareAttacked(game.board, king[0], king[1], game.turn) : false;

  if (!opponentMoves.length) {
    game.gameOver = true;
    if (inCheck) {
      const winner = game.turn === "w" ? "Black" : "White";
      setMessage(`Checkmate! ${winner} wins.`);
      showWinModal(`🎉 ${winner} wins Quantum Chess!`);
    } else setMessage("Stalemate.");
  } else if (inCheck) setMessage(baseMessage ? `${baseMessage} Check.` : "Check.");
  else if (baseMessage) setMessage(baseMessage);

  render();
  maybeAIMove();
}

function collapseForOwnerMovement(sourceSq) {
  const q = getQuantumAtSquare(sourceSq);
  if (!q) return false;
  const [r, c] = toCoord(sourceSq);
  game.board[r][c] = { type: q.type, color: q.color, moved: true };
  game.quantumPieces = game.quantumPieces.filter((qp) => qp.id !== q.id);
  return true;
}

function materializeBySelection(sourceSq) {
  pushUndoSnapshot();
  if (!collapseForOwnerMovement(sourceSq)) return false;
  playTone("quantumCollapse");
  completeTurn(`Waveform collapsed at ${sourceSq}.`);
  return true;
}

function tryCollapseOnCapture(targetSq) {
  const q = getQuantumAtSquare(targetSq);
  if (!q) return "";
  playTone("quantumCollapse");
  const survive = Math.random() < 0.5;
  const other = q.positions.find((s) => s !== targetSq);
  game.quantumPieces = game.quantumPieces.filter((qp) => qp.id !== q.id);
  if (survive && other) {
    const [or, oc] = toCoord(other);
    game.board[or][oc] = { type: q.type, color: q.color, moved: true };
    return `Waveform collapsed: piece survived at ${other}.`;
  }
  return `Waveform collapsed: piece was at ${targetSq} and got captured.`;
}

function executeMove(from, move) {
  if (game.gameOver) return false;
  pushUndoSnapshot();
  const piece = game.board[from.r][from.c];
  if (!piece) return false;

  const targetSq = toSquare(move.r, move.c);
  let collapseMsg = "";
  const targetPiece = pieceAt(game.board, move.r, move.c);
  if (targetPiece && targetPiece.quantumId) collapseMsg = tryCollapseOnCapture(targetSq);

  game.board = applyMove(game.board, from, move, game.turn);
  game.enPassantTarget = null;
  if (piece.type === "p" && move.kind === "double") {
    const passR = (from.r + move.r) / 2;
    game.enPassantTarget = toSquare(passR, from.c);
  }

  game.moveHistory.push(`${toSquare(from.r, from.c)}-${targetSq}`);
  playTone("move");
  completeTurn(collapseMsg);
  return true;
}

function createQuantumMove(from, toA, toB) {
  if (game.gameOver) return;
  pushUndoSnapshot();
  const piece = game.board[from.r][from.c];
  if (!piece) return;
  const id = `q${Date.now()}${Math.floor(Math.random() * 1e5)}`;
  const sqA = toSquare(toA.r, toA.c);
  const sqB = toSquare(toB.r, toB.c);

  game.board[from.r][from.c] = null;
  game.quantumPieces.push({ id, color: piece.color, type: piece.type, positions: [sqA, sqB], moved: true });

  game.quantumUses[game.turn] -= 1;
  playTone("quantumIgnite");
  completeTurn(`Quantum split created at ${sqA} and ${sqB}.`);
}

function squareClick(r, c) {
  if (game.gameOver) return;
  const sq = toSquare(r, c);
  const piece = game.board[r][c];

  if (game.selected && game.quantumMode && game.pendingQuantum) {
    const chosen = game.legalMoves.find((m) => m.r === r && m.c === c);
    if (chosen) {
      const exists = game.pendingQuantum.targets.find((t) => t.r === r && t.c === c);
      if (!exists) game.pendingQuantum.targets.push({ r, c });
      if (game.pendingQuantum.targets.length === 2) createQuantumMove(game.selected, game.pendingQuantum.targets[0], game.pendingQuantum.targets[1]);
      else {
        setMessage("Select a second legal destination to complete superposition.");
        render();
      }
      return;
    }
  }

  if (game.selected) {
    const move = game.legalMoves.find((m) => m.r === r && m.c === c);
    if (move && !game.quantumMode) return executeMove(game.selected, move);
  }

  const qPiece = getQuantumAtSquare(sq);
  if (qPiece && qPiece.color === game.turn) return materializeBySelection(sq);

  if (piece && piece.color === game.turn) {
    game.selected = { r, c };
    game.legalMoves = legalMovesForSquare(r, c);
    game.pendingQuantum = { targets: [] };
    playTone("select");
    setMessage(game.quantumMode ? "Choose two legal destination squares." : "Select destination.");
  } else {
    game.selected = null;
    game.legalMoves = [];
    game.pendingQuantum = null;
  }
  render();
}

function maybeAIMove() {
  if (game.mode !== "ai" || game.turn !== "b" || game.gameOver) return;
  setTimeout(() => {
    const moves = allLegalMoves("b");
    if (!moves.length) return;
    const captures = moves.filter((m) => !!pieceAt(game.board, m.move.r, m.move.c));
    const pool = captures.length ? captures : moves;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    executeMove(pick.from, pick.move);
  }, 320);
}

function renderMessageHistory() {
  messageHistoryEl.innerHTML = "";

  const liveLines = [
    `Turn: ${game.turn === "w" ? "White" : "Black"}`,
    `Quantum uses - White: ${game.quantumUses.w}, Black: ${game.quantumUses.b}`,
    game.currentMessage,
  ];

  liveLines.forEach((line) => {
    const el = document.createElement("div");
    el.className = "history-line";
    el.textContent = line;
    messageHistoryEl.appendChild(el);
  });

  game.messageHistory.forEach((line) => {
    const el = document.createElement("div");
    el.className = "history-line";
    el.textContent = line;
    messageHistoryEl.appendChild(el);
  });

  if (historyNeedsScrollToBottom) {
    messageHistoryEl.scrollTop = messageHistoryEl.scrollHeight;
    historyNeedsScrollToBottom = false;
  }
}

function render() {
  boardEl.innerHTML = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement("button");
      sq.className = `square ${(r + c) % 2 === 0 ? "light" : "dark"}`;
      sq.type = "button";
      const id = toSquare(r, c);
      if (game.selected && game.selected.r === r && game.selected.c === c) sq.classList.add("selected");
      if (game.legalMoves.some((m) => m.r === r && m.c === c)) sq.classList.add("hint");
      const pendingTargets = game.pendingQuantum ? game.pendingQuantum.targets : [];
      if (pendingTargets.some((t) => t.r === r && t.c === c)) sq.classList.add("quantum-target");

      const base = game.board[r][c];
      const qPiece = getQuantumAtSquare(id);
      if (base) {
        const span = document.createElement("span");
        span.className = "piece";
        span.textContent = PIECES[base.color][base.type];
        sq.appendChild(span);
      } else if (qPiece) {
        const span = document.createElement("span");
        span.className = "piece quantum";
        span.textContent = PIECES[qPiece.color][qPiece.type];
        sq.appendChild(span);
      }

      if (c === 0 || r === 7) {
        const lbl = document.createElement("span");
        lbl.className = "square-label";
        lbl.textContent = `${c === 0 ? 8 - r : ""}${r === 7 ? FILES[c] : ""}`;
        sq.appendChild(lbl);
      }

      sq.addEventListener("click", () => squareClick(r, c));
      boardEl.appendChild(sq);
    }
  }

  quantumToggleBtn.classList.toggle("on", game.quantumMode);
  quantumToggleBtn.setAttribute("aria-pressed", String(game.quantumMode));
  quantumToggleBtn.disabled = game.quantumUses[game.turn] <= 0 || game.gameOver;
  quantumCountEl.textContent = `${game.quantumUses[game.turn]} left`;
  undoBtn.disabled = game.undoStack.length === 0;
  redoBtn.disabled = game.redoStack.length === 0;
  renderMessageHistory();
}

quantumToggleBtn.addEventListener("click", () => {
  if (game.gameOver) return;
  if (game.quantumUses[game.turn] <= 0) return setMessage("No quantum opportunities left for this side."), render();
  pushUndoSnapshot();
  game.quantumMode = !game.quantumMode;
  game.pendingQuantum = game.quantumMode ? { targets: [] } : null;
  setMessage(game.quantumMode ? "Quantum mode on: select a piece, then two legal targets." : "Quantum mode off.");
  render();
});

historyUpBtn.addEventListener("click", () => {
  messageHistoryEl.scrollBy({ top: -40, behavior: "smooth" });
});
historyDownBtn.addEventListener("click", () => {
  messageHistoryEl.scrollBy({ top: 40, behavior: "smooth" });
});

undoBtn.addEventListener("click", () => {
  undoMove();
});

redoBtn.addEventListener("click", () => {
  redoMove();
});

modeEl.addEventListener("change", () => {
  game.mode = modeEl.value;
});

newGameBtn.addEventListener("click", () => {
  playTone("restart");
  game = initialGameState();
  game.mode = modeEl.value;
  winModalEl.classList.add("hidden");
  historyNeedsScrollToBottom = true;
  setMessage("New game started.");
  render();
});

closeModalBtn.addEventListener("click", () => {
  winModalEl.classList.add("hidden");
});

document.addEventListener("click", (event) => {
  const btn = event.target.closest("button");
  if (!btn || btn.classList.contains("square")) return;
  playTone("button");
});

function init() {
  game = initialGameState();
  historyNeedsScrollToBottom = true;
  render();
}

init();

/* 斗兽棋规则引擎（纯逻辑，零 DOM 依赖）
 * 浏览器：window.DSQ；Node：module.exports
 * 本文件与 packages/game-core/src/doushouqi-engine.cjs 必须逐字一致，由测试核对。
 *
 * 坐标约定：board[row][col]，row 0-8，col 0-6。row 0 为红方底线（显示在下方），row 8 为蓝方底线。
 * 河：rows 3-5 的 cols 1-2 与 4-5。兽穴：红 (0,3)，蓝 (8,3)。
 * 陷阱：红方 (0,2)(0,4)(1,3)，蓝方 (8,2)(8,4)(7,3)。
 * 棋子：'r1'..'r8' / 'b1'..'b8'，数字为兽力：1鼠 2猫 3狗 4狼 5豹 6虎 7狮 8象。
 *
 * 规则（标准斗兽棋，ruleVersion standard-1.0）：
 *  - 每步横竖走一格，不能斜走，不能进入己方兽穴。
 *  - 只有鼠能下河；狮、虎可横竖跳过整段河，河中有任何棋子时不能跳。
 *  - 兽力大于等于对方可吃；鼠能吃象，象不能吃鼠。
 *  - 河里与岸上的棋子不能互吃（河中鼠只能被河中鼠吃）。
 *  - 落入对方陷阱的棋子兽力视为 0，任何对方棋子都能吃（含象吃陷阱中的鼠）。
 *  - 进入对方兽穴、吃光对方棋子，或使对方无子可走，即获胜。
 */
(function (root) {
  'use strict';

  var RED = 'r', BLUE = 'b', ROWS = 9, COLS = 7;
  var NAMES = { 1: '鼠', 2: '猫', 3: '狗', 4: '狼', 5: '豹', 6: '虎', 7: '狮', 8: '象' };
  var EMOJI = { 1: '🐭', 2: '🐱', 3: '🐶', 4: '🐺', 5: '🐆', 6: '🐯', 7: '🦁', 8: '🐘' };
  var VALUES = { 1: 500, 2: 200, 3: 250, 4: 300, 5: 450, 6: 750, 7: 850, 8: 950 };
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var WIN = 1000000;

  function sideOf(p) { return p ? p.charAt(0) : null; }
  function rankOf(p) { return p ? Number(p.charAt(1)) : 0; }
  function opp(side) { return side === RED ? BLUE : RED; }
  function onBoard(r, c) {
    return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }
  function isWater(r, c) { return r >= 3 && r <= 5 && (c === 1 || c === 2 || c === 4 || c === 5); }
  function denOwner(r, c) { return c === 3 && r === 0 ? RED : (c === 3 && r === 8 ? BLUE : null); }
  function trapOwner(r, c) {
    if ((r === 0 && (c === 2 || c === 4)) || (r === 1 && c === 3)) { return RED; }
    if ((r === 8 && (c === 2 || c === 4)) || (r === 7 && c === 3)) { return BLUE; }
    return null;
  }

  function emptyBoard() {
    var b = [], r, c;
    for (r = 0; r < ROWS; r++) { b.push([]); for (c = 0; c < COLS; c++) { b[r].push(null); } }
    return b;
  }

  // 标准开局：两方中心对称。红方从自己视角看，左角虎、右角狮，前排左象右鼠。
  function initialBoard() {
    var b = emptyBoard();
    var red = [[0, 0, 6], [0, 6, 7], [1, 1, 2], [1, 5, 3], [2, 0, 8], [2, 2, 4], [2, 4, 5], [2, 6, 1]];
    red.forEach(function (x) {
      b[x[0]][x[1]] = RED + x[2];
      b[ROWS - 1 - x[0]][COLS - 1 - x[1]] = BLUE + x[2];
    });
    return b;
  }

  function cloneBoard(b) { return b.map(function (row) { return row.slice(); }); }

  /* ---------------- 吃子与走子 ---------------- */

  function canCapture(attacker, fr, fc, defender, tr, tc) {
    if (isWater(fr, fc) !== isWater(tr, tc)) { return false; }      // 河岸不互吃
    if (trapOwner(tr, tc) === sideOf(attacker)) { return true; }    // 对方落入我方陷阱
    var a = rankOf(attacker), d = rankOf(defender);
    if (a === 1 && d === 8) { return true; }                         // 鼠吃象
    if (a === 8 && d === 1) { return false; }                        // 象不吃鼠
    return a >= d;
  }

  function canEnter(board, fr, fc, tr, tc) {
    var p = board[fr][fc], side = sideOf(p);
    if (denOwner(tr, tc) === side) { return false; }
    var q = board[tr][tc];
    if (!q) { return true; }
    if (sideOf(q) === side) { return false; }
    return canCapture(p, fr, fc, q, tr, tc);
  }

  function movesFor(board, r, c) {
    var out = [];
    if (!onBoard(r, c) || !board || !Array.isArray(board[r])) { return out; }
    var p = board[r][c];
    if (!p) { return out; }
    var rank = rankOf(p);
    DIRS.forEach(function (d) {
      var tr = r + d[0], tc = c + d[1];
      if (!onBoard(tr, tc)) { return; }
      if (isWater(tr, tc) && rank !== 1) {
        if (rank !== 6 && rank !== 7) { return; }
        // 狮虎跳河：沿直线越过整段河，途中不能有任何棋子
        while (onBoard(tr, tc) && isWater(tr, tc)) {
          if (board[tr][tc]) { return; }
          tr += d[0]; tc += d[1];
        }
        if (!onBoard(tr, tc)) { return; }
      }
      if (canEnter(board, r, c, tr, tc)) { out.push({ fr: r, fc: c, tr: tr, tc: tc }); }
    });
    return out;
  }

  function legalMoves(board, side) {
    var out = [], r, c;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        if (board[r][c] && sideOf(board[r][c]) === side) { out = out.concat(movesFor(board, r, c)); }
      }
    }
    return out;
  }

  function makeMove(board, m) {
    var captured = board[m.tr][m.tc];
    board[m.tr][m.tc] = board[m.fr][m.fc];
    board[m.fr][m.fc] = null;
    return captured;
  }

  function unmakeMove(board, m, captured) {
    board[m.fr][m.fc] = board[m.tr][m.tc];
    board[m.tr][m.tc] = captured || null;
  }

  function applyMove(board, m) { var nb = cloneBoard(board); makeMove(nb, m); return nb; }

  /* ---------------- 终局判定 ---------------- */

  // 只看兽穴与棋子数；无子可走另行判断
  function winnerOf(board) {
    var inBlueDen = board[8][3], inRedDen = board[0][3];
    if (inBlueDen && sideOf(inBlueDen) === RED) { return { winner: RED, reason: 'den' }; }
    if (inRedDen && sideOf(inRedDen) === BLUE) { return { winner: BLUE, reason: 'den' }; }
    var red = 0, blue = 0, r, c;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        if (board[r][c]) { if (sideOf(board[r][c]) === RED) { red++; } else { blue++; } }
      }
    }
    if (!red) { return { winner: BLUE, reason: 'captured' }; }
    if (!blue) { return { winner: RED, reason: 'captured' }; }
    return null;
  }

  function gameStatus(board, sideToMove) {
    var w = winnerOf(board);
    if (w) { return { over: true, winner: w.winner, reason: w.reason }; }
    if (!legalMoves(board, sideToMove).length) { return { over: true, winner: opp(sideToMove), reason: 'no-moves' }; }
    return { over: false, winner: null, reason: null };
  }

  /* ---------------- 对局状态 + 统一走子入口 ---------------- */

  // 状态对象：联机/单机共用的唯一权威形态。只能由 safeApplyMove 产生新状态，禁止原地修改。
  function createInitialState() {
    return { board: initialBoard(), turn: RED, over: false, winner: null, reason: null, version: 0, lastMove: null };
  }

  function validState(state) {
    return !!state && (state.turn === RED || state.turn === BLUE) &&
      Number.isInteger(state.version) && state.version >= 0 &&
      Array.isArray(state.board) && state.board.length === ROWS &&
      state.board.every(function (row) {
        return Array.isArray(row) && row.length === COLS && row.every(function (p) {
          return p === null || (typeof p === 'string' && /^[rb][1-8]$/.test(p));
        });
      });
  }

  // 返回 { ok: true, state: 新状态 } 或 { ok: false, code: 错误码 }
  // 错误码：GAME_OVER / BAD_STATE / NOT_YOUR_TURN / BAD_COORDS / NOT_YOUR_PIECE / ILLEGAL_MOVE
  function safeApplyMove(state, actorSide, move) {
    if (!state || state.over) { return { ok: false, code: 'GAME_OVER' }; }
    if (!validState(state)) { return { ok: false, code: 'BAD_STATE' }; }
    if (actorSide !== state.turn) { return { ok: false, code: 'NOT_YOUR_TURN' }; }
    if (!move || !onBoard(move.fr, move.fc) || !onBoard(move.tr, move.tc)) { return { ok: false, code: 'BAD_COORDS' }; }
    var piece = state.board[move.fr][move.fc];
    if (!piece || sideOf(piece) !== actorSide) { return { ok: false, code: 'NOT_YOUR_PIECE' }; }
    var legal = movesFor(state.board, move.fr, move.fc).some(function (m) { return m.tr === move.tr && m.tc === move.tc; });
    if (!legal) { return { ok: false, code: 'ILLEGAL_MOVE' }; }
    var nb = applyMove(state.board, move);
    var st = gameStatus(nb, opp(state.turn));
    return {
      ok: true,
      state: {
        board: nb, turn: opp(state.turn), over: st.over, winner: st.winner, reason: st.reason,
        version: state.version + 1, lastMove: { fr: move.fr, fc: move.fc, tr: move.tr, tc: move.tc }
      }
    };
  }

  /* ---------------- 电脑对手（α-β 搜索，纯函数） ---------------- */

  function evaluate(board, side) {
    var score = 0, r, c, p, s, rank, den, dist;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        p = board[r][c];
        if (!p) { continue; }
        s = sideOf(p); rank = rankOf(p);
        den = s === RED ? { r: 8, c: 3 } : { r: 0, c: 3 };
        dist = Math.abs(r - den.r) + Math.abs(c - den.c);
        var v = VALUES[rank] + (14 - dist) * (rank === 1 ? 4 : 8);
        if (dist === 1) { v += 400; }
        if (trapOwner(r, c) === opp(s)) { v += 120; }      // 压到对方陷阱，逼近兽穴
        score += s === side ? v : -v;
      }
    }
    return score;
  }

  function ordered(board, side) {
    var moves = legalMoves(board, side);
    moves.forEach(function (m) {
      var q = board[m.tr][m.tc];
      m.k = (denOwner(m.tr, m.tc) === opp(side) ? 100000 : 0) + (q ? VALUES[rankOf(q)] * 10 - rankOf(board[m.fr][m.fc]) : 0);
    });
    moves.sort(function (a, b) { return b.k - a.k; });
    return moves;
  }

  function negamax(board, side, depth, alpha, beta, ctx, ply) {
    ctx.nodes++;
    var w = winnerOf(board);
    if (w) { return w.winner === side ? WIN - ply : -(WIN - ply); }
    if (depth === 0 || ctx.nodes > ctx.max) { if (ctx.nodes > ctx.max) { ctx.stop = true; } return evaluate(board, side); }
    var moves = ordered(board, side);
    if (!moves.length) { return -(WIN - ply); }
    var best = -Infinity, i, m, cap, v;
    for (i = 0; i < moves.length; i++) {
      m = moves[i];
      cap = makeMove(board, m);
      v = -negamax(board, opp(side), depth - 1, -beta, -alpha, ctx, ply + 1);
      unmakeMove(board, m, cap);
      if (v > best) { best = v; }
      if (v > alpha) { alpha = v; }
      if (alpha >= beta || ctx.stop) { break; }
    }
    return best;
  }

  // options: { depth: 最大搜索层数（默认 4）, maxNodes: 节点上限（默认 60000） }
  function bestMove(state, side, options) {
    if (!validState(state) || state.over || state.turn !== side) { return null; }
    var depthLimit = (options && options.depth) || 4, max = (options && options.maxNodes) || 60000;
    var board = cloneBoard(state.board), root = ordered(board, side);
    if (!root.length) { return null; }
    var best = root[0], ctx = { nodes: 0, max: max, stop: false }, depth, i, m, cap, v, iterBest, iterScore;
    for (depth = 1; depth <= depthLimit; depth++) {
      iterBest = null; iterScore = -Infinity;
      var alpha = -Infinity;
      for (i = 0; i < root.length; i++) {
        m = root[i];
        cap = makeMove(board, m);
        v = -negamax(board, opp(side), depth - 1, -Infinity, -alpha, ctx, 1);
        unmakeMove(board, m, cap);
        if (ctx.stop) { break; }
        if (v > iterScore) { iterScore = v; iterBest = m; }
        if (v > alpha) { alpha = v; }
      }
      if (ctx.stop) { break; }
      if (iterBest) {
        best = iterBest;
        root.splice(root.indexOf(iterBest), 1); root.unshift(iterBest);   // 上一层最好的先搜
        if (iterScore >= WIN - 100) { break; }                              // 已找到必胜
      }
    }
    return { fr: best.fr, fc: best.fc, tr: best.tr, tc: best.tc };
  }

  var DSQ = {
    RED: RED, BLUE: BLUE, ROWS: ROWS, COLS: COLS,
    NAMES: NAMES, EMOJI: EMOJI, VALUES: VALUES,
    sideOf: sideOf, rankOf: rankOf, opp: opp, onBoard: onBoard,
    isWater: isWater, denOwner: denOwner, trapOwner: trapOwner,
    emptyBoard: emptyBoard, initialBoard: initialBoard, cloneBoard: cloneBoard,
    canCapture: canCapture, movesFor: movesFor, legalMoves: legalMoves,
    makeMove: makeMove, unmakeMove: unmakeMove, applyMove: applyMove,
    winnerOf: winnerOf, gameStatus: gameStatus,
    createInitialState: createInitialState, safeApplyMove: safeApplyMove,
    evaluate: evaluate, bestMove: bestMove
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = DSQ; }
  root.DSQ = DSQ;
})(typeof window !== 'undefined' ? window : globalThis);

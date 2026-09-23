// ============================================================
// bracket-engine.js
//
// 純賽程演算法
// 不碰 D1、不碰 Cloudflare、不碰排行榜
//
// 支援：
//   - 2 ~ 48 人
//   - single_elimination 單淘汰
//   - double_elimination 雙敗
//
// 回傳：
// {
//   matches: [
//     {
//       id,
//       bracket,
//       round,
//       position,
//       participant1,
//       participant2,
//       winner,
//       status,
//       isByeMatch,
//       isGrandFinal,
//       isResetMatch,
//       nextMatchId,
//       nextMatchSlot,
//       loserNextMatchId,
//       loserNextMatchSlot
//     }
//   ]
// }
// ============================================================


// ============================================================
// 對外入口
// ============================================================

export function generateBracket(participants, format) {
  if (!Array.isArray(participants)) {
    throw new Error("參賽者資料格式錯誤");
  }

  if (participants.length < 2 || participants.length > 48) {
    throw new Error("參賽人數需介於 2 到 48 人");
  }

  if (
    format !== "single_elimination" &&
    format !== "double_elimination"
  ) {
    throw new Error("不支援的賽制");
  }

  if (format === "single_elimination") {
    return generateSingleElimination(participants);
  }

  return generateDoubleElimination(participants);
}


// ============================================================
// 單淘汰
// ============================================================

function generateSingleElimination(participants) {
  const size = participants.length;

  // 找到下一個 >= 參賽人數的 2 的次方
  const bracketSize = nextPowerOfTwo(size);

  const rounds = Math.log2(bracketSize);

  const matches = [];
  let matchCounter = 1;

  // ----------------------------------------------------------
  // 第一輪
  // ----------------------------------------------------------

  const firstRoundCount = bracketSize / 2;

  const firstRoundParticipants =
    buildSeedSlots(participants, bracketSize);

  for (let position = 1; position <= firstRoundCount; position++) {
    const p1 =
      firstRoundParticipants[(position - 1) * 2] || null;

    const p2 =
      firstRoundParticipants[(position - 1) * 2 + 1] || null;

    const match = {
      id: `W-R1-M${position}`,
      bracket: "winners",
      round: 1,
      position,

      participant1: p1,
      participant2: p2,

      winner: null,

      status: "pending",

      isByeMatch: false,
      isGrandFinal: false,
      isResetMatch: false,

      nextMatchId: null,
      nextMatchSlot: null,

      loserNextMatchId: null,
      loserNextMatchSlot: null
    };

    // --------------------------------------------------------
    // Bye
    // --------------------------------------------------------

    if (p1 && !p2) {
      match.isByeMatch = true;
      match.status = "completed";
      match.winner = p1;
    }

    if (!p1 && p2) {
      match.isByeMatch = true;
      match.status = "completed";
      match.winner = p2;
    }

    // 完全空場
    if (!p1 && !p2) {
      match.status = "void";
    }

    matches.push(match);
  }

  // ----------------------------------------------------------
  // 第二輪開始建立
  // ----------------------------------------------------------

  for (let round = 2; round <= rounds; round++) {
    const matchCount =
      bracketSize / Math.pow(2, round);

    for (
      let position = 1;
      position <= matchCount;
      position++
    ) {
      matches.push({
        id: `W-R${round}-M${position}`,

        bracket: "winners",

        round,

        position,

        participant1: null,
        participant2: null,

        winner: null,

        status: "pending",

        isByeMatch: false,
        isGrandFinal: false,
        isResetMatch: false,

        nextMatchId: null,
        nextMatchSlot: null,

        loserNextMatchId: null,
        loserNextMatchSlot: null
      });
    }
  }

  // ----------------------------------------------------------
  // 建立勝者晉級關係
  // ----------------------------------------------------------

  for (const match of matches) {
    if (match.round >= rounds) {
      continue;
    }

    const nextPosition =
      Math.ceil(match.position / 2);

    const nextMatch =
      matches.find(
        (m) =>
          m.bracket === "winners" &&
          m.round === match.round + 1 &&
          m.position === nextPosition
      );

    if (!nextMatch) {
      continue;
    }

    match.nextMatchId = nextMatch.id;

    match.nextMatchSlot =
      match.position % 2 === 1
        ? 1
        : 2;
  }

  // ----------------------------------------------------------
  // Bye 可能直接造成下一場只有一位選手
  //
  // 這裡先處理「演算法層級」的連鎖 Bye。
  //
  // D1 寫入後 tournaments.js 的 Phase C
  // 還會再次確保資料庫狀態正確。
  // ----------------------------------------------------------

  propagateInitialByes(matches);

  return {
    matches,
    size: bracketSize
  };
}


// ============================================================
// 建立種子位置
//
// 這裡採用標準的 seed pairing：
// 1 vs N
// 2 vs N-1
// ...
//
// 如果人數不足 2 的次方,
// 空位自然形成 Bye。
// ============================================================

function buildSeedSlots(participants, bracketSize) {
  const slots = new Array(bracketSize).fill(null);

  const orderedSeeds =
    buildSeedOrder(bracketSize);

  for (
    let i = 0;
    i < participants.length;
    i++
  ) {
    const seed =
      Number(participants[i].id);

    const slotIndex =
      orderedSeeds.indexOf(seed);

    if (slotIndex !== -1) {
      slots[slotIndex] =
        participants[i];
    }
  }

  return slots;
}


// ============================================================
// 標準種子排列
//
// 例如 8 人：
//
// 1
// 8
// 4
// 5
// 2
// 7
// 3
// 6
//
// 形成：
// 1 vs 8
// 4 vs 5
// 2 vs 7
// 3 vs 6
// ============================================================

function buildSeedOrder(size) {
  if (size === 2) {
    return [1, 2];
  }

  let order = [1, 2];

  while (order.length < size) {
    const nextSize =
      order.length * 2;

    const next = [];

    for (const seed of order) {
      next.push(seed);
      next.push(nextSize + 1 - seed);
    }

    order = next;
  }

  return order;
}


// ============================================================
// 處理初始 Bye
//
// 注意：
//
// 這裡只負責 bracket engine 裡的資料結構。
// 真正寫入 D1 後,
// tournaments.js 還會再執行一次 Phase C,
// 確保 Bye 勝者進入下一場。
// ============================================================

function propagateInitialByes(matches) {
  let changed = true;

  while (changed) {
    changed = false;

    for (const match of matches) {
      if (
        !match.isByeMatch ||
        match.status !== "completed" ||
        !match.winner ||
        !match.nextMatchId
      ) {
        continue;
      }

      const nextMatch =
        matches.find(
          (m) =>
            m.id === match.nextMatchId
        );

      if (!nextMatch) {
        continue;
      }

      const slot =
        match.nextMatchSlot;

      const alreadyThere =
        slot === 1
          ? nextMatch.participant1
          : nextMatch.participant2;

      if (!alreadyThere) {
        if (slot === 1) {
          nextMatch.participant1 =
            match.winner;
        } else {
          nextMatch.participant2 =
            match.winner;
        }

        changed = true;
      }

      const p1 =
        nextMatch.participant1;

      const p2 =
        nextMatch.participant2;

      // ------------------------------------------------------
      // 如果下一場也只剩一個人
      // → 自動 Bye
      // ------------------------------------------------------

      if (
        (p1 && !p2) ||
        (!p1 && p2)
      ) {
        nextMatch.isByeMatch = true;
        nextMatch.status = "completed";
        nextMatch.winner =
          p1 || p2;
      }

      // ------------------------------------------------------
      // 兩個人都到位
      // ------------------------------------------------------

      if (p1 && p2) {
        nextMatch.status = "ready";
      }
    }
  }
}


// ============================================================
// 雙敗
//
// 這裡採用：
//
// Winners Bracket
// +
// Losers Bracket
// +
// Grand Final
// +
// Grand Final Reset
//
// 注意：雙敗的實際敗部配對會比單淘汰複雜,
// 但所有 Match 都會先建立好,
// tournaments.js 負責實際比賽結果傳遞。
// ============================================================

function generateDoubleElimination(participants) {
  const single =
    generateSingleElimination(participants);

  const winnersMatches =
    single.matches.map((match) => ({
      ...match,
      bracket: "winners"
    }));

  const bracketSize =
    single.size;

  const winnersRounds =
    Math.log2(bracketSize);

  const matches = [
    ...winnersMatches
  ];

  // ----------------------------------------------------------
  // 建立敗部
  //
  // 對於 N = 2^k 的標準雙敗賽制：
  //
  // Losers rounds = 2 * (k - 1)
  //
  // 例如 8 人：
  // Winners = 3 rounds
  // Losers  = 4 rounds
  // ----------------------------------------------------------

  let losersRoundCount =
    Math.max(
      1,
      (winnersRounds - 1) * 2
    );

  let losersPositionCounter = 1;

  for (
    let round = 1;
    round <= losersRoundCount;
    round++
  ) {
    const matchesThisRound =
      getLosersMatchCount(
        bracketSize,
        round
      );

    for (
      let position = 1;
      position <= matchesThisRound;
      position++
    ) {
      matches.push({
        id: `L-R${round}-M${position}`,

        bracket: "losers",

        round,

        position,

        participant1: null,
        participant2: null,

        winner: null,

        status: "pending",

        isByeMatch: false,
        isGrandFinal: false,
        isResetMatch: false,

        nextMatchId: null,
        nextMatchSlot: null,

        loserNextMatchId: null,
        loserNextMatchSlot: null
      });

      losersPositionCounter++;
    }
  }

  // ----------------------------------------------------------
  // 建立敗部內部晉級
  // ----------------------------------------------------------

  const losersMatches =
    matches.filter(
      (m) =>
        m.bracket === "losers"
    );

  for (
    let i = 0;
    i < losersMatches.length;
    i++
  ) {
    const match =
      losersMatches[i];

    const next =
      losersMatches.find(
        (m) =>
          m.round ===
            match.round + 1 &&
          m.position ===
            getLosersNextPosition(
              match.position,
              match.round
            )
      );

    if (!next) {
      continue;
    }

    match.nextMatchId =
      next.id;

    match.nextMatchSlot =
      getLosersNextSlot(
        match.position,
        match.round
      );
  }

  // ----------------------------------------------------------
  // Winners → Losers
  //
  // 這裡建立敗者出口。
  // 實際敗者落點依勝部輪次安排。
  // ----------------------------------------------------------

  for (const winnerMatch of winnersMatches) {
    const target =
      findLosersDropTarget(
        losersMatches,
        winnerMatch.round,
        winnerMatch.position
      );

    if (!target) {
      continue;
    }

    winnerMatch.loserNextMatchId =
      target.match.id;

    winnerMatch.loserNextMatchSlot =
      target.slot;
  }

  // ----------------------------------------------------------
  // Grand Final
  // ----------------------------------------------------------

  const grandFinalRound =
    1;

  matches.push({
    id: "GF-R1-M1",

    bracket: "grand_final",

    round: grandFinalRound,

    position: 1,

    participant1: null,
    participant2: null,

    winner: null,

    status: "pending",

    isByeMatch: false,
    isGrandFinal: true,
    isResetMatch: false,

    nextMatchId: null,
    nextMatchSlot: null,

    loserNextMatchId: null,
    loserNextMatchSlot: null
  });

  // ----------------------------------------------------------
  // Grand Final Reset
  // ----------------------------------------------------------

  matches.push({
    id: "GF-R1-M2",

    bracket: "grand_final",

    round: grandFinalRound,

    position: 2,

    participant1: null,
    participant2: null,

    winner: null,

    status: "pending",

    isByeMatch: false,
    isGrandFinal: true,
    isResetMatch: true,

    nextMatchId: null,
    nextMatchSlot: null,

    loserNextMatchId: null,
    loserNextMatchSlot: null
  });

  // ----------------------------------------------------------
  // 勝部冠軍 → Grand Final P1
  // ----------------------------------------------------------

  const winnersFinal =
    winnersMatches.find(
      (m) =>
        m.round === winnersRounds
    );

  if (winnersFinal) {
    winnersFinal.nextMatchId =
      "GF-R1-M1";

    winnersFinal.nextMatchSlot = 1;
  }

  // ----------------------------------------------------------
  // 敗部冠軍 → Grand Final P2
  // ----------------------------------------------------------

  const losersFinal =
    losersMatches
      .filter(
        (m) =>
          m.round ===
          losersRoundCount
      )
      .sort(
        (a, b) =>
          a.position - b.position
      )
      .pop();

  if (losersFinal) {
    losersFinal.nextMatchId =
      "GF-R1-M1";

    losersFinal.nextMatchSlot = 2;
  }

  // ----------------------------------------------------------
  // Grand Final → Reset
  // ----------------------------------------------------------

  const grandFinal =
    matches.find(
      (m) =>
        m.id === "GF-R1-M1"
    );

  if (grandFinal) {
    grandFinal.nextMatchId =
      "GF-R1-M2";

    grandFinal.nextMatchSlot = 1;
  }

  return {
    matches,
    size: bracketSize
  };
}


// ============================================================
// 找敗部每輪場數
// ============================================================

function getLosersMatchCount(
  bracketSize,
  round
) {
  const winnersRounds =
    Math.log2(bracketSize);

  if (round > (winnersRounds - 1) * 2) {
    return 0;
  }

  // 前半段敗部輪次場數較多
  const group =
    Math.ceil(
      round / 2
    );

  const base =
    bracketSize /
    Math.pow(
      2,
      group
    );

  if (round % 2 === 1) {
    return Math.max(
      1,
      base
    );
  }

  return Math.max(
    1,
    base / 2
  );
}


// ============================================================
// 敗部下一場位置
// ============================================================

function getLosersNextPosition(
  position,
  round
) {
  if (round % 2 === 1) {
    return Math.ceil(
      position / 2
    );
  }

  return position;
}


// ============================================================
// 敗部下一場 Slot
// ============================================================

function getLosersNextSlot(
  position,
  round
) {
  if (round % 2 === 1) {
    return position % 2 === 1
      ? 1
      : 2;
  }

  return 1;
}


// ============================================================
// Winners → Losers 的出口
// ============================================================

function findLosersDropTarget(
  losersMatches,
  winnersRound,
  winnersPosition
) {
  if (!losersMatches.length) {
    return null;
  }

  const candidates =
    losersMatches.filter(
      (m) =>
        m.round ===
        Math.max(
          1,
          winnersRound * 2 - 2
        )
    );

  if (!candidates.length) {
    return null;
  }

  const index =
    (winnersPosition - 1) %
    candidates.length;

  const match =
    candidates[index];

  return {
    match,
    slot:
      winnersPosition % 2 === 1
        ? 1
        : 2
  };
}


// ============================================================
// 找下一個 2 的次方
// ============================================================

function nextPowerOfTwo(number) {
  let value = 1;

  while (value < number) {
    value *= 2;
  }

  return value;
}

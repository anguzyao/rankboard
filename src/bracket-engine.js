// ============================================================
// bracket-engine.js
//
// 純賽程演算法
// 2 ~ 48 人
// single_elimination
// double_elimination
//
// 不碰 D1
// 不碰 Cloudflare
// 不碰排行榜
//
// 雙敗結構：
//
// Winners Bracket
// +
// Losers Bracket
// +
// Grand Final
// +
// Grand Final Reset
// ============================================================


let idCounter = 0;


// ============================================================
// 對外入口
// ============================================================

export function generateBracket(
  participants,
  format
) {

  if (!Array.isArray(participants)) {

    throw new Error(
      "參賽者資料格式錯誤"
    );

  }


  if (
    participants.length < 2 ||
    participants.length > 48
  ) {

    throw new Error(
      "參賽人數需介於 2 到 48 人"
    );

  }


  if (
    ![
      "single_elimination",
      "double_elimination"
    ].includes(format)
  ) {

    throw new Error(
      "不支援的賽制"
    );

  }


  idCounter = 0;


  if (
    format ===
    "single_elimination"
  ) {

    return generateSingleElimination(
      participants
    );

  }


  return generateDoubleElimination(
    participants
  );

}


// ============================================================
// ID
// ============================================================

function nextId(
  prefix
) {

  idCounter += 1;

  return `${prefix}-${idCounter}`;

}


// ============================================================
// 找下一個 2 的次方
// ============================================================

function nextPowerOfTwo(
  number
) {

  let value = 1;


  while (
    value < number
  ) {

    value *= 2;

  }


  return value;

}


// ============================================================
// 標準種子排列
//
// 8 人：
//
// 1
// 8
// 4
// 5
// 2
// 7
// 3
// 6
// ============================================================

function buildSeedOrder(
  size
) {

  if (
    size === 1
  ) {

    return [1];

  }


  if (
    size === 2
  ) {

    return [1, 2];

  }


  let order = [
    1,
    2
  ];


  while (
    order.length < size
  ) {

    const nextSize =
      order.length * 2;


    const next = [];


    for (
      const seed of order
    ) {

      next.push(
        seed
      );

      next.push(
        nextSize + 1 - seed
      );

    }


    order = next;

  }


  return order;

}


// ============================================================
// 建立種子位置
// ============================================================

function buildSeedSlots(
  participants,
  bracketSize
) {

  const slots =
    new Array(
      bracketSize
    ).fill(null);


  const order =
    buildSeedOrder(
      bracketSize
    );


  for (
    const participant of participants
  ) {

    const index =
      order.indexOf(
        Number(
          participant.id
        )
      );


    if (
      index >= 0
    ) {

      slots[index] =
        participant;

    }

  }


  return slots;

}


// ============================================================
// Match Factory
// ============================================================

function makeMatch({

  id,

  bracket,

  round,

  position,

  participant1 =
    null,

  participant2 =
    null,

  winner =
    null,

  status =
    "pending",

  isByeMatch =
    false,

  isGrandFinal =
    false,

  isResetMatch =
    false

}) {

  return {

    id,

    bracket,

    round,

    position,

    participant1,

    participant2,

    winner,

    status,

    isByeMatch,

    isGrandFinal,

    isResetMatch,

    nextMatchId:
      null,

    nextMatchSlot:
      null,

    loserNextMatchId:
      null,

    loserNextMatchSlot:
      null

  };

}


// ============================================================
// 找 Match
// ============================================================

function findMatch(
  matches,
  bracket,
  round,
  position
) {

  return matches.find(
    (match) =>

      match.bracket ===
        bracket &&

      Number(
        match.round
      ) ===
        Number(
          round
        ) &&

      Number(
        match.position
      ) ===
        Number(
          position
        )

  );

}


// ============================================================
// 單淘汰
// ============================================================

function generateSingleElimination(
  participants
) {

  const bracketSize =
    nextPowerOfTwo(
      participants.length
    );


  const rounds =
    Math.log2(
      bracketSize
    );


  const slots =
    buildSeedSlots(
      participants,
      bracketSize
    );


  const matches = [];


  // ----------------------------------------------------------
  // 建立所有 Winners Match
  // ----------------------------------------------------------

  for (
    let round = 1;
    round <= rounds;
    round++
  ) {

    const matchCount =
      bracketSize /
      Math.pow(
        2,
        round
      );


    for (
      let position = 1;
      position <= matchCount;
      position++
    ) {

      let participant1 =
        null;

      let participant2 =
        null;

      let winner =
        null;

      let status =
        "pending";

      let isByeMatch =
        false;


      if (
        round === 1
      ) {

        participant1 =
          slots[
            (position - 1) * 2
          ] || null;


        participant2 =
          slots[
            (position - 1) * 2 + 1
          ] || null;


        if (
          participant1 &&
          participant2
        ) {

          status =
            "ready";

        } else if (
          participant1 ||
          participant2
        ) {

          isByeMatch =
            true;

          status =
            "completed";

          winner =
            participant1 ||
            participant2;

        } else {

          status =
            "void";

        }

      }


      matches.push(
        makeMatch({

          id:
            nextId(
              "W"
            ),

          bracket:
            "winners",

          round,

          position,

          participant1,

          participant2,

          winner,

          status,

          isByeMatch

        })
      );

    }

  }


  connectWinners(
    matches,
    rounds
  );


  propagateInitialByes(
    matches
  );


  return {

    matches,

    size:
      bracketSize

  };

}


// ============================================================
// Winners → Winners
// ============================================================

function connectWinners(
  matches,
  rounds
) {

  const winners =
    matches.filter(
      (match) =>
        match.bracket ===
        "winners"
    );


  for (
    const match of winners
  ) {

    if (
      match.round >= rounds
    ) {

      continue;

    }


    const nextPosition =
      Math.ceil(
        match.position / 2
      );


    const target =
      findMatch(

        matches,

        "winners",

        match.round + 1,

        nextPosition

      );


    if (!target) {

      continue;

    }


    match.nextMatchId =
      target.id;


    match.nextMatchSlot =
      match.position % 2 === 1
        ? 1
        : 2;

  }

}


// ============================================================
// 單淘汰初始 BYE 連鎖
// ============================================================

function propagateInitialByes(
  matches
) {

  let changed =
    true;


  while (
    changed
  ) {

    changed =
      false;


    for (
      const match of matches
    ) {

      if (
        !match.isByeMatch ||
        match.status !==
          "completed" ||
        !match.winner ||
        !match.nextMatchId
      ) {

        continue;

      }


      const target =
        matches.find(
          (item) =>
            item.id ===
            match.nextMatchId
        );


      if (!target) {

        continue;

      }


      if (
        match.nextMatchSlot === 1 &&
        !target.participant1
      ) {

        target.participant1 =
          match.winner;

        changed =
          true;

      }


      if (
        match.nextMatchSlot === 2 &&
        !target.participant2
      ) {

        target.participant2 =
          match.winner;

        changed =
          true;

      }


      const p1 =
        target.participant1;


      const p2 =
        target.participant2;


      if (
        p1 &&
        p2
      ) {

        if (
          !target.isByeMatch
        ) {

          target.status =
            "ready";

        }

      } else if (
        p1 ||
        p2
      ) {

        target.isByeMatch =
          true;

        target.status =
          "completed";

        target.winner =
          p1 || p2;

      }

    }

  }

}


// ============================================================
// 雙敗
//
// 8 人：
//
// Winners
// R1 = 4
// R2 = 2
// R3 = 1
//
// Losers
// R1 = 2
// R2 = 2
// R3 = 1
// R4 = 1
//
// Grand Final
// Reset
// ============================================================

function generateDoubleElimination(
  participants
) {

  const bracketSize =
    nextPowerOfTwo(
      participants.length
    );


  const winnersRounds =
    Math.log2(
      bracketSize
    );


  const slots =
    buildSeedSlots(
      participants,
      bracketSize
    );


  const matches = [];


  // ==========================================================
  // 1. Winners Bracket
  // ==========================================================

  for (
    let round = 1;
    round <= winnersRounds;
    round++
  ) {

    const matchCount =
      bracketSize /
      Math.pow(
        2,
        round
      );


    for (
      let position = 1;
      position <= matchCount;
      position++
    ) {

      let participant1 =
        null;

      let participant2 =
        null;

      let winner =
        null;

      let status =
        "pending";

      let isByeMatch =
        false;


      if (
        round === 1
      ) {

        participant1 =
          slots[
            (position - 1) * 2
          ] || null;


        participant2 =
          slots[
            (position - 1) * 2 + 1
          ] || null;


        if (
          participant1 &&
          participant2
        ) {

          status =
            "ready";

        } else if (
          participant1 ||
          participant2
        ) {

          isByeMatch =
            true;

          status =
            "completed";

          winner =
            participant1 ||
            participant2;

        } else {

          status =
            "void";

        }

      }


      matches.push(
        makeMatch({

          id:
            nextId(
              "W"
            ),

          bracket:
            "winners",

          round,

          position,

          participant1,

          participant2,

          winner,

          status,

          isByeMatch

        })
      );

    }

  }


  connectWinners(
    matches,
    winnersRounds
  );


  // ==========================================================
  // 2. 建立 Losers Bracket 骨架
  // ==========================================================

  const losersRoundCount =
    Math.max(
      1,
      (
        winnersRounds - 1
      ) * 2
    );


  const losersByRound =
    new Map();


  for (
    let round = 1;
    round <= losersRoundCount;
    round++
  ) {

    const matchCount =
      getLosersMatchCount(
        bracketSize,
        round
      );


    const roundMatches =
      [];


    for (
      let position = 1;
      position <= matchCount;
      position++
    ) {

      const match =
        makeMatch({

          id:
            nextId(
              "L"
            ),

          bracket:
            "losers",

          round,

          position

        });


      roundMatches.push(
        match
      );


      matches.push(
        match
      );

    }


    losersByRound.set(
      round,
      roundMatches
    );

  }


  // ==========================================================
  // 3. Losers 內部晉級
  //
  // 奇數輪：
  //
  // L R1 M1 → L R2 M1
  // L R1 M2 → L R2 M2
  //
  // 偶數輪：
  //
  // L R2 M1 ─┐
  //          ├→ L R3 M1
  // L R2 M2 ─┘
  // ==========================================================

  for (
    let round = 1;
    round < losersRoundCount;
    round++
  ) {

    const current =
      losersByRound.get(
        round
      ) || [];


    const next =
      losersByRound.get(
        round + 1
      ) || [];


    if (
      round % 2 === 1
    ) {

      // 同位置進下一輪

      for (
        let i = 0;
        i < current.length;
        i++
      ) {

        const target =
          next[i];


        if (!target) {

          continue;

        }


        current[i].nextMatchId =
          target.id;


        current[i].nextMatchSlot =
          1;

      }

    } else {

      // 兩場合併成下一場

      for (
        let i = 0;
        i < current.length;
        i++
      ) {

        const target =
          next[
            Math.floor(
              i / 2
            )
          ];


        if (!target) {

          continue;

        }


        current[i].nextMatchId =
          target.id;


        current[i].nextMatchSlot =
          i % 2 === 0
            ? 1
            : 2;

      }

    }

  }


  // ==========================================================
  // 4. Winners 敗者 → Losers
  // ==========================================================

  const winners =
    matches.filter(
      (match) =>
        match.bracket ===
        "winners"
    );


  for (
    const winnerMatch of winners
  ) {

    const targetInfo =
      getLosersDropTarget(

        winnerMatch.round,

        winnerMatch.position,

        winnersRounds,

        losersByRound

      );


    if (
      !targetInfo
    ) {

      continue;

    }


    winnerMatch.loserNextMatchId =
      targetInfo.match.id;


    winnerMatch.loserNextMatchSlot =
      targetInfo.slot;

  }


  // ==========================================================
  // 5. 非 2 次方人數的敗部 BYE
  // ==========================================================

  markLosersByes(

    matches,

    losersByRound

  );


  // ==========================================================
  // 6. Grand Final
  // ==========================================================

  const grandFinal =
    makeMatch({

      id:
        nextId(
          "GF"
        ),

      bracket:
        "grand_final",

      round:
        1,

      position:
        1,

      isGrandFinal:
        true

    });


  // ==========================================================
  // 7. Grand Final Reset
  // ==========================================================

  const resetMatch =
    makeMatch({

      id:
        nextId(
          "GF"
        ),

      bracket:
        "grand_final",

      round:
        2,

      position:
        1,

      isGrandFinal:
        true,

      isResetMatch:
        true

    });


  matches.push(
    grandFinal,
    resetMatch
  );


  // ==========================================================
  // 8. Winners Final → Grand Final
  // ==========================================================

  const winnersFinal =
    findMatch(

      matches,

      "winners",

      winnersRounds,

      1

    );


  if (
    winnersFinal
  ) {

    winnersFinal.nextMatchId =
      grandFinal.id;


    winnersFinal.nextMatchSlot =
      1;

  }


  // ==========================================================
  // 9. Losers Final → Grand Final
  // ==========================================================

  const losersFinalRound =
    losersByRound.get(
      losersRoundCount
    ) || [];


  const losersFinal =
    losersFinalRound[0] ||
    null;


  if (
    losersFinal
  ) {

    losersFinal.nextMatchId =
      grandFinal.id;


    losersFinal.nextMatchSlot =
      2;

  }


  // ==========================================================
  // 注意
  //
  // Grand Final / Reset 的實際參賽者與結果，
  // 由 tournaments.js 在比賽過程中處理。
  //
  // 不在這裡預先塞 participant。
  // ==========================================================


  return {

    matches,

    size:
      bracketSize

  };

}


// ============================================================
// Losers 每輪場數
//
// 8 人：
// 2 / 2 / 1 / 1
//
// 16 人：
// 4 / 4 / 2 / 2 / 1 / 1
//
// 32 人：
// 8 / 8 / 4 / 4 / 2 / 2 / 1 / 1
//
// 48 人會使用 64 格：
// 16 / 16 / 8 / 8 / 4 / 4 / 2 / 2 / 1 / 1
// ============================================================

function getLosersMatchCount(
  bracketSize,
  round
) {

  const winnersRounds =
    Math.log2(
      bracketSize
    );


  const maxRound =
    Math.max(
      1,
      (
        winnersRounds - 1
      ) * 2
    );


  if (
    round < 1 ||
    round > maxRound
  ) {

    return 0;

  }


  const group =
    Math.ceil(
      round / 2
    );


  return Math.max(

    1,

    bracketSize /
      Math.pow(
        2,
        group + 1
      )

  );

}


// ============================================================
// Winners 敗者落入 Losers
//
// 8 人：
//
// WB R1 M1/M2
//      ↓
// LB R1 M1
//
// WB R1 M3/M4
//      ↓
// LB R1 M2
//
// WB R2 M1
//      ↓
// LB R2 M1 slot2
//
// WB R2 M2
//      ↓
// LB R2 M2 slot2
//
// WB R3 M1
//      ↓
// LB R4 M1 slot2
// ============================================================

function getLosersDropTarget(

  winnersRound,

  winnersPosition,

  winnersRounds,

  losersByRound

) {

  if (
    winnersRounds < 2
  ) {

    return null;

  }


  // ----------------------------------------------------------
  // Winners R1 → Losers R1
  // ----------------------------------------------------------

  if (
    winnersRound === 1
  ) {

    const round =
      losersByRound.get(
        1
      ) || [];


    const target =
      round[
        Math.floor(
          (
            winnersPosition - 1
          ) / 2
        )
      ];


    if (!target) {

      return null;

    }


    return {

      match:
        target,

      slot:
        winnersPosition % 2 === 1
          ? 1
          : 2

    };

  }


  // ----------------------------------------------------------
  // Winners 中間輪 → Losers 偶數輪 slot 2
  // ----------------------------------------------------------

  if (
    winnersRound <
    winnersRounds
  ) {

    const losersRound =
      winnersRound * 2 - 2;


    const round =
      losersByRound.get(
        losersRound
      ) || [];


    const target =
      round[
        winnersPosition - 1
      ];


    if (!target) {

      return null;

    }


    return {

      match:
        target,

      slot:
        2

    };

  }


  // ----------------------------------------------------------
  // Winners Final → Losers 最後一輪 slot 2
  // ----------------------------------------------------------

  const finalRound =
    (
      winnersRounds - 1
    ) * 2;


  const round =
    losersByRound.get(
      finalRound
    ) || [];


  const target =
    round[0];


  if (!target) {

    return null;

  }


  return {

    match:
      target,

    slot:
      2

  };

}


// ============================================================
// 非 2 次方人數的敗部 BYE
//
// 例如 6 人：
//
// Winners R1
// 1 BYE
// 4 vs 5
// 2 BYE
// 3 vs 6
//
// 所以 Losers R1：
//
// [等待 4/5 敗者]
// [等待 3/6 敗者]
//
// 這兩場都是「敗部 BYE」。
// 真正敗者進來後，tournaments.js 會自動晉級。
// ============================================================

function markLosersByes(
  matches,
  losersByRound
) {

  const byId =
    new Map(
      matches.map(
        (match) => [
          match.id,
          match
        ]
      )
    );


  function sourceForSlot(
    targetId,
    slot
  ) {

    for (
      const candidate of byId.values()
    ) {

      if (
        candidate.nextMatchId ===
          targetId &&

        candidate.nextMatchSlot ===
          slot
      ) {

        return {

          kind:
            "winner",

          matchId:
            candidate.id

        };

      }


      if (
        candidate.loserNextMatchId ===
          targetId &&

        candidate.loserNextMatchSlot ===
          slot
      ) {

        return {

          kind:
            "loser",

          matchId:
            candidate.id

        };

      }

    }


    return null;

  }


  function sourceCannotProduce(
    source
  ) {

    if (!source) {

      return true;

    }


    const sourceMatch =
      byId.get(
        source.matchId
      );


    if (!sourceMatch) {

      return true;

    }


    // winner source
    if (
      source.kind ===
      "winner"
    ) {

      return (
        sourceMatch.status ===
        "void"
      );

    }


    // loser source
    if (
      source.kind ===
      "loser"
    ) {

      return (

        sourceMatch.isByeMatch ===
          true ||

        sourceMatch.status ===
          "void"

      );

    }


    return false;

  }


  for (
    const roundMatches
      of losersByRound.values()
  ) {

    for (
      const match of roundMatches
    ) {

      const source1 =
        sourceForSlot(
          match.id,
          1
        );


      const source2 =
        sourceForSlot(
          match.id,
          2
        );


      const source1Empty =
        sourceCannotProduce(
          source1
        );


      const source2Empty =
        sourceCannotProduce(
          source2
        );


      // 兩邊都不會產生人
      if (
        source1Empty &&
        source2Empty
      ) {

        match.status =
          "void";

      }

      // 只有一邊會產生人
      else if (
        source1Empty !==
        source2Empty
      ) {

        match.isByeMatch =
          true;

      }

    }

  }

}

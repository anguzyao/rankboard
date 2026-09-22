const adminButton =
  document.getElementById(
    "adminButton"
  );

const rankingList =
  document.getElementById(
    "rankingList"
  );

const updatedAt =
  document.getElementById(
    "updatedAt"
  );

const siteTitle =
  document.getElementById(
    "siteTitle"
  );

const competitionTabs =
  document.getElementById(
    "competitionTabs"
  );

let isAdmin = false;
let competitions = [];
let selectedCompetition = "total";

let rankingParticipants = [];
let previousRanking = {};

let autoLockTimer = null;
const AUTO_LOCK_MINUTES = 30;


// ============================================================
// 初始化
// ============================================================

async function init() {
  await loadSiteSettings();
  await loadCompetitions();
  await checkAdmin();
  await loadRanking();
}


// ============================================================
// 網站設定
// ============================================================

async function loadSiteSettings() {
  try {
    const response =
      await fetch(
        "/api/settings",
        {
          cache: "no-store"
        }
      );

    const data =
      await response.json();

    if (
      data.settings &&
      data.settings.site_title
    ) {
      siteTitle.textContent =
        data.settings.site_title;
    }
  } catch (error) {
    console.error(
      "載入網站設定失敗",
      error
    );
  }
}


// ============================================================
// 載入競賽
// ============================================================

async function loadCompetitions() {
  try {
    const response =
      await fetch(
        "/api/competitions",
        {
          cache: "no-store"
        }
      );

    const data =
      await response.json();

    competitions =
      Array.isArray(
        data.competitions
      )
        ? data.competitions
        : [];

    renderCompetitionTabs();
  } catch (error) {
    console.error(
      "載入競賽失敗",
      error
    );

    competitions = [];

    renderCompetitionTabs();
  }
}


// ============================================================
// 競賽切換
// ============================================================

function renderCompetitionTabs() {
  competitionTabs.innerHTML = "";

  const totalButton =
    document.createElement(
      "button"
    );

  totalButton.className =
    "competition-tab";

  if (
    selectedCompetition ===
    "total"
  ) {
    totalButton.classList.add(
      "active"
    );
  }

  totalButton.textContent =
    "總積分";

  totalButton.addEventListener(
    "click",
    async () => {
      if (
        selectedCompetition ===
        "total"
      ) {
        return;
      }

      selectedCompetition =
        "total";

      renderCompetitionTabs();

      await loadRanking();
    }
  );

  competitionTabs.appendChild(
    totalButton
  );

  competitions.forEach(
    (competition) => {
      const button =
        document.createElement(
          "button"
        );

      button.className =
        "competition-tab";

      if (
        String(
          selectedCompetition
        ) ===
        String(
          competition.id
        )
      ) {
        button.classList.add(
          "active"
        );
      }

      button.textContent =
        competition.name;

      button.addEventListener(
        "click",
        async () => {
          if (
            String(
              selectedCompetition
            ) ===
            String(
              competition.id
            )
          ) {
            return;
          }

          selectedCompetition =
            String(
              competition.id
            );

          renderCompetitionTabs();

          await loadRanking();
        }
      );

      competitionTabs.appendChild(
        button
      );
    }
  );
}


// ============================================================
// 目前競賽名稱
// ============================================================

function getSelectedCompetitionName() {
  if (
    selectedCompetition ===
    "total"
  ) {
    return "總積分";
  }

  const competition =
    competitions.find(
      (item) =>
        String(item.id) ===
        String(
          selectedCompetition
        )
    );

  return competition
    ? competition.name
    : "競賽";
}


// ============================================================
// 載入排名
// ============================================================

async function loadRanking() {
  try {
    let endpoint =
      "/api/state";

    if (
      selectedCompetition !==
      "total"
    ) {
      endpoint +=
        `?competition=${encodeURIComponent(
          selectedCompetition
        )}`;
    }

    const response =
      await fetch(
        endpoint,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        "排名載入失敗"
      );
    }

    const data =
      await response.json();

    rankingParticipants =
      Array.isArray(
        data.participants
      )
        ? data.participants
        : [];

    renderRanking(
      rankingParticipants
    );

    updatedAt.textContent =
      data.updatedAt
        ? formatDateTime(
            data.updatedAt
          )
        : "尚未更新";

    if (isAdmin) {
      await renderAdminPanel();
    }
  } catch (error) {
    console.error(
      "載入排名失敗",
      error
    );

    rankingList.innerHTML = `
      <div class="empty-state">
        <p>排名載入失敗</p>
      </div>
    `;
  }
}


// ============================================================
// 排名變化
// ============================================================

function getPreviousRank(
  participantId
) {
  return previousRanking[
    participantId
  ];
}


function buildCurrentRankingMap(
  participants
) {
  const map = {};

  participants.forEach(
    (participant) => {
      map[participant.id] =
        participant.rank;
    }
  );

  return map;
}


// ============================================================
// 公開排名
// ============================================================

function renderRanking(
  participants
) {
  if (!participants.length) {
    rankingList.innerHTML = `
      <div class="empty-state">
        <p>目前尚無參賽者</p>
      </div>
    `;

    return;
  }

  const oldRanking =
    previousRanking;

  rankingList.innerHTML = "";

  participants.forEach(
    (participant) => {
      const card =
        document.createElement(
          "article"
        );

      card.className =
        "rank-card";

      if (
        participant.rank <= 4
      ) {
        card.classList.add(
          `top-${participant.rank}`
        );
      }

      const oldRank =
        oldRanking[
          participant.id
        ];

      let changeHTML = "";

      if (
        oldRank !== undefined
      ) {
        if (
          participant.rank <
          oldRank
        ) {
          changeHTML = `
            <span class="rank-change up">
              ↑
            </span>
          `;
        } else if (
          participant.rank >
          oldRank
        ) {
          changeHTML = `
            <span class="rank-change down">
              ↓
            </span>
          `;
        } else {
          changeHTML = `
            <span class="rank-change same">
              —
            </span>
          `;
        }
      }

      card.innerHTML = `
        <div class="rank-number">
          ${participant.rank}
        </div>

        <div class="participant-name">
          ${escapeHTML(
            participant.name
          )}
        </div>

        <div class="participant-score">
          ${Number(
            participant.score
          )}
          ${changeHTML}
        </div>
      `;

      rankingList.appendChild(
        card
      );
    }
  );

  previousRanking =
    buildCurrentRankingMap(
      participants
    );
}


// ============================================================
// 管理員登入
// ============================================================

adminButton.addEventListener(
  "click",
  async () => {
    if (isAdmin) {
      logoutAdmin();
    } else {
      await loginAdmin();
    }
  }
);


async function loginAdmin() {
  const password =
    prompt(
      "請輸入管理員密碼"
    );

  if (
    password === null
  ) {
    return;
  }

  if (!password) {
    alert(
      "請輸入密碼"
    );

    return;
  }

  try {
    const response =
      await fetch(
        "/api/login",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            password
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "登入失敗"
      );

      return;
    }

    isAdmin = true;

    adminButton.textContent =
      "🔓";

    resetAutoLock();

    await renderAdminPanel();

  } catch (error) {
    console.error(
      "登入失敗",
      error
    );

    alert(
      "登入失敗"
    );
  }
}


// ============================================================
// 登出
// ============================================================

async function logoutAdmin() {
  try {
    await fetch(
      "/api/logout",
      {
        method: "POST"
      }
    );
  } catch (error) {
    console.error(
      "登出失敗",
      error
    );
  }

  isAdmin = false;

  clearTimeout(
    autoLockTimer
  );

  adminButton.textContent =
    "🔒";

  removeAdminPanel();

  await loadRanking();
}


// ============================================================
// 檢查登入狀態
// ============================================================

async function checkAdmin() {
  try {
    const response =
      await fetch(
        "/api/me",
        {
          cache: "no-store"
        }
      );

    if (response.ok) {
      isAdmin = true;

      adminButton.textContent =
        "🔓";

      resetAutoLock();

      await renderAdminPanel();
    }
  } catch (error) {
    isAdmin = false;
  }
}


// ============================================================
// 管理員面板
// ============================================================

async function renderAdminPanel() {
  removeAdminPanel();

  if (!isAdmin) {
    return;
  }

  const panel =
    document.createElement(
      "section"
    );

  panel.id =
    "adminPanel";

  panel.className =
    "admin-panel";

  const totalMode =
    selectedCompetition ===
    "total";

  panel.innerHTML = `
    <div class="admin-header">

      <div>
        <span class="admin-eyebrow">
          ADMIN
        </span>

        <strong>
          ${escapeHTML(
            getSelectedCompetitionName()
          )}
        </strong>
      </div>

      <button
        id="logoutButton"
        class="secondary-button"
      >
        登出
      </button>

    </div>

    <div class="admin-section">

      <div class="admin-section-title">
        網站標題
      </div>

      <div class="admin-title-editor">
        <input
          id="siteTitleInput"
          class="name-edit-input"
          type="text"
          value="${escapeAttribute(
            siteTitle.textContent
          )}"
          maxlength="50"
        >

        <button
          id="saveSiteTitleButton"
          class="secondary-button"
        >
          儲存
        </button>
      </div>

    </div>

    <div class="admin-section">

      <div class="admin-section-title">
        競賽管理
      </div>

      <div
        id="competitionManager"
        class="competition-manager"
      ></div>

      <div class="competition-add-row">

        <input
          id="newCompetitionInput"
          class="name-edit-input"
          type="text"
          placeholder="新增競賽名稱"
          maxlength="50"
        >

        <button
          id="addCompetitionButton"
          class="primary-button"
        >
          新增
        </button>

      </div>

    </div>

    <div class="admin-section">

      <div class="admin-section-title">
        ${totalMode
          ? "總積分"
          : `${escapeHTML(
              getSelectedCompetitionName()
            )} 分數`}
      </div>

      ${
        totalMode
          ? `
            <div class="admin-info">
              總積分為所有競賽分數加總。
              請切換到個別競賽後調整分數。
            </div>
          `
          : ""
      }

      <div class="add-participant">

        <input
          id="newParticipantInput"
          type="text"
          placeholder="新增參賽者"
          maxlength="50"
        >

        <button
          id="addParticipantButton"
          class="primary-button"
        >
          新增
        </button>

      </div>

      <div
        id="adminParticipants"
        class="admin-participants"
      ></div>

      <div class="admin-actions">

        <button
          id="undoButton"
          class="secondary-button"
        >
          Undo
        </button>

        <button
          id="logsButton"
          class="secondary-button"
        >
          操作紀錄
        </button>

      </div>

      <div
        id="logsPanel"
        class="logs-panel hidden"
      ></div>

    </div>
  `;

  const statusCard =
    document.querySelector(
      ".status-card"
    );

  statusCard.before(
    panel
  );

  document
    .getElementById(
      "logoutButton"
    )
    .addEventListener(
      "click",
      logoutAdmin
    );

  document
    .getElementById(
      "saveSiteTitleButton"
    )
    .addEventListener(
      "click",
      saveSiteTitle
    );

  document
    .getElementById(
      "addCompetitionButton"
    )
    .addEventListener(
      "click",
      addCompetition
    );

  document
    .getElementById(
      "addParticipantButton"
    )
    .addEventListener(
      "click",
      addParticipant
    );

  document
    .getElementById(
      "undoButton"
    )
    .addEventListener(
      "click",
      undoLastOperation
    );

  document
    .getElementById(
      "logsButton"
    )
    .addEventListener(
      "click",
      toggleLogs
    );

  renderCompetitionManager();

  renderAdminParticipants();
}


// ============================================================
// 移除管理員面板
// ============================================================

function removeAdminPanel() {
  const panel =
    document.getElementById(
      "adminPanel"
    );

  if (panel) {
    panel.remove();
  }
}


// ============================================================
// 網站標題
// ============================================================

async function saveSiteTitle() {
  const input =
    document.getElementById(
      "siteTitleInput"
    );

  if (!input) {
    return;
  }

  const title =
    input.value.trim();

  if (!title) {
    alert(
      "標題不能為空白"
    );

    return;
  }

  try {
    const response =
      await fetch(
        "/api/settings",
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            title
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "儲存失敗"
      );

      return;
    }

    siteTitle.textContent =
      title;

    alert(
      "網站標題已更新"
    );

    resetAutoLock();

  } catch (error) {
    console.error(
      error
    );

    alert(
      "儲存失敗"
    );
  }
}


// ============================================================
// 競賽管理
// ============================================================

function renderCompetitionManager() {
  const manager =
    document.getElementById(
      "competitionManager"
    );

  if (!manager) {
    return;
  }

  manager.innerHTML = "";

  if (!competitions.length) {
    manager.innerHTML = `
      <div class="admin-info">
        目前尚未建立競賽。
      </div>
    `;

    return;
  }

  competitions.forEach(
    (competition) => {
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "competition-manager-row";

      row.innerHTML = `
        <input
          class="name-edit-input competition-name-input"
          type="text"
          value="${escapeAttribute(
            competition.name
          )}"
          maxlength="50"
        >

        <button
          class="secondary-button competition-save-button"
        >
          儲存
        </button>

        <button
          class="delete-button competition-delete-button"
        >
          刪除
        </button>
      `;

      const input =
        row.querySelector(
          ".competition-name-input"
        );

      const saveButton =
        row.querySelector(
          ".competition-save-button"
        );

      const deleteButton =
        row.querySelector(
          ".competition-delete-button"
        );

      saveButton.addEventListener(
        "click",
        async () => {
          await renameCompetition(
            competition.id,
            input.value
          );
        }
      );

      deleteButton.addEventListener(
        "click",
        async () => {
          await deleteCompetition(
            competition.id
          );
        }
      );

      manager.appendChild(
        row
      );
    }
  );
}


// ============================================================
// 新增競賽
// ============================================================

async function addCompetition() {
  const input =
    document.getElementById(
      "newCompetitionInput"
    );

  if (!input) {
    return;
  }

  const name =
    input.value.trim();

  if (!name) {
    alert(
      "請輸入競賽名稱"
    );

    return;
  }

  try {
    const response =
      await fetch(
        "/api/competitions",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            name
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "新增競賽失敗"
      );

      return;
    }

    input.value = "";

    await loadCompetitions();

    await loadRanking();

    resetAutoLock();

  } catch (error) {
    console.error(
      error
    );

    alert(
      "新增競賽失敗"
    );
  }
}


// ============================================================
// 修改競賽
// ============================================================

async function renameCompetition(
  competitionId,
  name
) {
  const cleanName =
    String(name).trim();

  if (!cleanName) {
    alert(
      "競賽名稱不能為空白"
    );

    return;
  }

  try {
    const response =
      await fetch(
        `/api/competitions/${competitionId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            name: cleanName
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "修改競賽失敗"
      );

      return;
    }

    await loadCompetitions();

    await loadRanking();

    resetAutoLock();

  } catch (error) {
    console.error(
      error
    );

    alert(
      "修改競賽失敗"
    );
  }
}


// ============================================================
// 刪除競賽
// ============================================================

async function deleteCompetition(
  competitionId
) {
  const competition =
    competitions.find(
      (item) =>
        String(item.id) ===
        String(competitionId)
    );

  if (!competition) {
    return;
  }

  const confirmed =
    confirm(
      `確定要刪除「${competition.name}」嗎？\n\n此競賽的所有分數也會一起刪除。`
    );

  if (!confirmed) {
    return;
  }

  try {
    const response =
      await fetch(
        `/api/competitions/${competitionId}`,
        {
          method: "DELETE"
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "刪除競賽失敗"
      );

      return;
    }

    if (
      String(
        selectedCompetition
      ) ===
      String(
        competitionId
      )
    ) {
      selectedCompetition =
        "total";
    }

    await loadCompetitions();

    await loadRanking();

    resetAutoLock();

  } catch (error) {
    console.error(
      error
    );

    alert(
      "刪除競賽失敗"
    );
  }
}


// ============================================================
// 新增參賽者
// ============================================================

async function addParticipant() {
  const input =
    document.getElementById(
      "newParticipantInput"
    );

  if (!input) {
    return;
  }

  const name =
    input.value.trim();

  if (!name) {
    alert(
      "請輸入參賽者姓名"
    );

    return;
  }

  try {
    const response =
      await fetch(
        "/api/participants",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            name
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "新增參賽者失敗"
      );

      return;
    }

    input.value = "";

    await loadRanking();

    resetAutoLock();

  } catch (error) {
    console.error(
      error
    );

    alert(
      "新增參賽者失敗"
    );
  }
}


// ============================================================
// 管理員參賽者列表
// ============================================================

function renderAdminParticipants() {
  const container =
    document.getElementById(
      "adminParticipants"
    );

  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (!rankingParticipants.length) {
    container.innerHTML = `
      <div class="logs-empty">
        目前尚無參賽者
      </div>
    `;

    return;
  }

  const totalMode =
    selectedCompetition ===
    "total";

rankingParticipants
  .slice()
  .sort((a, b) => a.id - b.id)
  .forEach(
    (participant) => {
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "admin-participant";

      row.innerHTML = `
        <div class="admin-rank">
          ${participant.rank}
        </div>

        <input
          class="name-edit-input"
          type="text"
          value="${escapeAttribute(
            participant.name
          )}"
          maxlength="50"
        >

        <button
          class="score-button minus"
          ${totalMode ? "disabled" : ""}
        >
          −1
        </button>

        <input
          class="score-input"
          type="number"
          min="0"
          step="1"
          value="${Number(
            participant.score
          )}"
          ${totalMode ? "disabled" : ""}
        >

        <button
          class="score-button plus"
          ${totalMode ? "disabled" : ""}
        >
          +1
        </button>

        <button
          class="secondary-button save-name-button"
        >
          儲存
        </button>

        <button
          class="delete-button"
        >
          刪除
        </button>
      `;

      const nameInput =
        row.querySelector(
          ".name-edit-input"
        );

      const scoreInput =
        row.querySelector(
          ".score-input"
        );

      const minusButton =
        row.querySelector(
          ".minus"
        );

      const plusButton =
        row.querySelector(
          ".plus"
        );

      const saveNameButton =
        row.querySelector(
          ".save-name-button"
        );

      const deleteButton =
        row.querySelector(
          ".delete-button"
        );

      saveNameButton.addEventListener(
        "click",
        async () => {
          await saveParticipantName(
            participant.id,
            nameInput.value
          );
        }
      );

      deleteButton.addEventListener(
        "click",
        async () => {
          await deleteParticipant(
            participant.id,
            participant.name
          );
        }
      );

      if (!totalMode) {
        minusButton.addEventListener(
          "click",
          async () => {
            await changeScore(
              participant.id,
              -1
            );
          }
        );

        plusButton.addEventListener(
          "click",
          async () => {
            await changeScore(
              participant.id,
              1
            );
          }
        );

        scoreInput.addEventListener(
          "change",
          async () => {
            await setScore(
              participant.id,
              scoreInput.value
            );
          }
        );
      }

      container.appendChild(
        row
      );
    }
  );
}


// ============================================================
// 修改姓名
// ============================================================

async function saveParticipantName(
  participantId,
  name
) {
  const cleanName =
    String(name).trim();

  if (!cleanName) {
    alert(
      "姓名不能為空白"
    );

    return;
  }

  try {
    const response =
      await fetch(
        `/api/participants/${participantId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            name: cleanName
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "修改姓名失敗"
      );

      return;
    }

    await loadRanking();

    resetAutoLock();

  } catch (error) {
    console.error(
      error
    );

    alert(
      "修改姓名失敗"
    );
  }
}


// ============================================================
// 分數 +1 / -1
// ============================================================

async function changeScore(
  participantId,
  delta
) {
  if (
    selectedCompetition ===
    "total"
  ) {
    return;
  }

  try {
    const response =
      await fetch(
        `/api/participants/${participantId}/score?competition=${encodeURIComponent(
          selectedCompetition
        )}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            delta
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "分數更新失敗"
      );

      return;
    }

    await loadRanking();

    resetAutoLock();

  } catch (error) {
    console.error(
      error
    );

    alert(
      "分數更新失敗"
    );
  }
}


// ============================================================
// 直接輸入分數
// ============================================================

async function setScore(
  participantId,
  score
) {
  if (
    selectedCompetition ===
    "total"
  ) {
    return;
  }

  const numericScore =
    Number(score);

  if (
    !Number.isInteger(
      numericScore
    ) ||
    numericScore < 0
  ) {
    alert(
      "分數必須是 0 以上的整數"
    );

    await loadRanking();

    return;
  }

  try {
    const response =
      await fetch(
        `/api/participants/${participantId}/score?competition=${encodeURIComponent(
          selectedCompetition
        )}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            score:
              numericScore
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "分數更新失敗"
      );

      return;
    }

    await loadRanking();

    resetAutoLock();

  } catch (error) {
    console.error(
      error
    );

    alert(
      "分數更新失敗"
    );
  }
}


// ============================================================
// 刪除參賽者
// ============================================================

async function deleteParticipant(
  participantId,
  participantName
) {
  const confirmed =
    confirm(
      `確定要刪除「${participantName}」嗎？\n\n他的所有競賽分數也會一起刪除。`
    );

  if (!confirmed) {
    return;
  }

  try {
    const response =
      await fetch(
        `/api/participants/${participantId}`,
        {
          method: "DELETE"
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "刪除失敗"
      );

      return;
    }

    await loadRanking();

    resetAutoLock();

  } catch (error) {
    console.error(
      error
    );

    alert(
      "刪除失敗"
    );
  }
}


// ============================================================
// Undo
// ============================================================

async function undoLastOperation() {
  const competitionQuery =
    selectedCompetition !==
    "total"
      ? `?competition=${encodeURIComponent(
          selectedCompetition
        )}`
      : "";

  try {
    const response =
      await fetch(
        `/api/undo${competitionQuery}`,
        {
          method: "POST"
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "目前沒有可以復原的操作"
      );

      return;
    }

    await loadRanking();

    resetAutoLock();

  } catch (error) {
    console.error(
      error
    );

    alert(
      "Undo 失敗"
    );
  }
}


// ============================================================
// 操作紀錄
// ============================================================

async function toggleLogs() {
  const panel =
    document.getElementById(
      "logsPanel"
    );

  if (!panel) {
    return;
  }

  if (
    !panel.classList.contains(
      "hidden"
    )
  ) {
    panel.classList.add(
      "hidden"
    );

    return;
  }

  try {
    const response =
      await fetch(
        "/api/logs",
        {
          cache: "no-store"
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
          "讀取紀錄失敗"
      );

      return;
    }

    renderLogs(
      panel,
      data.logs || []
    );

    panel.classList.remove(
      "hidden"
    );

    resetAutoLock();

  } catch (error) {
    console.error(
      error
    );

    alert(
      "讀取紀錄失敗"
    );
  }
}


function renderLogs(
  panel,
  logs
) {
  if (!logs.length) {
    panel.innerHTML = `
      <div class="logs-empty">
        目前沒有操作紀錄
      </div>
    `;

    return;
  }

  panel.innerHTML = "";

  logs.forEach(
    (log) => {
      const item =
        document.createElement(
          "div"
        );

      item.className =
        "log-item";

      item.innerHTML = `
        <div class="log-main">
          ${escapeHTML(
            formatLogAction(log)
          )}
        </div>

        <div class="log-time">
          ${formatDateTime(
            log.created_at
          )}
        </div>
      `;

      panel.appendChild(
        item
      );
    }
  );
}


// ============================================================
// Log 顯示
// ============================================================

function formatLogAction(
  log
) {
  const name =
    log.name ||
    "已刪除參賽者";

  const action =
    String(
      log.action || ""
    );

  if (
    action.startsWith(
      "COMPETITION_ADJUST_SCORE:"
    )
  ) {
    const competitionId =
      action.split(":")[1];

    const competition =
      competitions.find(
        (item) =>
          String(item.id) ===
          String(
            competitionId
          )
      );

    return `${name}｜${competition?.name || "競賽"}｜${log.old_score} → ${log.new_score}`;
  }

  if (
    action.startsWith(
      "COMPETITION_SET_SCORE:"
    )
  ) {
    const competitionId =
      action.split(":")[1];

    const competition =
      competitions.find(
        (item) =>
          String(item.id) ===
          String(
            competitionId
          )
      );

    return `${name}｜${competition?.name || "競賽"}｜${log.old_score} → ${log.new_score}`;
  }

  if (
    action.startsWith(
      "COMPETITION_UNDO:"
    )
  ) {
    return `${name}｜競賽分數 Undo`;
  }

  if (
    action ===
    "CREATE_PARTICIPANT"
  ) {
    return `新增參賽者：${name}`;
  }

  if (
    action ===
    "EDIT_NAME"
  ) {
    return `修改姓名：${name}`;
  }

  if (
    action ===
    "DELETE_PARTICIPANT"
  ) {
    return `刪除參賽者：${name}`;
  }

  if (
    action ===
    "ADJUST_SCORE"
  ) {
    return `${name}｜${log.old_score} → ${log.new_score}`;
  }

  if (
    action ===
    "SET_SCORE"
  ) {
    return `${name}｜${log.old_score} → ${log.new_score}`;
  }

  if (
    action.startsWith(
      "UNDO:"
    )
  ) {
    return `${name}｜分數 Undo`;
  }

  return action;
}


// ============================================================
// 30 分鐘自動鎖定
// ============================================================

function resetAutoLock() {
  if (!isAdmin) {
    return;
  }

  clearTimeout(
    autoLockTimer
  );

  autoLockTimer =
    setTimeout(
      async () => {
        if (isAdmin) {
          await logoutAdmin();
        }
      },
      AUTO_LOCK_MINUTES *
        60 *
        1000
    );
}


[
  "click",
  "keydown",
  "mousemove",
  "touchstart"
].forEach(
  (eventName) => {
    document.addEventListener(
      eventName,
      () => {
        if (isAdmin) {
          resetAutoLock();
        }
      },
      {
        passive: true
      }
    );
  }
);


// ============================================================
// 工具
// ============================================================

function escapeHTML(
  value
) {
  return String(value)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


function escapeAttribute(
  value
) {
  return escapeHTML(value);
}


function formatDateTime(
  value
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "尚未更新";
  }

  return date.toLocaleString(
    "zh-TW",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }
  );
}


// ============================================================
// 啟動
// ============================================================

init();

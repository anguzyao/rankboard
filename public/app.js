const rankingList =
  document.getElementById("rankingList");

const updatedAt =
  document.getElementById("updatedAt");

const adminButton =
  document.getElementById("adminButton");

const siteTitle =
  document.getElementById("siteTitle");

const competitionTabs =
  document.getElementById(
    "competitionTabs"
  );

let isAdmin = false;
let autoLockTimer = null;
let activityEventsBound = false;

let competitions = [];
let selectedCompetition = "total";


// =========================
// 初始化
// =========================

async function init() {
  await loadSiteSettings();
  await loadCompetitions();
  await loadRanking();
}

init();


// =========================
// 網站設定
// =========================

async function loadSiteSettings() {
  try {
    const response =
      await fetch(
        "/api/settings",
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      return;
    }

    const data =
      await response.json();

    const title =
      data.settings?.site_title ||
      "比賽排名";

    siteTitle.textContent =
      title;

    document.title =
      `Beyblade X｜${title}`;

  } catch {
    siteTitle.textContent =
      "比賽排名";
  }
}


// =========================
// 競賽
// =========================

async function loadCompetitions() {
  try {
    const response =
      await fetch(
        "/api/competitions",
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error();
    }

    const data =
      await response.json();

    competitions =
      data.competitions || [];

    renderCompetitionTabs();

    if (isAdmin) {
      renderCompetitionManager();
    }

  } catch {
    competitions = [];

    renderCompetitionTabs();
  }
}


// =========================
// 競賽切換按鈕
// =========================

function renderCompetitionTabs() {
  if (!competitionTabs) {
    return;
  }

  let html = `
    <button
      class="competition-tab ${
        selectedCompetition === "total"
          ? "active"
          : ""
      }"
      data-competition="total"
    >
      總積分
    </button>
  `;

  html += competitions
    .map(
      (competition) => `
        <button
          class="competition-tab ${
            selectedCompetition ===
            String(competition.id)
              ? "active"
              : ""
          }"
          data-competition="${competition.id}"
        >
          ${escapeHtml(
            competition.name
          )}
        </button>
      `
    )
    .join("");

  competitionTabs.innerHTML =
    html;

  competitionTabs
    .querySelectorAll(
      ".competition-tab"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          selectedCompetition =
            button.dataset.competition;

          renderCompetitionTabs();

          loadRanking();
        }
      );
    });
}


// =========================
// 載入排名
// =========================

async function loadRanking() {
  try {
    const response =
      await fetch(
        "/api/state",
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error();
    }

    const data =
      await response.json();

    renderRanking(
      data.participants || []
    );

    updatedAt.textContent =
      data.updatedAt
        ? `更新於 ${formatTime(
            data.updatedAt
          )}`
        : "尚未更新";

    if (isAdmin) {
      renderAdminParticipants(
        data.participants || []
      );
    }

  } catch {
    rankingList.innerHTML = `
      <div class="empty-state">
        <p>
          目前無法取得排名資料
        </p>
      </div>
    `;
  }
}


// =========================
// 公開排名
// =========================

function renderRanking(
  participants
) {
  if (!participants.length) {
    rankingList.innerHTML = `
      <div class="empty-state">
        <p>
          目前尚無參賽者
        </p>
      </div>
    `;

    return;
  }

  const sorted =
    [...participants].sort(
      (a, b) =>
        Number(a.rank) -
        Number(b.rank)
    );

  rankingList.innerHTML =
    sorted
      .map((participant) => {
        const rank =
          Number(
            participant.rank
          );

        const previousRank =
          participant.previousRank;

        let changeHtml = "";

        if (
          previousRank !== null &&
          previousRank !== undefined
        ) {
          if (
            Number(previousRank) >
            rank
          ) {
            changeHtml = `
              <span
                class="rank-change up"
              >
                ↑
              </span>
            `;
          } else if (
            Number(previousRank) <
            rank
          ) {
            changeHtml = `
              <span
                class="rank-change down"
              >
                ↓
              </span>
            `;
          } else {
            changeHtml = `
              <span
                class="rank-change same"
              >
                —
              </span>
            `;
          }
        }

        return `
          <article
            class="rank-card
              ${getTopClass(rank)}"
          >

            <div class="rank-number">
              ${rank}
            </div>

            <div class="participant-name">
              ${escapeHtml(
                participant.name
              )}

              ${changeHtml}
            </div>

            <div class="participant-score">
              ${
                Number(
                  participant.score
                ) || 0
              }
            </div>

          </article>
        `;
      })
      .join("");
}


// =========================
// 管理員登入
// =========================

async function adminLogin() {
  if (isAdmin) {
    await logoutAdmin();
    return;
  }

  const password =
    prompt(
      "請輸入管理員密碼"
    );

  if (password === null) {
    return;
  }

  if (!password) {
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

          body:
            JSON.stringify({
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

    showAdminPanel();

    bindActivityEvents();

    resetAutoLockTimer();

    await loadSiteSettings();
    await loadCompetitions();
    await loadRanking();
    await loadLogs();

  } catch {
    alert(
      "目前無法登入"
    );
  }
}


// =========================
// 登出
// =========================

async function logoutAdmin() {
  try {
    await fetch(
      "/api/logout",
      {
        method: "POST"
      }
    );
  } catch {
    // 保持前端鎖定
  }

  isAdmin = false;

  adminButton.textContent =
    "🔒";

  clearAutoLockTimer();

  const panel =
    document.getElementById(
      "adminPanel"
    );

  if (panel) {
    panel.remove();
  }
}


// =========================
// 管理員面板
// =========================

function showAdminPanel() {
  let panel =
    document.getElementById(
      "adminPanel"
    );

  if (!panel) {
    panel =
      document.createElement(
        "section"
      );

    panel.id =
      "adminPanel";

    panel.className =
      "admin-panel";

    const statusCard =
      document.querySelector(
        ".status-card"
      );

    statusCard.insertAdjacentElement(
      "afterend",
      panel
    );
  }

  panel.innerHTML = `
    <div class="admin-header">

      <div>
        <span class="admin-eyebrow">
          ADMIN
        </span>

        <strong>
          管理員模式
        </strong>
      </div>

      <button
        id="logoutButton"
        class="secondary-button"
      >
        登出
      </button>

    </div>


    <!-- =====================
         網站標題
         ===================== -->

    <div class="admin-section">

      <div class="admin-section-title">
        網站標題
      </div>

      <div class="admin-title-row">

        <input
          id="siteTitleInput"
          class="admin-title-input"
          type="text"
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


    <!-- =====================
         競賽管理
         ===================== -->

    <div class="admin-section">

      <div class="admin-section-title">
        競賽管理
      </div>

      <div
        id="competitionManager"
        class="competition-manager"
      ></div>

      <div class="add-competition-row">

        <input
          id="competitionNameInput"
          class="admin-title-input"
          type="text"
          maxlength="50"
          placeholder="新增競賽名稱"
        >

        <button
          id="addCompetitionButton"
          class="primary-button"
        >
          新增
        </button>

      </div>

    </div>


    <!-- =====================
         參賽者
         ===================== -->

    <div class="admin-section">

      <div class="admin-section-title">
        參賽者
      </div>

      <div class="add-participant">

        <input
          id="participantNameInput"
          type="text"
          placeholder="輸入參賽者姓名"
          maxlength="50"
        >

        <button
          id="addParticipantButton"
          class="primary-button"
        >
          新增
        </button>

      </div>

    </div>


    <!-- =====================
         操作
         ===================== -->

    <div class="admin-actions">

      <button
        id="undoButton"
        class="secondary-button"
      >
        ↩ Undo
      </button>

      <button
        id="logsButton"
        class="secondary-button"
      >
        操作紀錄
      </button>

    </div>


    <div
      id="adminParticipants"
      class="admin-participants"
    ></div>


    <div
      id="logsPanel"
      class="logs-panel hidden"
    ></div>
  `;


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
      undoLastScore
    );


  document
    .getElementById(
      "logsButton"
    )
    .addEventListener(
      "click",
      toggleLogs
    );


  document
    .getElementById(
      "siteTitleInput"
    ).value =
      siteTitle.textContent ||
      "比賽排名";


  renderCompetitionManager();

  renderAdminParticipants(
    []
  );
}


// =========================
// 管理競賽
// =========================

function renderCompetitionManager() {
  const container =
    document.getElementById(
      "competitionManager"
    );

  if (!container) {
    return;
  }

  if (!competitions.length) {
    container.innerHTML = `
      <div class="competition-empty">
        尚未建立競賽
      </div>
    `;

    return;
  }

  container.innerHTML =
    competitions
      .map(
        (competition) => `
          <div
            class="competition-manager-row"
            data-id="${competition.id}"
          >

            <input
              class="competition-name-input"
              value="${escapeHtml(
                competition.name
              )}"
              maxlength="50"
            >

            <button
              class="secondary-button
                competition-save-button"
              data-id="${competition.id}"
            >
              儲存
            </button>

            <button
              class="delete-button
                competition-delete-button"
              data-id="${competition.id}"
            >
              刪除
            </button>

          </div>
        `
      )
      .join("");


  container
    .querySelectorAll(
      ".competition-save-button"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          saveCompetition(
            button.dataset.id
          );
        }
      );
    });


  container
    .querySelectorAll(
      ".competition-delete-button"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          deleteCompetition(
            button.dataset.id
          );
        }
      );
    });
}


// =========================
// 儲存網站標題
// =========================

async function saveSiteTitle() {
  const input =
    document.getElementById(
      "siteTitleInput"
    );

  const title =
    input.value.trim();

  if (!title) {
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

          body:
            JSON.stringify({
              title
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
        "標題儲存失敗"
      );

      return;
    }

    siteTitle.textContent =
      title;

    document.title =
      `Beyblade X｜${title}`;

    resetAutoLockTimer();

  } catch {
    alert(
      "目前無法修改網站標題"
    );
  }
}


// =========================
// 新增競賽
// =========================

async function addCompetition() {
  const input =
    document.getElementById(
      "competitionNameInput"
    );

  const name =
    input.value.trim();

  if (!name) {
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

          body:
            JSON.stringify({
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

    resetAutoLockTimer();

    await loadCompetitions();

  } catch {
    alert(
      "目前無法新增競賽"
    );
  }
}


// =========================
// 修改競賽名稱
// =========================

async function saveCompetition(
  id
) {
  const row =
    document.querySelector(
      `.competition-manager-row[data-id="${id}"]`
    );

  if (!row) {
    return;
  }

  const input =
    row.querySelector(
      ".competition-name-input"
    );

  const name =
    input.value.trim();

  if (!name) {
    return;
  }

  try {
    const response =
      await fetch(
        `/api/competitions/${id}`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              name
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
        "競賽名稱更新失敗"
      );

      return;
    }

    resetAutoLockTimer();

    await loadCompetitions();

  } catch {
    alert(
      "目前無法修改競賽名稱"
    );
  }
}


// =========================
// 刪除競賽
// =========================

async function deleteCompetition(
  id
) {
  const competition =
    competitions.find(
      (item) =>
        String(item.id) ===
        String(id)
    );

  if (!competition) {
    return;
  }

  const confirmed =
    confirm(
      `確定要刪除「${competition.name}」嗎？`
    );

  if (!confirmed) {
    return;
  }

  try {
    const response =
      await fetch(
        `/api/competitions/${id}`,
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
      selectedCompetition ===
      String(id)
    ) {
      selectedCompetition =
        "total";
    }

    resetAutoLockTimer();

    await loadCompetitions();

  } catch {
    alert(
      "目前無法刪除競賽"
    );
  }
}


// =========================
// 管理員參賽者
// =========================

function renderAdminParticipants(
  participants
) {
  const container =
    document.getElementById(
      "adminParticipants"
    );

  if (!container) {
    return;
  }

  const sorted =
    [...participants].sort(
      (a, b) =>
        Number(a.rank) -
        Number(b.rank)
    );

  container.innerHTML =
    sorted
      .map(
        (participant) => `
          <div
            class="admin-participant"
            data-id="${participant.id}"
          >

            <div class="admin-rank">
              #${participant.rank}
            </div>

            <input
              class="name-edit-input"
              value="${escapeHtml(
                participant.name
              )}"
              maxlength="50"
            >

            <button
              class="score-button minus"
              data-action="score"
              data-delta="-1"
              data-id="${participant.id}"
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
              data-id="${participant.id}"
            >

            <button
              class="score-button plus"
              data-action="score"
              data-delta="1"
              data-id="${participant.id}"
            >
              +1
            </button>

            <button
              class="secondary-button
                save-name-button"
              data-action="save-name"
              data-id="${participant.id}"
            >
              儲存
            </button>

            <button
              class="delete-button"
              data-action="delete"
              data-id="${participant.id}"
            >
              刪除
            </button>

          </div>
        `
      )
      .join("");


  container
    .querySelectorAll(
      "[data-action='score']"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          updateScore(
            button.dataset.id,
            Number(
              button.dataset.delta
            )
          );
        }
      );
    });


  container
    .querySelectorAll(
      "[data-action='save-name']"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          saveName(
            button.dataset.id
          );
        }
      );
    });


  container
    .querySelectorAll(
      "[data-action='delete']"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          deleteParticipant(
            button.dataset.id
          );
        }
      );
    });


  container
    .querySelectorAll(
      ".score-input"
    )
    .forEach((input) => {
      input.addEventListener(
        "change",
        () => {
          setScore(
            input.dataset.id,
            Number(input.value)
          );
        }
      );

      input.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key === "Enter"
          ) {
            input.blur();
          }
        }
      );
    });
}


// =========================
// 新增參賽者
// =========================

async function addParticipant() {
  const input =
    document.getElementById(
      "participantNameInput"
    );

  const name =
    input.value.trim();

  if (!name) {
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

          body:
            JSON.stringify({
              name
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
        "新增失敗"
      );

      return;
    }

    input.value = "";

    resetAutoLockTimer();

    await loadRanking();

  } catch {
    alert(
      "目前無法新增參賽者"
    );
  }
}


// =========================
// 分數
// =========================

async function updateScore(
  id,
  delta
) {
  try {
    const response =
      await fetch(
        `/api/participants/${id}/score`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
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

    resetAutoLockTimer();

    await loadRanking();

  } catch {
    alert(
      "目前無法更新分數"
    );
  }
}


async function setScore(
  id,
  score
) {
  if (
    !Number.isInteger(score)
  ) {
    return;
  }

  try {
    const response =
      await fetch(
        `/api/participants/${id}/score`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              score
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

    resetAutoLockTimer();

    await loadRanking();

  } catch {
    alert(
      "目前無法更新分數"
    );
  }
}


// =========================
// 修改參賽者姓名
// =========================

async function saveName(id) {
  const row =
    document.querySelector(
      `.admin-participant[data-id="${id}"]`
    );

  if (!row) {
    return;
  }

  const input =
    row.querySelector(
      ".name-edit-input"
    );

  const name =
    input.value.trim();

  if (!name) {
    return;
  }

  try {
    const response =
      await fetch(
        `/api/participants/${id}`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              name
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      alert(
        data.error ||
        "姓名更新失敗"
      );

      return;
    }

    resetAutoLockTimer();

    await loadRanking();

  } catch {
    alert(
      "目前無法修改姓名"
    );
  }
}


// =========================
// 刪除參賽者
// =========================

async function deleteParticipant(
  id
) {
  const row =
    document.querySelector(
      `.admin-participant[data-id="${id}"]`
    );

  if (!row) {
    return;
  }

  const name =
    row.querySelector(
      ".name-edit-input"
    )?.value || "";

  const confirmed =
    confirm(
      `確定要刪除「${name}」嗎？`
    );

  if (!confirmed) {
    return;
  }

  try {
    const response =
      await fetch(
        `/api/participants/${id}`,
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

    resetAutoLockTimer();

    await loadRanking();

  } catch {
    alert(
      "目前無法刪除參賽者"
    );
  }
}


// =========================
// Undo
// =========================

async function undoLastScore() {
  try {
    const response =
      await fetch(
        "/api/undo",
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

    resetAutoLockTimer();

    await loadRanking();
    await loadLogs();

  } catch {
    alert(
      "目前無法復原"
    );
  }
}


// =========================
// 操作紀錄
// =========================

async function loadLogs() {
  const panel =
    document.getElementById(
      "logsPanel"
    );

  if (!panel) {
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

    if (!response.ok) {
      return;
    }

    const data =
      await response.json();

    const logs =
      data.logs || [];

    if (!logs.length) {
      panel.innerHTML = `
        <div class="logs-empty">
          尚無操作紀錄
        </div>
      `;

      return;
    }

    panel.innerHTML =
      logs
        .map(
          (log) => `
            <div class="log-item">

              <div class="log-main">
                ${escapeHtml(
                  getLogText(log)
                )}
              </div>

              <div class="log-time">
                ${formatTime(
                  log.created_at
                )}
              </div>

            </div>
          `
        )
        .join("");

  } catch {
    panel.innerHTML = `
      <div class="logs-empty">
        無法取得操作紀錄
      </div>
    `;
  }
}


function toggleLogs() {
  const panel =
    document.getElementById(
      "logsPanel"
    );

  if (!panel) {
    return;
  }

  panel.classList.toggle(
    "hidden"
  );

  if (
    !panel.classList.contains(
      "hidden"
    )
  ) {
    loadLogs();
  }
}


function getLogText(log) {
  const name =
    log.name ||
    `參賽者 #${log.participant_id}`;

  if (
    log.action ===
    "CREATE_PARTICIPANT"
  ) {
    return `新增參賽者：${name}`;
  }

  if (
    log.action ===
    "DELETE_PARTICIPANT"
  ) {
    return `刪除參賽者：${name}`;
  }

  if (
    log.action ===
    "EDIT_NAME"
  ) {
    return `修改姓名：${name}`;
  }

  if (
    log.action ===
    "SET_SCORE"
  ) {
    return `修改分數：${name} ${log.old_score} → ${log.new_score}`;
  }

  if (
    log.action ===
    "ADJUST_SCORE"
  ) {
    return `調整分數：${name} ${log.old_score} → ${log.new_score}`;
  }

  if (
    String(log.action)
      .startsWith("UNDO:")
  ) {
    return `復原分數：${name} ${log.old_score} → ${log.new_score}`;
  }

  return log.action;
}


// =========================
// 自動鎖定
// =========================

function bindActivityEvents() {
  if (activityEventsBound) {
    return;
  }

  activityEventsBound = true;

  [
    "click",
    "keydown",
    "touchstart",
    "mousemove"
  ].forEach(
    (eventName) => {
      document.addEventListener(
        eventName,
        () => {
          if (isAdmin) {
            resetAutoLockTimer();
          }
        },
        {
          passive: true
        }
      );
    }
  );
}


function resetAutoLockTimer() {
  clearAutoLockTimer();

  if (!isAdmin) {
    return;
  }

  autoLockTimer =
    setTimeout(
      async () => {
        await logoutAdmin();
      },
      30 * 60 * 1000
    );
}


function clearAutoLockTimer() {
  if (autoLockTimer) {
    clearTimeout(
      autoLockTimer
    );

    autoLockTimer = null;
  }
}


// =========================
// 工具
// =========================

function getTopClass(rank) {
  if (rank === 1) {
    return "top-1";
  }

  if (rank === 2) {
    return "top-2";
  }

  if (rank === 3) {
    return "top-3";
  }

  if (rank === 4) {
    return "top-4";
  }

  return "";
}


function formatTime(value) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date.toLocaleString(
    "zh-TW",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}


function escapeHtml(value) {
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


adminButton.addEventListener(
  "click",
  adminLogin
);

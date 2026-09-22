const rankingList = document.getElementById("rankingList");
const updatedAt = document.getElementById("updatedAt");
const adminButton = document.getElementById("adminButton");

async function loadRanking() {
  try {
    const response = await fetch("/api/state");

    if (!response.ok) {
      throw new Error("無法取得排名資料");
    }

    const data = await response.json();

    renderRanking(data.participants || []);
    updatedAt.textContent = data.updatedAt
      ? `更新於 ${formatTime(data.updatedAt)}`
      : "尚未更新";
  } catch (error) {
    rankingList.innerHTML = `
      <div class="empty-state">
        <p>目前無法取得排名資料</p>
      </div>
    `;
  }
}

function renderRanking(participants) {
  if (!participants.length) {
    rankingList.innerHTML = `
      <div class="empty-state">
        <p>目前尚無參賽者</p>
      </div>
    `;
    return;
  }

  const sorted = [...participants].sort((a, b) => {
    return Number(b.score) - Number(a.score);
  });

  rankingList.innerHTML = sorted
    .map((participant, index) => {
      const rank = index + 1;

      return `
        <article class="rank-card ${getTopClass(rank)}">
          <div class="rank-number">
            ${rank}
          </div>

          <div class="participant-name">
            ${escapeHtml(participant.name)}
          </div>

          <div class="participant-score">
            ${Number(participant.score) || 0}
          </div>
        </article>
      `;
    })
    .join("");
}

function getTopClass(rank) {
  if (rank === 1) return "top-1";
  if (rank === 2) return "top-2";
  if (rank === 3) return "top-3";
  return "";
}

function formatTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

adminButton.addEventListener("click", () => {
  alert("管理員功能即將加入");
});

loadRanking();

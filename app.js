const DB_NAME = "lexiecho";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const SETTINGS_STORE = "settings";
const API_KEY_LOCAL = "lexiecho-api-key";

const PRESETS = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", vision: false, options: ["deepseek-chat", "deepseek-reasoner"] },
  kimi: { baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", vision: true, options: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"] },
  custom: { baseUrl: "", model: "", vision: false, options: [] },
};

let activeRoute = "home";
let currentViewDate = new Date();

// 设备检测与挂载
function detectDevice() {
  const ua = navigator.userAgent;
  const isIPad = (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) || /iPad/i.test(ua);
  const isTablet = /(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua);
  const isMobile = /Mobile|Android|iP(hone|od)|IEMobile/.test(ua);
  
  if (isIPad) document.body.classList.add('device-ipad');
  else if (isTablet) document.body.classList.add('device-android-tablet');
  else if (isMobile) document.body.classList.add('device-mobile');
  else document.body.classList.add('device-desktop');
}

const db = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(SESSION_STORE)) {
      const store = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
      store.createIndex("studyDate", "studyDate");
    }
    if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
      database.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
    }
  };
  request.onsuccess = () => resolve(request.result);
});

function storeTransaction(storeName, mode = "readonly") {
  return db.then((database) => database.transaction(storeName, mode).objectStore(storeName));
}

async function getSetting(key, fallback = null) {
  const store = await storeTransaction(SETTINGS_STORE);
  return new Promise((resolve) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result?.value ?? fallback);
  });
}

async function listSessions() {
  const store = await storeTransaction(SESSION_STORE);
  return new Promise((resolve) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.studyDate.localeCompare(a.studyDate)));
  });
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 2500);
}

// 侧边栏交互
document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  document.getElementById('app-shell').classList.toggle('sidebar-collapsed');
});

async function render() {
  const app = document.getElementById("app");
  const route = location.hash.slice(1) || "home";
  activeRoute = route;
  app.innerHTML = "";
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.route === route));
  
  if (route === "home") return renderHome(app);
  if (route === "new") return renderNew(app);
  if (route === "archive") return renderArchive(app);
  if (route === "settings") return renderSettings(app);
  location.hash = "#home";
}

async function renderHome(app) {
  app.append(document.getElementById("home-template").content.cloneNode(true));
  const sessions = await listSessions();
  const recent = app.querySelector("#recent-sessions");
  if (!sessions.length) {
    recent.innerHTML = `<p style="color:var(--muted)">暂无学习记录，请创建第一份内容。</p>`;
    return;
  }
  recent.innerHTML = sessions.slice(0, 4).map(s => 
    `<a class="session-card card" href="#study/${s.id}">
      <span style="color:var(--muted);font-size:12px">${s.studyDate}</span>
      <h3 style="margin:8px 0">${s.words?.length || 0} 个词</h3>
      <p style="color:var(--teal);font-size:13px;margin:0">点击查看详情</p>
    </a>`
  ).join("");
}

async function renderNew(app) {
  app.append(document.getElementById("new-template").content.cloneNode(true));
  app.querySelector("#study-date").value = new Date().toISOString().slice(0, 10);
  
  app.querySelector("#new-study-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = app.querySelector("#submit-btn");
    const textSpan = btn.querySelector(".btn-text");
    const spinner = btn.querySelector(".spinner");
    
    // 切换加载动画
    btn.disabled = true;
    textSpan.classList.add("hidden");
    spinner.classList.remove("hidden");
    
    // 模拟处理耗时
    setTimeout(() => {
      toast("功能开发中：此处调用生成逻辑");
      btn.disabled = false;
      textSpan.classList.remove("hidden");
      spinner.classList.add("hidden");
    }, 1500);
  });
}

// 日历渲染逻辑
async function renderArchive(app) {
  app.append(document.getElementById("archive-template").content.cloneNode(true));
  const sessions = await listSessions();
  const sessionMap = new Map(sessions.map(s => [s.studyDate, s]));
  
  const title = app.querySelector("#calendar-title");
  const grid = app.querySelector("#calendar-grid");
  
  function drawCalendar() {
    grid.innerHTML = "";
    const year = currentViewDate.getFullYear();
    const month = currentViewDate.getMonth();
    title.textContent = `${year}年 ${month + 1}月`;
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement("div");
      empty.className = "calendar-day empty";
      grid.appendChild(empty);
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cell = document.createElement("div");
      cell.className = "calendar-day";
      cell.textContent = day;
      
      if (sessionMap.has(dateStr)) {
        cell.classList.add("has-session");
        
        // 交互：长按与短按
        let pressTimer;
        cell.addEventListener("pointerdown", () => {
          pressTimer = setTimeout(() => {
            const data = sessionMap.get(dateStr);
            toast(`${dateStr}: 已学习 ${data.words?.length || 0} 词`);
            pressTimer = null;
          }, 600);
        });
        cell.addEventListener("pointerup", () => {
          if (pressTimer) {
            clearTimeout(pressTimer);
            toast("跳转到记录详情..."); // 实际项目中替换为 location.hash 跳转
          }
        });
        cell.addEventListener("pointerleave", () => clearTimeout(pressTimer));
      }
      grid.appendChild(cell);
    }
  }
  
  app.querySelector("#prev-month").addEventListener("click", () => {
    currentViewDate.setMonth(currentViewDate.getMonth() - 1);
    drawCalendar();
  });
  app.querySelector("#next-month").addEventListener("click", () => {
    currentViewDate.setMonth(currentViewDate.getMonth() + 1);
    drawCalendar();
  });
  
  drawCalendar();
}

async function renderSettings(app) {
  app.append(document.getElementById("settings-template").content.cloneNode(true));
  const saved = await getSetting("provider", { preset: "kimi" });
  
  const presetEl = app.querySelector("#provider-preset");
  const modelEl = app.querySelector("#provider-model");
  const urlEl = app.querySelector("#provider-url");
  const datalist = app.querySelector("#model-options");
  
  function updateDatalist(preset) {
    const options = PRESETS[preset]?.options || [];
    datalist.innerHTML = options.map(opt => `<option value="${opt}">`).join("");
  }
  
  presetEl.value = saved.preset;
  modelEl.value = saved.model || "";
  urlEl.value = saved.baseUrl || "";
  updateDatalist(saved.preset);
  
  presetEl.addEventListener("change", () => {
    const config = PRESETS[presetEl.value];
    urlEl.value = config.baseUrl;
    modelEl.value = config.model;
    updateDatalist(presetEl.value);
  });
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => {
  detectDevice();
  render();
});
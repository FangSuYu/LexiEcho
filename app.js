const DB_NAME = "lexiecho";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const SETTINGS_STORE = "settings";
const API_KEY_LOCAL = "lexiecho-api-key";

const PRESETS = {
  deepseek: { baseUrl: "https://api.deepseek.com", models: ["deepseek-chat", "deepseek-reasoner"] },
  kimi: { baseUrl: "https://api.moonshot.cn/v1", models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"] },
  custom: { baseUrl: "", models: [] },
};

let currentViewDate = new Date();

// 基础工具与存储
const db = new Promise((resolve) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(SESSION_STORE)) {
      database.createObjectStore(SESSION_STORE, { keyPath: "id" }).createIndex("studyDate", "studyDate");
    }
    if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
      database.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
    }
  };
  request.onsuccess = () => resolve(request.result);
});

async function storeTransaction(storeName, mode = "readonly") {
  const database = await db;
  return database.transaction(storeName, mode).objectStore(storeName);
}

async function getSetting(key, fallback = null) {
  const store = await storeTransaction(SETTINGS_STORE);
  return new Promise((resolve) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result?.value ?? fallback);
  });
}

async function setSetting(key, value) {
  const store = await storeTransaction(SETTINGS_STORE, "readwrite");
  return new Promise((resolve) => {
    store.put({ key, value }).onsuccess = () => resolve();
  });
}

async function listSessions() {
  const store = await storeTransaction(SESSION_STORE);
  return new Promise((resolve) => {
    store.getAll().onsuccess = (e) => resolve(e.target.result.sort((a, b) => b.studyDate.localeCompare(a.studyDate)));
  });
}

async function getSession(id) {
  const store = await storeTransaction(SESSION_STORE);
  return new Promise((resolve) => {
    store.get(id).onsuccess = (e) => resolve(e.target.result ?? null);
  });
}

async function saveSession(session) {
  const store = await storeTransaction(SESSION_STORE, "readwrite");
  return new Promise((resolve) => {
    store.put(session).onsuccess = () => resolve(session);
  });
}

function html(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 2500);
}

// 核心大模型生成逻辑恢复
function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
}

function buildLearnerProfile(sessions) {
  return { level: "基础较弱，优先使用高频、日常、短句表达" };
}

function generationPrompt(session, profile) {
  const sourceWords = session.words.join(", ");
  return `你是 LexiEcho 语境强化内容设计师。用户已学过以下词汇，请将其放入简单自然日常的语境。\n\n词表：${sourceWords}\n备注：${session.note || "无"}\n\n请严格只返回可解析的 JSON，不能有 Markdown 或额外说明。结构：\n{\n  "summary":"本次简短建议",\n  "words":[{\n    "term":"原词", "partOfSpeech":"词性", "meaning":"中文义",\n    "examples":[{"english":"简单英文例句", "chinese":"准确翻译"}]\n  }],\n  "readings":{\n    "daily":{"title":"短文标题", "content":"英文短文", "translation":"中文译文", "difficultyNote":"难度说明"},\n    "iPlusOne":{"title":"i+1阅读标题", "content":"短文", "translation":"译文", "difficultyNote":"说明"}\n  }\n}`;
}

async function generateContent(session, provider, priorSessions, apiKey) {
  const prompt = generationPrompt(session, buildLearnerProfile(priorSessions));
  const bodyParams = {
    model: provider.model,
    messages: [
      { role: "system", content: "你必须输出严格、有效的 JSON。" },
      { role: "user", content: prompt }
    ],
    response_format: provider.preset === "kimi" ? { type: "json_object" } : { type: "json_object" }
  };
  
  const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(bodyParams),
  });
  
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`接口返回异常: ${response.status} ${detail.slice(0, 100)}`);
  }
  
  const payload = await response.json();
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new Error("模型返回了空内容");
  
  const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim());
  return normalizeContent(parsed, session.words);
}

function normalizeContent(data, inputWords) {
  const words = (data.words || []).map((word, i) => ({
    id: `word-${i}`, term: word.term || inputWords[i], partOfSpeech: word.partOfSpeech || "", meaning: word.meaning || "",
    examples: (word.examples || []).map(e => ({ english: e.english || "", chinese: e.chinese || "" }))
  }));
  return { summary: data.summary || "", words, readings: data.readings || { daily: {}, iPlusOne: {} } };
}

// 页面渲染控制
async function render() {
  const app = document.getElementById("app");
  const route = location.hash.slice(1) || "home";
  app.innerHTML = "";
  
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route.split('/')[0]);
  });
  
  if (route === "home") return renderHome(app);
  if (route === "new") return renderNew(app);
  if (route === "archive") return renderArchive(app);
  if (route === "settings") return renderSettings(app);
  if (route.startsWith("study/")) return renderStudy(app, route.slice(6));
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
    const wordText = app.querySelector("#word-list").value;
    const words = wordText.split(/[\n,;，；]+/).map(w => w.trim()).filter(Boolean);
    if (!words.length) return toast("请先输入词表。");
    
    const provider = await getSetting("provider");
    const apiKey = localStorage.getItem(API_KEY_LOCAL);
    if (!apiKey || !provider?.baseUrl || !provider?.model) {
       toast("请先在“模型与数据”配置 API 密钥和接口。");
       return location.hash = "#settings";
    }

    const btn = app.querySelector("#submit-btn");
    const textSpan = btn.querySelector(".btn-text");
    const spinner = btn.querySelector(".spinner");
    btn.disabled = true;
    textSpan.classList.add("hidden");
    spinner.classList.remove("hidden");

    const session = {
      id: crypto.randomUUID(), studyDate: app.querySelector("#study-date").value,
      words, note: app.querySelector("#session-note").value.trim(), status: "generating"
    };
    await saveSession(session);

    try {
      const priorSessions = await listSessions();
      const content = await generateContent(session, provider, priorSessions, apiKey);
      session.status = "ready";
      session.content = content;
      await saveSession(session);
      location.hash = `#study/${session.id}`;
    } catch (error) {
      session.status = "failed";
      await saveSession(session);
      toast(`生成失败: ${error.message}`);
    } finally {
      btn.disabled = false;
      textSpan.classList.remove("hidden");
      spinner.classList.add("hidden");
    }
  });
}

// 恢复 renderStudy
async function renderStudy(app, id) {
  const session = await getSession(id);
  if (!session || session.status !== "ready") {
    app.innerHTML = `<section class="page page-header"><h1>记录不可用或未就绪</h1><a class="button primary" href="#home">返回概览</a></section>`;
    return;
  }
  const { content } = session;
  app.innerHTML = `<section class="page study-page">
    <header class="study-top">
      <div><h1>今日强化</h1><p>${html(content.summary)}</p></div>
    </header>
    <nav class="word-nav">${content.words.map(w => `<a class="word-chip" href="#${w.id}">${html(w.term)}</a>`).join("")}</nav>
    ${content.words.map(w => `
      <article class="word-card card" id="${w.id}">
        <header class="word-heading"><h2>${html(w.term)}</h2><span class="pos">${html(w.partOfSpeech)}</span></header>
        <p class="meaning">${html(w.meaning)}</p>
        <div class="examples">
          ${w.examples.map(ex => `<div class="example"><p class="english">${html(ex.english)}</p><p class="chinese">${html(ex.chinese)}</p></div>`).join("")}
        </div>
      </article>
    `).join("")}
    <article class="card reading-card" style="margin-top:20px;">
      <h2>当天词汇串联短文</h2>
      <div class="reading-text">${html(content.readings.daily.content)}</div>
      <p style="color:var(--muted); font-size:14px; margin-top:15px;">${html(content.readings.daily.translation)}</p>
    </article>
  </section>`;
}

async function renderArchive(app) {
  app.append(document.getElementById("archive-template").content.cloneNode(true));
  const sessions = await listSessions();
  const sessionMap = new Map(sessions.map(s => [s.studyDate, s]));
  const title = app.querySelector("#calendar-title");
  const grid = app.querySelector("#calendar-grid");
  
  function drawCalendar() {
    grid.innerHTML = "";
    const year = currentViewDate.getFullYear(), month = currentViewDate.getMonth();
    title.textContent = `${year}年 ${month + 1}月`;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    for (let i = 0; i < firstDay; i++) grid.appendChild(Object.assign(document.createElement("div"), { className: "calendar-day empty" }));
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cell = document.createElement("div");
      cell.className = "calendar-day";
      cell.textContent = day;
      if (sessionMap.has(dateStr)) {
        cell.classList.add("has-session");
        let pressTimer;
        cell.addEventListener("pointerdown", () => {
          pressTimer = setTimeout(() => { toast(`${dateStr}: 已学习 ${sessionMap.get(dateStr).words?.length || 0} 词`); pressTimer = null; }, 600);
        });
        cell.addEventListener("pointerup", () => {
          if (pressTimer) { clearTimeout(pressTimer); location.hash = `#study/${sessionMap.get(dateStr).id}`; }
        });
        cell.addEventListener("pointerleave", () => clearTimeout(pressTimer));
      }
      grid.appendChild(cell);
    }
  }
  app.querySelector("#prev-month").addEventListener("click", () => { currentViewDate.setMonth(currentViewDate.getMonth() - 1); drawCalendar(); });
  app.querySelector("#next-month").addEventListener("click", () => { currentViewDate.setMonth(currentViewDate.getMonth() + 1); drawCalendar(); });
  drawCalendar();
}

async function renderSettings(app) {
  app.append(document.getElementById("settings-template").content.cloneNode(true));
  const saved = await getSetting("provider", { preset: "kimi" });
  
  const presetEl = app.querySelector("#provider-preset");
  const urlEl = app.querySelector("#provider-url");
  const selectModelEl = app.querySelector("#provider-model-select");
  const inputModelEl = app.querySelector("#provider-model-input");
  const keyEl = app.querySelector("#provider-key");
  
  function updateModelUI(preset, currentModel) {
    if (preset === "custom") {
      selectModelEl.style.display = "none";
      selectModelEl.removeAttribute("required");
      inputModelEl.style.display = "block";
      inputModelEl.setAttribute("required", "required");
      inputModelEl.value = currentModel || "";
    } else {
      inputModelEl.style.display = "none";
      inputModelEl.removeAttribute("required");
      selectModelEl.style.display = "block";
      selectModelEl.setAttribute("required", "required");
      const models = PRESETS[preset].models;
      selectModelEl.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join("");
      if (models.includes(currentModel)) selectModelEl.value = currentModel;
    }
  }
  
  presetEl.value = saved.preset || "kimi";
  urlEl.value = saved.baseUrl || PRESETS[presetEl.value].baseUrl;
  updateModelUI(presetEl.value, saved.model);
  keyEl.value = localStorage.getItem(API_KEY_LOCAL) || "";
  
  presetEl.addEventListener("change", () => {
    const config = PRESETS[presetEl.value];
    if (presetEl.value !== "custom") urlEl.value = config.baseUrl;
    updateModelUI(presetEl.value, config.models[0]);
  });
  
  // 修复遗失的设置提交逻辑
  app.querySelector("#provider-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const preset = presetEl.value;
    const model = preset === "custom" ? inputModelEl.value.trim() : selectModelEl.value;
    await setSetting("provider", { preset, baseUrl: normalizeBaseUrl(urlEl.value), model });
    
    if (keyEl.value.trim()) localStorage.setItem(API_KEY_LOCAL, keyEl.value.trim());
    toast("配置已保存，API Key 存储在设备本地。");
  });
}

// 初始化
function detectDevice() {
  const ua = navigator.userAgent;
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1 || /iPad/i.test(ua)) document.body.classList.add('device-ipad');
  else if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) document.body.classList.add('device-android-tablet');
  else if (/Mobile|Android|iP(hone|od)|IEMobile/.test(ua)) document.body.classList.add('device-mobile');
}

document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  document.getElementById('app-shell').classList.toggle('sidebar-collapsed');
});
window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => { detectDevice(); render(); });
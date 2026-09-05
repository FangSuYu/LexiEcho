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

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
}

// 扩充后支持详细语法、时态、短语与双篇阅读逐句解析的 Prompt
function generationPrompt(session) {
  const sourceWords = session.words.join(", ");
  return `你是高级英语深度学习与语境强化系统。用户提供了以下今日词表，请生成详尽、高质量的强化数据。\n\n词表：${sourceWords}\n备注：${session.note || "无"}\n\n请严格仅返回纯 JSON，不包含 Markdown 标记或其他任何额外说明。JSON 格式结构如下：\n{\n  "summary": "本次学习核心方向概括",\n  "words": [\n    {\n      "term": "单词/短语原词",\n      "partOfSpeech": "词性缩写，如 n. / v. / adj.",\n      "meaning": "准确中文释义",\n      "forms": "不同时态/变形形式（如过去式、复数等，若无填无）",\n      "phrases": ["常用短语搭配1", "搭配2"],\n      "prepositionUsage": "介词搭配及其底层使用逻辑说明（若适用）",\n      "examples": [\n        {\n          "english": "经典英文例句",\n          "chinese": "中文翻译",\n          "grammarNote": "该句子的核心语法拆解与为何如此使用的解析"\n        }\n      ]\n    }\n  ],\n  "readings": {\n    "daily": {\n      "title": "短文1：当天词汇串联实战",\n      "sentences": [\n        {\n          "english": "英文句子内容...",\n          "chinese": "对应的中文翻译...",\n          "explanation": "本句语法结构、短语应用与介词考点详细解释"\n        }\n      ]\n    },\n    "iPlusOne": {\n      "title": "短文2：i+1 进阶拓展阅读",\n      "sentences": [\n        {\n          "english": "英文句子内容...",\n          "chinese": "对应的中文翻译...",\n          "explanation": "本句语法与核心考点详细解释"\n        }\n      ]\n    }\n  }\n}`;
}

async function generateContent(session, provider, priorSessions, apiKey) {
  const prompt = generationPrompt(session);
  const bodyParams = {
    model: provider.model,
    messages: [
      { role: "system", content: "你必须输出严格、有效的 JSON。不要包含任何 markdown 代码块符号。" },
      { role: "user", content: prompt }
    ],
    response_format: { type: "json_object" }
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
  
  const cleanJson = raw.replace(/^```json\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(cleanJson);
  return normalizeContent(parsed, session.words);
}

function normalizeContent(data, inputWords) {
  const words = (data.words || []).map((word, i) => ({
    id: `word-${i}`, 
    term: word.term || inputWords[i] || "", 
    partOfSpeech: word.partOfSpeech || "", 
    meaning: word.meaning || "",
    forms: word.forms || "无",
    phrases: Array.isArray(word.phrases) ? word.phrases : [],
    prepositionUsage: word.prepositionUsage || "",
    examples: (word.examples || []).map(e => ({ english: e.english || "", chinese: e.chinese || "", grammarNote: e.grammarNote || "" }))
  }));
  
  const formatReadings = (section) => ({
    title: section?.title || "阅读文章",
    sentences: (section?.sentences || []).map(s => ({
      english: s.english || "",
      chinese: s.chinese || "",
      explanation: s.explanation || ""
    }))
  });

  return { 
    summary: data.summary || "", 
    words, 
    readings: {
      daily: formatReadings(data.readings?.daily),
      iPlusOne: formatReadings(data.readings?.iPlusOne)
    } 
  };
}

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

// 修复点击单词跳回主页的 Bug，并实现左右/上下滑动卡片、模糊搜索、双篇阅读逐句互动、词汇覆盖率统计
async function renderStudy(app, id) {
  const session = await getSession(id);
  if (!session || session.status !== "ready") {
    app.innerHTML = `<section class="page page-header"><h1>记录不可用或未就绪</h1><a class="button primary" href="#home">返回概览</a></section>`;
    return;
  }
  const { content } = session;
  
  // 计算短文1中哪些原词被用到，哪些没被用到
  const dailyTextFull = (content.readings.daily.sentences || []).map(s => s.english).join(" ").toLowerCase();
  const usedWords = [];
  const unusedWords = [];
  content.words.forEach(w => {
    const termLower = w.term.toLowerCase();
    if (dailyTextFull.includes(termLower)) {
      usedWords.push(w.term);
    } else {
      unusedWords.push(w.term);
    }
  });

  app.innerHTML = `<section class="page study-page">
    <header class="study-top">
      <div>
        <h1>学习详情 (${session.studyDate})</h1>
        <p>${html(content.summary)}</p>
      </div>
      <a class="button secondary" href="#archive" style="font-size:13px; padding:8px 14px;">返回档案</a>
    </header>

    <!-- 词汇覆盖率面板 -->
    <div class="coverage-panel card" style="padding:16px; margin-bottom:20px;">
      <h3 style="margin:0 0 8px 0; font-size:15px;">📊 短文1词汇串联覆盖检查</h3>
      <p style="margin:4px 0;">已在短文中串联使用的词：<span class="used">${usedWords.length ? html(usedWords.join(', ')) : '无'}</span></p>
      <p style="margin:4px 0;">未被短文1直接覆盖的词：<span class="unused">${unusedWords.length ? html(unusedWords.join(', ')) : '无（全员覆盖！）'}</span></p>
    </div>

    <!-- 搜索过滤与卡片滑动容器 -->
    <div class="deck-tools">
      <input type="text" id="word-search-input" placeholder="🔍 输入关键词模糊搜索卡片..." />
    </div>

    <div class="word-carousel" id="word-carousel">
      ${content.words.map(w => `
        <article class="word-card card searchable-card" id="${w.id}" data-term="${html(w.term.toLowerCase())}">
          <header class="word-heading">
            <h2>${html(w.term)}</h2>
            <span class="pos">${html(w.partOfSpeech)}</span>
          </header>
          <p class="meaning" style="font-size:16px; font-weight:600; margin:6px 0;">${html(w.meaning)}</p>
          <div class="meta-section"><strong>形态/时态:</strong> ${html(w.forms)}</div>
          <div class="meta-section"><strong>常用短语:</strong> ${html(w.phrases.join(" / "))}</div>
          ${w.prepositionUsage ? `<div class="meta-section"><strong>介词及用法逻辑:</strong> ${html(w.prepositionUsage)}</div>` : ''}
          <div class="examples-list" style="margin-top:12px;">
            ${w.examples.map(ex => `
              <div class="example-box">
                <p class="english">${html(ex.english)}</p>
                <p class="chinese">${html(ex.chinese)}</p>
                ${ex.grammarNote ? `<p class="grammar-note">💡 语法解析: ${html(ex.grammarNote)}</p>` : ''}
              </div>
            `).join("")}
          </div>
        </article>
      `).join("")}
    </div>

    <!-- 短文1：当天词汇串联短文 -->
    <article class="card reading-card">
      <h2 style="margin-top:0;">${html(content.readings.daily.title)}</h2>
      <p style="font-size:13px; color:var(--muted); margin-bottom:15px;">点击任意英文句子可展开中译与深度解析；点击句中的高亮核心词汇可直达上方卡片！</p>
      <div class="sentences-container">
        ${renderInteractiveSentences(content.readings.daily.sentences, content.words)}
      </div>
    </article>

    <!-- 短文2：i+1 进阶拓展阅读 -->
    <article class="card reading-card" style="margin-top:25px;">
      <h2 style="margin-top:0;">${html(content.readings.iPlusOne.title)}</h2>
      <p style="font-size:13px; color:var(--muted); margin-bottom:15px;">点击任意句子查看译文与语法要点：</p>
      <div class="sentences-container">
        ${renderInteractiveSentences(content.readings.iPlusOne.sentences, content.words)}
      </div>
    </article>
  </section>`;

  // 绑定搜索与卡片滚动定位逻辑
  const searchInput = app.querySelector("#word-search-input");
  const carousel = app.querySelector("#word-carousel");
  const cards = app.querySelectorAll(".searchable-card");

  searchInput.addEventListener("input", (e) => {
    const query = e.target.value.trim().toLowerCase();
    if (!query) {
      cards.forEach(c => c.style.display = "block");
      return;
    }
    let targetCard = null;
    cards.forEach(c => {
      const term = c.dataset.term;
      if (term.includes(query)) {
        c.style.display = "block";
        if (!targetCard) targetCard = c;
      } else {
        c.style.display = "none";
      }
    });
    if (targetCard) {
      targetCard.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  });

  // 绑定逐句点击展开交互
  app.querySelectorAll(".sentence-item").forEach(item => {
    item.addEventListener("click", (e) => {
      // 如果点击的是高亮单词，则不触发整句折叠展开，而是滚动定位到对应卡片
      if (e.target.classList.contains("interactive-word")) {
        const targetId = e.target.dataset.targetId;
        const cardEl = app.querySelector(`#${targetId}`);
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
          cardEl.style.transform = "scale(1.02)";
          setTimeout(() => cardEl.style.transform = "none", 400);
        }
        return;
      }
      item.classList.toggle("active");
    });
  });
}

// 渲染带有词汇高亮与点击穿透的句子
function renderInteractiveSentences(sentences = [], words = []) {
  if (!sentences.length) return `<p style="color:var(--muted)">暂无文章内容</p>`;
  
  // 按词汇长度降序排列，避免短词优先误匹配
  const sortedWords = [...words].sort((a, b) => b.term.length - a.term.length);

  return sentences.map(s => {
    let htmlText = html(s.english);
    // 将句子中的目标单词替换为可交互、可高亮的 span 标签
    sortedWords.forEach(w => {
      const termEscaped = w.term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b(${termEscaped})\\b`, "gi");
      htmlText = htmlText.replace(regex, `<span class="interactive-word" data-target-id="${w.id}" title="点击查看单词卡片">$1</span>`);
    });

    return `
      <div class="sentence-item">
        <div class="sentence-en">${htmlText}</div>
        <div class="sentence-trans">
          <strong>中文翻译：</strong>${html(s.chinese)}<br/>
          <strong style="color:var(--teal);">语法与短语解析：</strong>${html(s.explanation)}
        </div>
      </div>
    `;
  }).join("");
}

// 档案页面：实现双击日期查看简略信息
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
        const sData = sessionMap.get(dateStr);
        
        // 单击直接进入详情
        cell.addEventListener("click", () => {
          location.hash = `#study/${sData.id}`;
        });
        
        // 双击查看简略信息 (兼容双击事件与双击时间戳判断)
        let lastClickTime = 0;
        cell.addEventListener("touchend", (e) => {
          const currentTime = new Date().getTime();
          if (currentTime - lastClickTime < 300) {
            e.preventDefault();
            toast(`📅 ${dateStr} 简略：已学习 ${sData.words?.length || 0} 个单词`);
          }
          lastClickTime = currentTime;
        });
        
        cell.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          toast(`📅 ${dateStr} 简略：已学习 ${sData.words?.length || 0} 个单词`);
        });
      }
      grid.appendChild(cell);
    }
  }
  
  app.querySelector("#prev-month").addEventListener("click", () => { currentViewDate.setMonth(currentViewDate.getMonth() - 1); drawCalendar(); });
  app.querySelector("#next-month").addEventListener("click", () => { currentViewDate.setMonth(currentViewDate.getMonth() + 1); drawCalendar(); });
  drawCalendar();
}

// 修复清空本地数据按钮无效问题，并新增导入功能
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
  
  app.querySelector("#provider-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const preset = presetEl.value;
    const model = preset === "custom" ? inputModelEl.value.trim() : selectModelEl.value;
    await setSetting("provider", { preset, baseUrl: normalizeBaseUrl(urlEl.value), model });
    
    if (keyEl.value.trim()) localStorage.setItem(API_KEY_LOCAL, keyEl.value.trim());
    toast("配置已保存，API Key 存储在设备本地。");
  });

  // 导出备份
  app.querySelector("#export-data").addEventListener("click", async () => {
    const sessions = await listSessions();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(sessions, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `lexiecho_backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    toast("学习档案备份导出成功！");
  });

  // 导入备份
  app.querySelector("#import-data-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedSessions = JSON.parse(event.target.result);
        if (!Array.isArray(importedSessions)) throw new Error("文件格式不正确");
        const store = await storeTransaction(SESSION_STORE, "readwrite");
        for (const s of importedSessions) {
          store.put(s);
        }
        toast(`成功导入 ${importedSessions.length} 条学习档案！`);
        setTimeout(() => location.hash = "#home", 1000);
      } catch (err) {
        toast(`导入失败: ${err.message}`);
      }
    };
    reader.readAsText(file);
  });

  // 彻底修复清空本地数据按钮
  app.querySelector("#clear-data").addEventListener("click", async () => {
    if (!confirm("确定要清空本设备所有的学习档案吗？此操作无法撤销。")) return;
    const database = await db;
    const tx = database.transaction([SESSION_STORE, SETTINGS_STORE], "readwrite");
    tx.objectStore(SESSION_STORE).clear();
    tx.objectStore(SETTINGS_STORE).clear();
    tx.oncomplete = () => {
      localStorage.removeItem(API_KEY_LOCAL);
      toast("本地数据已全部清空。");
      setTimeout(() => location.reload(), 1000);
    };
    tx.onerror = () => {
      toast("清空数据失败，请重试。");
    };
  });
}

// 增强设备识别，完美适配 iPad Safari 与 iPad Chrome
function detectDevice() {
  const ua = navigator.userAgent;
  if (/CriOS/i.test(ua) && (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1))) {
    document.body.classList.add('device-ipad-chrome');
  } else if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1 || /iPad/i.test(ua)) {
    document.body.classList.add('device-ipad');
  } else if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    document.body.classList.add('device-android-tablet');
  } else if (/Mobile|Android|iP(hone|od)|IEMobile/.test(ua)) {
    document.body.classList.add('device-mobile');
  }
}

document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  document.getElementById('app-shell').classList.toggle('sidebar-collapsed');
});
window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => { detectDevice(); render(); });
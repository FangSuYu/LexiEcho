const DB_NAME = "lexiecho";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const SETTINGS_STORE = "settings";
const API_KEY_LOCAL = "lexiecho-api-key";

const PRESETS = {
  deepseek: { baseUrl: "https://api.deepseek.com", models: ["deepseek-v4-flash", "deepseek-v4-pro"] },
  kimi: { baseUrl: "https://api.moonshot.cn/v1", models: ["kimi-k2.6", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k3"] },
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

function generationPrompt(session) {
  const sourceWords = session.words.join(", ");
  return `你是一个专为英语零基础/薄弱初学者设计的深度语境强化系统。用户提供了以下今日背诵的单词清单，请为每个单词拆分不同词性的中文含义，构建贴近日常生活的造句，并生成两篇阅读短文。

词表：${sourceWords}
补充说明：${session.note || "基础较弱，需要详细解释介词、语法与结构"}

请严格按 JSON 输出，不要带有任何 Markdown 标记或解释性文字。JSON 结构必须严格如下：
{
  "summary": "本次学习内容的核心主题与难度概括",
  "words": [
    {
      "term": "单词/短语原词",
      "phonetic": "/音标/",
      "senses": [
        {
          "partOfSpeech": "词性（如 n. / v. / adj.）",
          "meaning": "该词性下的准确中文释义",
          "examples": [
            {
              "english": "贴近生活的简单英文例句",
              "chinese": "中文对照翻译",
              "grammarNote": "该句子的详细语法成分拆解"
            }
          ]
        }
      ],
      "forms": "单词的时态/单复数变形",
      "phrases": ["常用搭配1", "常用搭配2"],
      "prepositionUsage": "核心介词搭配及其底层使用逻辑"
    }
  ],
  "readings": {
    "daily": {
      "title": "短文1：当天词汇串联实战",
      "sentences": [
        {
          "english": "英文句子内容...",
          "chinese": "对应的中文翻译...",
          "explanation": "本句核心语法结构、关键介词与用词解析"
        }
      ]
    },
    "iPlusOne": {
      "title": "短文2：i+1 进阶拓展阅读",
      "sentences": [
        {
          "english": "英文句子内容...",
          "chinese": "对应的中文翻译...",
          "explanation": "本句语法结构与核心考点解析"
        }
      ]
    }
  }
}`;
}

async function generateContent(session, provider, priorSessions, apiKey) {
  const prompt = generationPrompt(session);
  const messages = [
    { role: "system", content: "你必须输出严格、有效的 JSON。绝对不要包含 markdown 标记。" },
    { role: "user", content: prompt }
  ];

  // 调用 modelClient 中的统一 callModel 方法
  const res = await callModel(provider.model, messages, { apiKey });
  const raw = res.content;
  if (!raw) throw new Error("模型返回了空内容");

  const cleanJson = raw.replace(/^```json\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(cleanJson);
  return normalizeContent(parsed, session.words);
}

function normalizeContent(data, inputWords) {
  const words = (data.words || []).map((word, i) => ({
    id: `word-${i}`, 
    term: word.term || inputWords[i] || "", 
    phonetic: word.phonetic || "",
    senses: (word.senses || []).map(s => ({
      partOfSpeech: s.partOfSpeech || "n./v.",
      meaning: s.meaning || "",
      examples: (s.examples || []).map(e => ({
        english: e.english || "",
        chinese: e.chinese || "",
        grammarNote: e.grammarNote || ""
      }))
    })),
    forms: word.forms || "无",
    phrases: Array.isArray(word.phrases) ? word.phrases : [],
    prepositionUsage: word.prepositionUsage || "",
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
    recent.innerHTML = `<p style="color:var(--muted)">暂无学习记录，请创建第一份今日学习。</p>`;
    return;
  }
  recent.innerHTML = sessions.slice(0, 4).map(s => 
    `<a class="session-card card" href="#study/${s.id}">
      <span style="color:var(--muted);font-size:12px">${s.studyDate}</span>
      <h3 style="margin:8px 0">${s.words?.length || 0} 个词</h3>
      <p style="color:var(--teal);font-size:13px;margin:0">点击查看强化详情</p>
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
    if (!apiKey || !provider?.model) {
       toast("请先在“模型与数据配置”中设置 API Key 和接口。");
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

async function renderStudy(app, id) {
  const session = await getSession(id);
  if (!session || session.status !== "ready") {
    app.innerHTML = `<section class="page page-header"><h1>记录不可用或未就绪</h1><a class="button primary" href="#home">返回概览</a></section>`;
    return;
  }
  const { content } = session;
  
  const dailyTextFull = (content.readings.daily.sentences || []).map(s => s.english).join(" ").toLowerCase();
  const usedWords = [];
  const unusedWords = [];
  content.words.forEach(w => {
    if (dailyTextFull.includes(w.term.toLowerCase())) {
      usedWords.push(w.term);
    } else {
      unusedWords.push(w.term);
    }
  });

  app.innerHTML = `<section class="page study-page">
    <header class="study-top">
      <div>
        <h1>学习强化详情 (${session.studyDate})</h1>
        <p style="color:var(--muted); margin:4px 0;">${html(content.summary)}</p>
      </div>
      <a class="button secondary" href="#archive" style="font-size:13px; padding:8px 14px;">返回档案</a>
    </header>

    <div class="coverage-panel card">
      <h3 style="margin:0 0 8px 0; font-size:15px; color:var(--ink);">📊 短文1 (当天词汇串联) 覆盖率检查</h3>
      <p style="margin:4px 0;">已在短文中出现的词：<span class="used">${usedWords.length ? html(usedWords.join(', ')) : '无'}</span></p>
      <p style="margin:4px 0;">尚未在短文中出现的词：<span class="unused">${unusedWords.length ? html(unusedWords.join(', ')) : '无（全部覆盖！）'}</span></p>
    </div>

    <div class="deck-tools">
      <input type="text" id="word-search-input" placeholder="🔍 输入词汇或拼写模糊搜索卡片..." style="max-width:400px;" />
    </div>

    <div class="word-masonry-grid" id="word-masonry-grid">
      ${content.words.map(w => `
        <article class="word-card card searchable-card" id="${w.id}" data-term="${html(w.term.toLowerCase())}">
          <div class="word-head-title">
            <h2>${html(w.term)}</h2>
            ${w.phonetic ? `<span class="phonetic">${html(w.phonetic)}</span>` : ''}
          </div>

          ${(w.senses && w.senses.length) ? w.senses.map(sense => `
            <div class="pos-block">
              <div>
                <span class="pos-badge">${html(sense.partOfSpeech)}</span>
                <span class="pos-meaning">${html(sense.meaning)}</span>
              </div>
              ${(sense.examples || []).map(ex => `
                <div class="example-box">
                  <p class="english">${html(ex.english)}</p>
                  <p class="chinese">${html(ex.chinese)}</p>
                  ${ex.grammarNote ? `<p class="grammar-note">💡 语法拆解: ${html(ex.grammarNote)}</p>` : ''}
                </div>
              `).join('')}
            </div>
          `).join('') : '<p style="color:var(--muted)">暂无分词性说明</p>'}

          ${w.forms && w.forms !== "无" ? `<div class="meta-row"><strong>变形/时态:</strong> ${html(w.forms)}</div>` : ''}
          ${w.phrases && w.phrases.length ? `<div class="meta-row"><strong>常用搭配:</strong> ${html(w.phrases.join(" / "))}</div>` : ''}
          ${w.prepositionUsage ? `<div class="meta-row"><strong>介词及用法:</strong> ${html(w.prepositionUsage)}</div>` : ''}
        </article>
      `).join("")}
    </div>

    <article class="card reading-card">
      <h2 style="margin-top:0;">${html(content.readings.daily.title)}</h2>
      <p style="font-size:13px; color:var(--muted); margin-bottom:15px;">点击任意句子查看中文翻译与深度语法；点击句子中的高亮单词可直达上方的单词卡片：</p>
      <div class="sentences-container">
        ${renderInteractiveSentences(content.readings.daily.sentences, content.words)}
      </div>
    </article>

    <article class="card reading-card">
      <h2 style="margin-top:0;">${html(content.readings.iPlusOne.title)}</h2>
      <p style="font-size:13px; color:var(--muted); margin-bottom:15px;">根据个人学习画像生成的进阶短文，点击句子展开分析：</p>
      <div class="sentences-container">
        ${renderInteractiveSentences(content.readings.iPlusOne.sentences, content.words)}
      </div>
    </article>
  </section>`;

  const searchInput = app.querySelector("#word-search-input");
  const cards = app.querySelectorAll(".searchable-card");
  searchInput.addEventListener("input", (e) => {
    const query = e.target.value.trim().toLowerCase();
    cards.forEach(c => {
      const term = c.dataset.term;
      c.style.display = (!query || term.includes(query)) ? "flex" : "none";
    });
  });

  app.querySelectorAll(".sentence-item").forEach(item => {
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("interactive-word")) {
        const targetId = e.target.dataset.targetId;
        const cardEl = app.querySelector(`#${targetId}`);
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
          cardEl.style.transform = "scale(1.03)";
          cardEl.style.borderColor = "var(--teal)";
          setTimeout(() => {
            cardEl.style.transform = "none";
            cardEl.style.borderColor = "var(--line)";
          }, 800);
        }
        return;
      }
      item.classList.toggle("active");
    });
  });
}

function renderInteractiveSentences(sentences = [], words = []) {
  if (!sentences.length) return `<p style="color:var(--muted)">暂无短文内容</p>`;
  const sortedWords = [...words].sort((a, b) => b.term.length - a.term.length);

  return sentences.map(s => {
    let htmlText = html(s.english);
    sortedWords.forEach(w => {
      const termEscaped = w.term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b(${termEscaped})\\b`, "gi");
      htmlText = htmlText.replace(regex, `<span class="interactive-word" data-target-id="${w.id}" title="点击定位到该词卡片">$1</span>`);
    });

    return `
      <div class="sentence-item">
        <div class="sentence-en">${htmlText}</div>
        <div class="sentence-trans">
          <strong>中文翻译：</strong>${html(s.chinese)}<br/>
          <strong style="color:var(--teal);">语法与表达解析：</strong>${html(s.explanation)}
        </div>
      </div>
    `;
  }).join("");
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
        const sData = sessionMap.get(dateStr);
        
        cell.addEventListener("click", () => {
          location.hash = `#study/${sData.id}`;
        });
        
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
    toast("配置保存成功！");
  });

  app.querySelector("#export-data").addEventListener("click", async () => {
    const sessions = await listSessions();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(sessions, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `lexiecho_backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    toast("学习档案备份已导出！");
  });

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
  });
}

document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  document.getElementById('app-shell').classList.toggle('sidebar-collapsed');
});
window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);
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

// 词性全称与中文映射字典
const POS_MAP = {
  "n.": "n. | noun | 名词",
  "v.": "v. | verb | 动词",
  "vt.": "vt. | transitive verb | 及物动词",
  "vi.": "vi. | intransitive verb | 不及物动词",
  "adj.": "adj. | adjective | 形容词",
  "adv.": "adv. | adverb | 副词",
  "prep.": "prep. | preposition | 介词",
  "conj.": "conj. | conjunction | 连词",
  "pron.": "pron. | pronoun | 代词",
  "num.": "num. | numeral | 数词",
  "art.": "art. | article | 冠词",
  "interj.": "interj. | interjection | 感叹词"
};

function formatPOS(posRaw = "") {
  const clean = posRaw.trim().toLowerCase();
  for (const key in POS_MAP) {
    if (clean.startsWith(key) || clean === key.replace('.', '')) {
      return POS_MAP[key];
    }
  }
  return posRaw ? `${posRaw} | 词性解释` : "n. | noun | 名词";
}

let currentViewDate = new Date();
let currentWordIndex = 0; // 当前选中的单词卡片索引

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
      "forms": "单词的时态/单复数变形（需包含具体变形类型说明）",
      "phrases": [
        {
          "phrase": "常用搭配短语",
          "translation": "短语中文翻译",
          "example": "包含该搭配的简单造句"
        }
      ],
      "prepositionUsage": "核心介词搭配及其底层使用逻辑（列表呈现）"
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
      partOfSpeech: s.partOfSpeech || "n.",
      meaning: s.meaning || "",
      examples: (s.examples || []).map(e => ({
        english: e.english || "",
        chinese: e.chinese || "",
        grammarNote: e.grammarNote || ""
      }))
    })),
    forms: word.forms || "暂无特殊变形",
    phrases: Array.isArray(word.phrases) ? word.phrases.map(p => typeof p === 'string' ? { phrase: p, translation: '', example: '' } : p) : [],
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

// 渲染强化学习详情页
async function renderStudy(app, id) {
  const session = await getSession(id);
  if (!session || session.status !== "ready") {
    app.innerHTML = `<section class="page page-header"><h1>记录不可用或未就绪</h1><a class="button primary" href="#home">返回概览</a></section>`;
    return;
  }
  const { content } = session;
  currentWordIndex = 0; // 默认展示第 1 个单词

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
    <!-- 1. 顶部紧凑标题与信息折叠入口 -->
    <header class="study-compact-bar card">
      <div>
        <h2 style="display:inline-block;">学习强化详情 (${session.studyDate})</h2>
        <span class="word-count-tag">${content.words.length} 词</span>
      </div>
      <button class="button secondary" id="btn-open-info" style="font-size:13px; padding:6px 14px;">查看摘要与档案 ℹ️</button>
    </header>

    <!-- 弹窗：包含概览与覆盖率检查 -->
    <div class="modal-overlay hidden" id="info-modal">
      <div class="modal-content card">
        <div class="modal-header">
          <h3 style="margin:0;">学习档案与状态概览</h3>
          <button class="modal-close" id="btn-close-modal">✕</button>
        </div>
        <p class="modal-summary"><strong>💡 本次核心概览：</strong><br/>${html(content.summary)}</p>
        <div class="coverage-panel card" style="box-shadow:none;">
          <h4 style="margin:0 0 8px 0; font-size:14px; color:var(--ink);">📊 短文1 词汇覆盖率检查</h4>
          <p style="margin:4px 0;">已覆盖词汇：<span class="used">${usedWords.length ? html(usedWords.join(', ')) : '无'}</span></p>
          <p style="margin:4px 0;">未覆盖词汇：<span class="unused">${unusedWords.length ? html(unusedWords.join(', ')) : '无（全部覆盖！）'}</span></p>
        </div>
        <div class="modal-actions">
          <a class="button secondary" href="#archive" style="margin-right:8px;">返回档案列表</a>
          <button class="button primary" id="btn-close-modal-2">关闭</button>
        </div>
      </div>
    </div>

    <!-- 2. 单词搜索与快速选择器 -->
    <div class="deck-tools">
      <input type="text" id="word-search-input" class="word-search-input" placeholder="🔍 输入单词搜索..." />
      <select id="word-select-dropdown" class="word-select-dropdown">
        ${content.words.map((w, idx) => `<option value="${idx}">${idx + 1}. ${html(w.term)}</option>`).join("")}
      </select>
    </div>

    <!-- 3. 自适应单单词卡片容器 -->
    <div class="single-card-viewport">
      <div id="active-word-card-container" style="width:100%; display:flex; justify-content:center;">
        ${renderSingleWordCard(content.words[0], 0, content.words.length)}
      </div>
    </div>

    <!-- 4. 上一个 / 下一个 导航控制 -->
    <div class="card-navigator">
      <button class="button secondary" id="btn-prev-word" disabled>◀ 上一个单词</button>
      <span id="card-progress-text" style="font-size:14px; color:var(--muted);">1 / ${content.words.length}</span>
      <button class="button secondary" id="btn-next-word" ${content.words.length <= 1 ? 'disabled' : ''}>下一个单词 ▶</button>
    </div>

    <!-- 5. 短文左右 Tab 切换卡片 -->
    <article class="card reading-swipe-container">
      <div class="reading-tabs">
        <button class="tab-btn active" data-tab="tab-daily">${html(content.readings.daily.title)}</button>
        <button class="tab-btn" data-tab="tab-iplusone">${html(content.readings.iPlusOne.title)}</button>
      </div>
      <div class="tab-content" id="tab-daily">
        <p style="font-size:13px; color:var(--muted); margin-bottom:12px;">点击任意句子查看中文翻译与深度语法；点击高亮单词可跳转定位：</p>
        <div class="sentences-container">
          ${renderInteractiveSentences(content.readings.daily.sentences, content.words)}
        </div>
      </div>
      <div class="tab-content hidden" id="tab-iplusone">
        <p style="font-size:13px; color:var(--muted); margin-bottom:12px;">根据个人画像生成的进阶短文，点击句子展开分析：</p>
        <div class="sentences-container">
          ${renderInteractiveSentences(content.readings.iPlusOne.sentences, content.words)}
        </div>
      </div>
    </article>

    <!-- 6. 悬浮速滑控件（返回顶部 / 跳转底部） -->
    <div class="floating-scroll-controls">
      <button class="floating-btn" id="btn-scroll-top" title="返回顶部">▲</button>
      <button class="floating-btn" id="btn-scroll-bottom" title="跳转底部">▼</button>
    </div>
  </section>`;

  // 事件绑定逻辑
  const modal = app.querySelector("#info-modal");
  app.querySelector("#btn-open-info").addEventListener("click", () => modal.classList.remove("hidden"));
  app.querySelector("#btn-close-modal").addEventListener("click", () => modal.classList.add("hidden"));
  app.querySelector("#btn-close-modal-2").addEventListener("click", () => modal.classList.add("hidden"));

  const dropdown = app.querySelector("#word-select-dropdown");
  const searchInput = app.querySelector("#word-search-input");

  function updateCard(index) {
    if (index < 0 || index >= content.words.length) return;
    currentWordIndex = index;
    dropdown.value = index;
    app.querySelector("#card-progress-text").textContent = `${index + 1} / ${content.words.length}`;
    app.querySelector("#active-word-card-container").innerHTML = renderSingleWordCard(content.words[index], index, content.words.length);
    app.querySelector("#btn-prev-word").disabled = (index === 0);
    app.querySelector("#btn-next-word").disabled = (index === content.words.length - 1);
    bindCardEvents();
  }

  dropdown.addEventListener("change", (e) => updateCard(parseInt(e.target.value, 10)));
  app.querySelector("#btn-prev-word").addEventListener("click", () => updateCard(currentWordIndex - 1));
  app.querySelector("#btn-next-word").addEventListener("click", () => updateCard(currentWordIndex + 1));

  // 搜索自动选中最佳匹配
  searchInput.addEventListener("input", (e) => {
    const query = e.target.value.trim().toLowerCase();
    if (!query) return;
    const matchIdx = content.words.findIndex(w => w.term.toLowerCase().includes(query));
    if (matchIdx !== -1 && matchIdx !== currentWordIndex) {
      updateCard(matchIdx);
    }
  });

  // 短文 Tab 切换事件
  app.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      app.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      app.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      e.target.classList.add("active");
      app.querySelector(`#${e.target.dataset.tab}`).classList.remove("hidden");
    });
  });

  // 交互例句与高亮词点击事件
  app.querySelectorAll(".sentence-item").forEach(item => {
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("interactive-word")) {
        const targetId = e.target.dataset.targetId;
        const targetIdx = content.words.findIndex(w => w.id === targetId);
        if (targetIdx !== -1) {
          updateCard(targetIdx);
          const cardEl = app.querySelector("#active-word-card-container");
          cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
      item.classList.toggle("active");
    });
  });

  // 悬浮置顶/置底事件
  app.querySelector("#btn-scroll-top").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  app.querySelector("#btn-scroll-bottom").addEventListener("click", () => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));

  function bindCardEvents() {
    const saveBtn = app.querySelector("#btn-save-card-img");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const cardTarget = app.querySelector("#export-word-card");
        if (typeof html2canvas === "undefined") {
          return toast("截图库正在加载中，请稍后重试...");
        }
        toast("正在生成图片，请稍候...");
        html2canvas(cardTarget, { backgroundColor: "#ffffff", scale: 2 }).then(canvas => {
          const link = document.createElement('a');
          link.download = `LexiEcho-${content.words[currentWordIndex].term}.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();
          toast("图片保存成功！");
        }).catch(err => {
          toast("生成图片失败: " + err.message);
        });
      });
    }
  }

  bindCardEvents();
}

// 渲染单个单词卡片 HTML
function renderSingleWordCard(w, index, total) {
  return `
    <article class="single-mode-card card" id="export-word-card">
      <div class="word-head-title">
        <div class="term-left-group">
          <h2 class="term-text">${html(w.term)}</h2>
          ${w.phonetic ? `<span class="phonetic-badge">${html(w.phonetic)}</span>` : ''}
        </div>
        <div>
          <button class="button secondary" id="btn-save-card-img" style="font-size:12px; padding:4px 10px; margin-right:8px;">📷 保存图片</button>
          <span style="font-size:12px; color:var(--muted); font-weight:bold;">#${index + 1}/${total}</span>
        </div>
      </div>

      <!-- 词性与释义列表 -->
      ${(w.senses && w.senses.length) ? w.senses.map(sense => `
        <div class="pos-block-item" style="margin-bottom:16px;">
          <div class="pos-header">
            <span class="pos-tag">${html(formatPOS(sense.partOfSpeech))}</span>
            <span class="pos-meaning">${html(sense.meaning)}</span>
          </div>
          ${(sense.examples || []).map(ex => `
            <div class="example-box">
              <p><span class="label-tag">英文例句</span> <span class="english">${html(ex.english)}</span></p>
              <p><span class="label-tag alt">中文翻译</span> <span class="chinese">${html(ex.chinese)}</span></p>
              ${ex.grammarNote ? `
                <div class="grammar-note">
                  <div class="grammar-title">💡 语法与结构拆解：</div>
                  <div class="grammar-detail">${html(ex.grammarNote)}</div>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `).join('') : '<p style="color:var(--muted)">暂无释义与表达</p>'}

      <!-- 变形 / 时态 -->
      <div class="meta-section">
        <div><strong>📌 变形 / 时态:</strong> ${html(w.forms)}</div>
        
        <!-- 常用搭配 (含造句) -->
        <div>
          <strong>🔗 常用搭配:</strong>
          ${w.phrases && w.phrases.length ? `
            <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">
              ${w.phrases.map(p => `
                <div style="background:#f8fafc; padding:8px 12px; border-radius:6px; border:1px solid #e2e8f0;">
                  <div style="font-weight:600; color:var(--teal);">${html(p.phrase || p)} ${p.translation ? `<span style="color:var(--muted); font-weight:normal;">— ${html(p.translation)}</span>` : ''}</div>
                  ${p.example ? `<div style="font-size:12px; color:#475569; margin-top:2px;">例: ${html(p.example)}</div>` : ''}
                </div>
              `).join('')}
            </div>
          ` : '<span style="color:var(--muted)"> 暂无常用搭配</span>'}
        </div>

        <!-- 介词及用法 -->
        <div>
          <strong>🎯 介词及用法:</strong>
          ${w.prepositionUsage ? `
            <div style="background:#f0fdf4; border-left:3px solid #22c55e; padding:8px 12px; margin-top:6px; border-radius:0 6px 6px 0; font-size:13px; line-height:1.6; color:#15803d;">
              ${html(w.prepositionUsage)}
            </div>
          ` : '<span style="color:var(--muted)"> 暂无特定介词搭配</span>'}
        </div>
      </div>
    </article>
  `;
}

function renderInteractiveSentences(sentences = [], words = []) {
  if (!sentences.length) return `<p style="color:var(--muted)">暂无短文内容</p>`;
  const sortedWords = [...words].sort((a, b) => b.term.length - a.term.length);

  return sentences.map(s => {
    let htmlText = html(s.english);
    sortedWords.forEach(w => {
      const termEscaped = w.term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b(${termEscaped})\\b`, "gi");
      htmlText = htmlText.replace(regex, `<span class="interactive-word" data-target-id="${w.id}" title="点击跳转至词汇卡片">$1</span>`);
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
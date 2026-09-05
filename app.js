const DB_NAME = "lexiecho";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const SETTINGS_STORE = "settings";
const API_KEY_SESSION = "lexiecho-api-key";
const API_KEY_LOCAL = "lexiecho-api-key-remembered";

const PRESETS = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash-vision-exp", vision: true },
  kimi: { baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k3", vision: true },
  custom: { baseUrl: "", model: "", vision: false },
};

let transientImages = [];
let activeRoute = "home";

const db = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(SESSION_STORE)) {
      const store = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt");
      store.createIndex("studyDate", "studyDate");
    }
    if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
      database.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function storeTransaction(storeName, mode = "readonly") {
  return db.then((database) => database.transaction(storeName, mode).objectStore(storeName));
}

async function getSetting(key, fallback = null) {
  const store = await storeTransaction(SETTINGS_STORE);
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result?.value ?? fallback);
    request.onerror = () => reject(request.error);
  });
}

async function setSetting(key, value) {
  const store = await storeTransaction(SETTINGS_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const request = store.put({ key, value });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function listSessions() {
  const store = await storeTransaction(SESSION_STORE);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(request.error);
  });
}

async function getSession(id) {
  const store = await storeTransaction(SESSION_STORE);
  return new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function saveSession(session) {
  const store = await storeTransaction(SESSION_STORE, "readwrite");
  session.updatedAt = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const request = store.put(session);
    request.onsuccess = () => resolve(session);
    request.onerror = () => reject(request.error);
  });
}

function html(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function textArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : item?.label || item?.text || "")).filter(Boolean);
}

function chineseDate(value) {
  if (!value) return "未设置日期";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function cloneTemplate(id) {
  return document.importNode(document.getElementById(id).content, true);
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  document.body.append(element);
  window.setTimeout(() => element.remove(), 3600);
}

function parseWords(value) {
  const words = value
    .split(/[\n,;，；]+/)
    .map((word) => word.trim().replace(/^[-•\d.\s]+/, ""))
    .filter(Boolean);
  const unique = new Map();
  words.forEach((word) => unique.set(word.toLocaleLowerCase(), word));
  return [...unique.values()];
}

function getApiKey() {
  return sessionStorage.getItem(API_KEY_SESSION) || localStorage.getItem(API_KEY_LOCAL) || "";
}

function setApiKey(key, remember) {
  sessionStorage.removeItem(API_KEY_SESSION);
  localStorage.removeItem(API_KEY_LOCAL);
  if (!key) return;
  if (remember) localStorage.setItem(API_KEY_LOCAL, key);
  else sessionStorage.setItem(API_KEY_SESSION, key);
}

async function getProvider() {
  const saved = await getSetting("provider", null);
  const preset = saved?.preset || "deepseek";
  const defaults = PRESETS[preset] || PRESETS.custom;
  const legacyModel = (preset === "deepseek" && ["deepseek-chat", "deepseek-reasoner"].includes(saved?.model))
    || (preset === "kimi" && /^moonshot-v1-/i.test(saved?.model || ""));
  return {
    preset,
    baseUrl: normalizeBaseUrl(saved?.baseUrl || saved?.url || defaults.baseUrl),
    model: legacyModel ? defaults.model : (saved?.model || defaults.model),
    vision: legacyModel ? defaults.vision : (saved?.vision ?? defaults.vision),
  };
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
}

function chatCompletionsUrl(provider) {
  return `${normalizeBaseUrl(provider.baseUrl)}/chat/completions`;
}

function setActiveNav(route) {
  const navRoute = route.startsWith("study/") ? "archive" : route;
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.route === navRoute));
}

async function render() {
  const app = document.getElementById("app");
  const route = location.hash.slice(1) || "home";
  activeRoute = route;
  app.innerHTML = "";
  setActiveNav(route);
  if (route === "home") return renderHome(app);
  if (route === "new") return renderNew(app);
  if (route === "archive") return renderArchive(app);
  if (route === "settings") return renderSettings(app);
  if (route.startsWith("study/")) return renderStudy(app, route.slice("study/".length));
  location.hash = "#home";
}

async function renderHome(app) {
  app.append(cloneTemplate("home-template"));
  const recent = app.querySelector("#recent-sessions");
  const sessions = await listSessions();
  if (!sessions.length) {
    recent.innerHTML = `<div class="empty-state">还没有学习记录。先在背词 App 完成今日学习，再创建第一份语境强化内容。</div>`;
    return;
  }
  recent.innerHTML = sessions.slice(0, 4).map((session) => sessionPreview(session)).join("");
}

function sessionPreview(session, compact = false) {
  const count = session.words?.length || 0;
  const status = session.status === "ready" ? "已生成" : session.status === "failed" ? "生成失败" : "等待生成";
  if (compact) {
    return `<a class="archive-row card" href="#study/${encodeURIComponent(session.id)}"><div><h2>${html(chineseDate(session.studyDate))}</h2><p>${count} 个词 · ${html(status)}${session.note ? ` · ${html(session.note.slice(0, 45))}` : ""}</p></div><span class="open-label">打开 →</span></a>`;
  }
  return `<a class="session-card card" href="#study/${encodeURIComponent(session.id)}"><span class="session-meta">${html(chineseDate(session.studyDate))} · ${html(status)}</span><h3>${count} 个词</h3><p>${html((session.words || []).slice(0, 4).join(" · "))}${count > 4 ? " …" : ""}</p></a>`;
}

async function renderNew(app) {
  app.append(cloneTemplate("new-template"));
  app.querySelector("#study-date").value = new Date().toISOString().slice(0, 10);
  app.querySelector("#word-images").addEventListener("change", async (event) => {
    transientImages = await Promise.all([...event.target.files].map(readImage));
    const preview = app.querySelector("#image-preview");
    preview.innerHTML = transientImages.map((image, index) => `<img src="${image.dataUrl}" alt="待识别词表截图 ${index + 1}" />`).join("");
  });
  app.querySelector("#new-study-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const words = parseWords(app.querySelector("#word-list").value);
    if (!words.length && !transientImages.length) return toast("请先输入词表，或至少上传一张词表截图。");
    const provider = await getProvider();
    if (!getApiKey() || !provider.baseUrl || !provider.model) {
      toast("请先在“模型与数据”填入 API Key、接口地址和模型名称。");
      location.hash = "#settings";
      return;
    }
    const submit = event.submitter;
    if (!words.length && transientImages.length) {
      if (!provider.vision) {
        toast("当前模型未启用图片输入。请在“模型与数据”中启用支持视觉的模型，或改为手动粘贴词表。");
        return;
      }
      submit.disabled = true;
      submit.textContent = "正在识别截图…";
      try {
        const extracted = await extractWordsFromImages(provider, transientImages);
        if (!extracted.length) throw new Error("没有从截图中识别出英文单词或短语");
        app.querySelector("#word-list").value = extracted.join("\n");
        transientImages = [];
        app.querySelector("#word-images").value = "";
        app.querySelector("#image-preview").innerHTML = "";
        toast(`已识别 ${extracted.length} 个词。请核对、修改词表后，再点击生成。`);
      } catch (error) {
        toast(`截图识别失败：${error.message || "请尝试手动粘贴词表。"}`);
      } finally {
        submit.disabled = false;
        submit.textContent = "生成语境强化内容";
      }
      return;
    }
    submit.disabled = true;
    submit.textContent = "正在生成，请稍候…";
    if (transientImages.length && !provider.vision) {
      toast("当前模型未启用图片输入。请移除截图，或在“模型与数据”中启用支持视觉的模型。");
      submit.disabled = false;
      submit.textContent = "生成语境强化内容";
      return;
    }
    const session = {
      id: crypto.randomUUID(),
      studyDate: app.querySelector("#study-date").value,
      words,
      note: app.querySelector("#session-note").value.trim(),
      status: "generating",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      content: null,
      error: null,
    };
    await saveSession(session);
    try {
      const priorSessions = await listSessions();
      const content = await generateContent(session, provider, priorSessions.filter((item) => item.id !== session.id), transientImages);
      session.status = "ready";
      session.content = content;
      session.words = content.words.map((word) => word.term);
      transientImages = [];
      await saveSession(session);
      location.hash = `#study/${session.id}`;
    } catch (error) {
      session.status = "failed";
      session.error = error.message || "模型请求失败";
      await saveSession(session);
      toast(`生成失败：${session.error}`);
      submit.disabled = false;
      submit.textContent = "生成语境强化内容";
    }
  });
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, dataUrl: reader.result });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function extractWordsFromImages(provider, images) {
  const response = await fetch(chatCompletionsUrl(provider), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getApiKey()}` },
    body: JSON.stringify(apiRequestBody(provider, [
        { role: "system", content: "你是词表截图识别助手。只能输出严格 JSON。" },
        { role: "user", content: [{ type: "text", text: "请从这些英语背词 App 截图中提取所有英文单词或短语。忽略中文释义、音标、例句、界面按钮、序号和重复项。只返回 JSON：{\"words\":[\"word or phrase\"]}" }, ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } }))] },
      ], "lexiecho_word_list", WORD_LIST_SCHEMA, 3000)),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`模型接口返回 ${response.status}：${detail.slice(0, 180)}`);
  }
  const payload = await response.json();
  const parsed = parseJsonModelContent(payload);
  return textArray(parsed.words).map((word) => word.trim()).filter(Boolean);
}

async function renderArchive(app) {
  app.append(cloneTemplate("archive-template"));
  const list = app.querySelector("#archive-list");
  const sessions = await listSessions();
  list.innerHTML = sessions.length
    ? sessions.map((session) => sessionPreview(session, true)).join("")
    : `<div class="empty-state">没有可展示的学习档案。</div>`;
}

async function renderSettings(app) {
  app.append(cloneTemplate("settings-template"));
  const provider = await getProvider();
  const preset = app.querySelector("#provider-preset");
  const url = app.querySelector("#provider-url");
  const model = app.querySelector("#provider-model");
  const key = app.querySelector("#provider-key");
  const remember = app.querySelector("#remember-key");
  const vision = app.querySelector("#vision-enabled");
  preset.value = provider.preset || "custom";
  url.value = provider.baseUrl || "";
  model.value = provider.model || "";
  key.value = getApiKey();
  remember.checked = Boolean(localStorage.getItem(API_KEY_LOCAL));
  vision.checked = Boolean(provider.vision);
  preset.addEventListener("change", () => {
    const next = PRESETS[preset.value];
    url.value = next.baseUrl;
    model.value = next.model;
    vision.checked = next.vision;
  });
  app.querySelector("#provider-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = { preset: preset.value, baseUrl: normalizeBaseUrl(url.value), model: model.value.trim(), vision: vision.checked };
    await setSetting("provider", next);
    setApiKey(key.value.trim(), remember.checked);
    setStatus(app.querySelector("#provider-status"), "模型配置已保存。API Key 不会被写入学习档案。", false);
  });
  app.querySelector("#export-data").addEventListener("click", exportData);
  app.querySelector("#import-data").addEventListener("change", importData);
  app.querySelector("#clear-data").addEventListener("click", clearData);
}

function setStatus(element, message, isError) {
  element.textContent = message;
  element.classList.toggle("error", Boolean(isError));
}

function buildLearnerProfile(sessions) {
  const feedback = {};
  sessions.forEach((session) => {
    session.content?.words?.forEach((word) => {
      (word.feedback?.tags || []).forEach((tag) => { feedback[tag] = (feedback[tag] || 0) + 1; });
    });
    Object.values(session.content?.readings || {}).forEach((reading) => {
      (reading.feedback?.tags || []).forEach((tag) => { feedback[tag] = (feedback[tag] || 0) + 1; });
    });
  });
  const difficultyTags = Object.entries(feedback).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([tag]) => tag);
  return {
    level: "基础较弱，优先使用高频、日常、短句表达",
    recurringDifficulties: difficultyTags.length ? difficultyTags : ["尚无历史反馈"],
    completedSessions: sessions.filter((item) => item.status === "ready").length,
  };
}

function generationPrompt(session, profile) {
  const sourceWords = session.words.length ? session.words.join(", ") : "未提供文字词表，请从随后附上的截图中提取英文单词或短语，忽略界面按钮、序号和无关文字。";
  return `你是 LexiEcho 的英语语境强化内容设计师。用户已经在背词 App 学过以下词，本任务不是复刻背词测试，而是帮助基础较弱的中文学习者把词放入简单、自然、日常可用的语境中。\n\n词表：${sourceWords}\n用户本次备注：${session.note || "无"}\n学习画像：${JSON.stringify(profile)}\n\n请严格只返回可解析的 JSON，不要 Markdown 代码块，不要附加说明。必须使用以下结构：\n{\n  "summary":"本次内容的中文学习建议（不超过80字）",\n  "words":[{\n    "term":"词表中的原词", "phonetic":"音标，可空", "partOfSpeech":"本次重点词性", "meaning":"核心中文义",\n    "usageNotes":"一句最重要的用法提醒", "collocations":["2到4个常用搭配"], "wordFamily":["必要时给出词形关联"],\n    "examples":[{"english":"简单自然的英文例句", "chinese":"准确中文翻译", "scene":"日常使用场景", "grammarPoints":[{"label":"语法标签", "explanation":"仅解释本句理解所必需的点"}]}]\n  }],\n  "readings":{\n    "daily":{"title":"当天词汇串联阅读标题", "content":"英文短文，使用换行分段", "translation":"完整中文译文", "coveredWords":["确实出现的目标词"], "difficultyNote":"中文难度说明"},\n    "iPlusOne":{"title":"个人 i+1 阅读标题", "content":"英文短文，使用换行分段", "translation":"完整中文译文", "coveredWords":["自然复现的旧词或目标词"], "difficultyNote":"说明本篇只增加了哪一个主要挑战维度"}\n  }\n}\n\n要求：每个词都必须出现在 words 中；例句按词汇数量与词义需要提供 1到3句。只解释实际出现在例句中的语法，每句最多两个语法点。当天串联阅读尽量自然覆盖本次词表，无法自然覆盖的词不必硬塞。i+1 阅读只提高一个主要难度维度。不得编造词义、音标或生硬、不自然的英语。`;
}

const GRAMMAR_POINT_SCHEMA = {
  type: "object",
  properties: { label: { type: "string" }, explanation: { type: "string" } },
  required: ["label", "explanation"],
  additionalProperties: false,
};

const EXAMPLE_SCHEMA = {
  type: "object",
  properties: {
    english: { type: "string" }, chinese: { type: "string" }, scene: { type: "string" },
    grammarPoints: { type: "array", items: GRAMMAR_POINT_SCHEMA },
  },
  required: ["english", "chinese", "scene", "grammarPoints"],
  additionalProperties: false,
};

const WORD_SCHEMA = {
  type: "object",
  properties: {
    term: { type: "string" }, phonetic: { type: "string" }, partOfSpeech: { type: "string" }, meaning: { type: "string" }, usageNotes: { type: "string" },
    collocations: { type: "array", items: { type: "string" } }, wordFamily: { type: "array", items: { type: "string" } }, examples: { type: "array", items: EXAMPLE_SCHEMA },
  },
  required: ["term", "phonetic", "partOfSpeech", "meaning", "usageNotes", "collocations", "wordFamily", "examples"],
  additionalProperties: false,
};

const READING_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" }, content: { type: "string" }, translation: { type: "string" }, coveredWords: { type: "array", items: { type: "string" } }, difficultyNote: { type: "string" },
  },
  required: ["title", "content", "translation", "coveredWords", "difficultyNote"],
  additionalProperties: false,
};

const GENERATED_CONTENT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" }, words: { type: "array", items: WORD_SCHEMA },
    readings: { type: "object", properties: { daily: READING_SCHEMA, iPlusOne: READING_SCHEMA }, required: ["daily", "iPlusOne"], additionalProperties: false },
  },
  required: ["summary", "words", "readings"],
  additionalProperties: false,
};

const WORD_LIST_SCHEMA = {
  type: "object",
  properties: { words: { type: "array", items: { type: "string" } } },
  required: ["words"],
  additionalProperties: false,
};

function responseFormat(provider, schemaName, schema) {
  if (provider.preset === "kimi") {
    return { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } };
  }
  return { type: "json_object" };
}

function apiRequestBody(provider, messages, schemaName, schema, estimatedOutputTokens) {
  const body = {
    model: provider.model,
    messages,
    response_format: responseFormat(provider, schemaName, schema),
  };
  if (provider.preset === "kimi") {
    body.max_completion_tokens = estimatedOutputTokens;
    body.reasoning_effort = "low";
  } else {
    body.max_tokens = estimatedOutputTokens;
  }
  return body;
}

function parseJsonModelContent(payload) {
  const raw = payload.choices?.[0]?.message?.content ?? payload.output_text ?? payload;
  if (!raw) throw new Error("模型返回了空内容，请重试。");
  try {
    return typeof raw === "string" ? JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim()) : raw;
  } catch {
    throw new Error("模型没有返回可解析的 JSON，请重试或更换模型。");
  }
}

async function generateContent(session, provider, priorSessions, images) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("没有可用的 API Key");
  if (images.length && !provider.vision) throw new Error("当前模型未启用图片输入。请移除截图，或在模型设置中选择支持视觉的模型。");
  const profile = buildLearnerProfile(priorSessions);
  const prompt = generationPrompt(session, profile);
  const userContent = images.length
    ? [{ type: "text", text: `${prompt}\n\n以下图片是词表截图，请仅将其用于核对词表；仍以文字词表为准。` }, ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } }))]
    : prompt;
  const response = await fetch(chatCompletionsUrl(provider), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(apiRequestBody(provider, [
        { role: "system", content: "你必须输出严格、有效的 JSON。" },
        { role: "user", content: userContent },
      ], "lexiecho_study", GENERATED_CONTENT_SCHEMA, Math.min(24000, Math.max(5000, 2500 + session.words.length * 500)))),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`模型接口返回 ${response.status}：${detail.slice(0, 180)}`);
  }
  const payload = await response.json();
  const parsed = parseJsonModelContent(payload);
  const normalized = normalizeContent(parsed, session.words);
  if (!normalized.words.length) throw new Error("模型没有识别出单词，请改为粘贴词表或检查图片后重试。");
  return normalized;
}

function normalizeContent(data, inputWords) {
  const rawWords = Array.isArray(data.words) ? data.words : [];
  const words = rawWords.map((word, index) => ({
    id: word.id || `${word.term || inputWords[index] || "word"}-${index}`,
    term: word.term || inputWords[index] || "未命名词",
    phonetic: word.phonetic || "",
    partOfSpeech: word.partOfSpeech || word.part_of_speech || "",
    meaning: word.meaning || word.definition || "",
    usageNotes: word.usageNotes || word.usage_notes || "",
    collocations: textArray(word.collocations),
    wordFamily: textArray(word.wordFamily || word.word_family),
    examples: (Array.isArray(word.examples) ? word.examples : []).map((example) => ({
      english: example.english || example.sentence || "",
      chinese: example.chinese || example.translation || "",
      scene: example.scene || "",
      grammarPoints: (Array.isArray(example.grammarPoints || example.grammar_points) ? example.grammarPoints || example.grammar_points : []).map((point) => ({ label: point.label || point.name || "语法提示", explanation: point.explanation || point.text || "" })),
    })),
    feedback: word.feedback || { tags: [], note: "" },
  }));
  const byTerm = new Set(words.map((word) => word.term.toLocaleLowerCase()));
  inputWords.forEach((term) => {
    if (!byTerm.has(term.toLocaleLowerCase())) words.push({ id: `${term}-missing`, term, phonetic: "", partOfSpeech: "", meaning: "模型未返回此词；请局部重新生成。", usageNotes: "", collocations: [], wordFamily: [], examples: [], feedback: { tags: [], note: "" } });
  });
  const readings = data.readings || {};
  return {
    summary: data.summary || "请结合自己的理解，标注让你停下来的地方。",
    words,
    readings: {
      daily: normalizeReading(readings.daily, "当天词汇串联阅读"),
      iPlusOne: normalizeReading(readings.iPlusOne || readings.i_plus_one, "个人 i+1 阅读"),
    },
  };
}

function normalizeReading(reading, fallbackTitle) {
  const value = reading || {};
  return {
    title: value.title || fallbackTitle,
    content: value.content || "模型未返回阅读内容。",
    translation: value.translation || "",
    coveredWords: textArray(value.coveredWords || value.covered_words),
    difficultyNote: value.difficultyNote || value.difficulty_note || "",
    feedback: value.feedback || { tags: [], note: "" },
  };
}

async function renderStudy(app, id) {
  const session = await getSession(decodeURIComponent(id));
  if (!session) {
    app.innerHTML = `<section class="page page-header"><h1>未找到这份学习记录</h1><a class="button primary" href="#archive">返回学习档案</a></section>`;
    return;
  }
  if (session.status !== "ready" || !session.content) {
    app.innerHTML = `<section class="page page-header"><p class="eyebrow">STUDY SESSION</p><h1>${html(chineseDate(session.studyDate))}</h1><p>${session.status === "generating" ? "内容正在生成中。" : `内容尚不可用：${html(session.error || "请回到创建页重新生成。")}`}</p><a class="button primary" href="#new">创建新的学习</a></section>`;
    return;
  }
  const content = session.content;
  app.innerHTML = `<section class="page study-page">
    <header class="study-top"><div><p class="eyebrow">${html(chineseDate(session.studyDate))}</p><h1>今日语境强化</h1><p>${html(content.summary)}</p></div><div class="study-actions"><a class="button secondary" href="#archive">学习档案</a><a class="button primary" href="#new">新建学习</a></div></header>
    <nav class="word-nav" aria-label="单词定位">${content.words.map((word) => `<a class="word-chip" href="#word-${encodeURIComponent(word.id)}">${html(word.term)}</a>`).join("")}</nav>
    ${content.words.map((word) => wordCard(session, word)).join("")}
    ${readingCard(session, "daily", content.readings.daily, "当天词汇串联阅读")}
    ${readingCard(session, "iPlusOne", content.readings.iPlusOne, "个人 i+1 阅读")}
  </section>`;
  bindStudyFeedback(app, session);
}

const WORD_TAGS = ["句子太难", "不懂语法", "翻译不出来", "表达很实用", "想再次遇见"];
const READING_TAGS = ["整体太难", "句子太长", "生词太多", "读得很顺", "主题喜欢"];

function renderTags(selected, kind, target) {
  const tags = kind === "word" ? WORD_TAGS : READING_TAGS;
  return tags.map((tag) => `<button type="button" class="feedback-tag ${selected.includes(tag) ? "selected" : ""}" data-feedback-kind="${kind}" data-target="${html(target)}" data-tag="${html(tag)}">${html(tag)}</button>`).join("");
}

function wordCard(session, word) {
  const examples = word.examples.length ? word.examples.map((example) => `<article class="example"><p class="english">${html(example.english)}</p><p class="chinese">${html(example.chinese)}</p>${example.scene ? `<p class="scene">场景：${html(example.scene)}</p>` : ""}${example.grammarPoints.map((point) => `<div class="grammar-point"><strong>${html(point.label)}：</strong>${html(point.explanation)}</div>`).join("")}</article>`).join("") : `<p class="reading-meta">该词未返回例句，可在之后局部重新生成。</p>`;
  return `<article class="word-card card" id="word-${encodeURIComponent(word.id)}"><header class="word-heading"><h2>${html(word.term)}</h2>${word.phonetic ? `<span class="phonetic">${html(word.phonetic)}</span>` : ""}${word.partOfSpeech ? `<span class="pos">${html(word.partOfSpeech)}</span>` : ""}</header><p class="meaning">${html(word.meaning)}</p>${word.usageNotes ? `<p class="reading-meta">用法提醒：${html(word.usageNotes)}</p>` : ""}<div class="word-sections"><section><h3>例句与必要语法</h3>${examples}</section><section><h3>常用连接</h3><div class="pills">${word.collocations.map((item) => `<span class="pill">${html(item)}</span>`).join("") || `<span class="reading-meta">暂无搭配</span>`}</div>${word.wordFamily.length ? `<h3 style="margin-top:20px">词形关联</h3><div class="pills">${word.wordFamily.map((item) => `<span class="pill">${html(item)}</span>`).join("")}</div>` : ""}</section></div><section class="feedback-block"><h3>你的反馈</h3><div class="feedback-tags">${renderTags(word.feedback?.tags || [], "word", word.id)}</div><textarea class="note-input" data-note-kind="word" data-target="${html(word.id)}" placeholder="写下你不懂的地方，或记录一个想用到的场景。">${html(word.feedback?.note || "")}</textarea></section></article>`;
}

function readingCard(session, type, reading, label) {
  return `<article class="reading-card card"><header><div><p class="eyebrow">${html(label)}</p><h2>${html(reading.title)}</h2><p class="subtitle">${html(reading.difficultyNote)}</p></div><span class="reading-meta">自然复现：${html(reading.coveredWords.join("、") || "无")}</span></header><div class="reading-text">${html(reading.content)}</div>${reading.translation ? `<details><summary>查看中文译文</summary><div class="translation">${html(reading.translation)}</div></details>` : ""}<section class="feedback-block"><h3>阅读反馈</h3><div class="feedback-tags">${renderTags(reading.feedback?.tags || [], "reading", type)}</div><textarea class="note-input" data-note-kind="reading" data-target="${type}" placeholder="可以标记读不懂的句子、主题偏好或难度感受。">${html(reading.feedback?.note || "")}</textarea></section></article>`;
}

function bindStudyFeedback(app, session) {
  app.querySelectorAll("[data-feedback-kind]").forEach((button) => {
    button.addEventListener("click", async () => {
      const kind = button.dataset.feedbackKind;
      const target = button.dataset.target;
      const tag = button.dataset.tag;
      const item = kind === "word" ? session.content.words.find((word) => word.id === target) : session.content.readings[target];
      item.feedback ||= { tags: [], note: "" };
      item.feedback.tags ||= [];
      item.feedback.tags = item.feedback.tags.includes(tag) ? item.feedback.tags.filter((value) => value !== tag) : [...item.feedback.tags, tag];
      await saveSession(session);
      await render();
    });
  });
  app.querySelectorAll("[data-note-kind]").forEach((input) => {
    input.addEventListener("change", async () => {
      const kind = input.dataset.noteKind;
      const target = input.dataset.target;
      const item = kind === "word" ? session.content.words.find((word) => word.id === target) : session.content.readings[target];
      item.feedback ||= { tags: [], note: "" };
      item.feedback.note = input.value.trim();
      await saveSession(session);
      toast("反馈已保存，会用于之后的阅读难度调整。");
    });
  });
}

async function exportData() {
  const sessions = await listSessions();
  const packageData = { format: "LexiEchoBackup", version: 1, exportedAt: new Date().toISOString(), sessions };
  const blob = new Blob([JSON.stringify(packageData, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `lexiecho-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast(`已导出 ${sessions.length} 份学习档案。`);
}

async function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = document.querySelector("#data-status");
  try {
    const packageData = JSON.parse(await file.text());
    if (packageData.format !== "LexiEchoBackup" || !Array.isArray(packageData.sessions)) throw new Error("这不是 LexiEcho 学习档案文件。");
    for (const session of packageData.sessions) {
      if (!session.id || !Array.isArray(session.words)) continue;
      await saveSession(session);
    }
    setStatus(status, `已导入 ${packageData.sessions.length} 份档案。`, false);
  } catch (error) {
    setStatus(status, `导入失败：${error.message}`, true);
  } finally {
    event.target.value = "";
  }
}

async function clearData() {
  if (!window.confirm("确定清空当前浏览器中的全部学习档案吗？此操作不能撤销，建议先导出备份。")) return;
  const database = await db;
  await new Promise((resolve, reject) => {
    const request = database.transaction(SESSION_STORE, "readwrite").objectStore(SESSION_STORE).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  setStatus(document.querySelector("#data-status"), "本浏览器的学习档案已清空。", false);
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-route]");
    if (!link) return;
    event.preventDefault();
    transientImages = [];
    const route = link.dataset.route;
    if (location.hash.slice(1) === route) render();
    else location.hash = `#${route}`;
  });
  render().catch((error) => {
    document.getElementById("app").innerHTML = `<section class="page page-header"><h1>页面加载失败</h1><p>${html(error.message)}</p></section>`;
  });
});

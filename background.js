// Immersive Learning - Background Service Worker

// 默认设置
const DEFAULT_SETTINGS = {
  enabled: false,
  difficulty: 3,
  apiConfigs: [],
  currentApiConfigId: null,
  displayStyle: "translation-original",
  siteFilterMode: "blacklist",
  blacklist: ["localhost", "127.0.0.1", "192.168.*.*", "10.*.*.*"],
  whitelist: [],
  nativeLanguage: "zh-CN",
  targetLanguage: "en",
  enableReverseLearning: true,
  maxConcurrent: 3,
};

// 难度配置：根据难度级别选择不同难度的单词
const DIFFICULTY_CONFIG = {
  1: {
    levelName: "基础",
    description: "最基础的日常高频词汇，初学者或小学生能理解的简单词",
    guidance: "选择最常用、最简单的词，避免任何书面语、正式用语或专业词汇",
    quantityGuide: "按句子字数的5%选词，最多不超过2个词",
  },
  2: {
    levelName: "常用",
    description: "常用词汇，中学生能理解的词",
    guidance:
      "选择日常生活和工作中常见的词，避免过于简单的基础词，也避免专业术语",
    quantityGuide: "按句子字数的8%选词，最多不超过4个词",
  },
  3: {
    levelName: "中级",
    description: "中级词汇，高中生或大学生能理解的词",
    guidance: "选择有一定难度的词汇，可包含常见短语，避免太简单或太专业的词",
    quantityGuide: "按句子字数的12%选词，最多不超过6个词",
  },
  4: {
    levelName: "较难",
    description: "较难词汇和习语，需要较高语言水平才能理解",
    guidance: "选择书面语、正式用语、习语和有表达力的词，避免基础常用词",
    quantityGuide: "按句子字数的15%选词，最多不超过8个词",
  },
  5: {
    levelName: "高级",
    description: "高级词汇、专业术语、复杂习语和文学表达",
    guidance: "选择高级词汇、专业术语、复杂习语，不限制难度，避免简单常用词",
    quantityGuide: "按句子字数的20%选词，无上限限制",
  },
};

// 右键菜单 ID
const MENU_ID = "immersive-learning-site-filter";

// 扩展安装时初始化
chrome.runtime.onInstalled.addListener(async () => {
  // 初始化设置
  const result = await chrome.storage.local.get("settings");
  if (!result.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }

  // 初始化统计数据
  const stats = await chrome.storage.local.get("stats");
  if (!stats.stats) {
    await chrome.storage.local.set({
      stats: {
        totalWords: 0,
        todayWords: 0,
        lastDate: new Date().toDateString(),
      },
    });
  }

  // 创建右键菜单
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "添加到黑名单",
    contexts: ["page"],
  });
});

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_SETTINGS") {
    chrome.storage.local.get("settings").then((result) => {
      const settings = result.settings || DEFAULT_SETTINGS;

      // 获取当前激活的 API 配置
      let currentConfig = null;
      if (settings.apiConfigs && settings.currentApiConfigId) {
        currentConfig = settings.apiConfigs.find(
          (c) => c.id === settings.currentApiConfigId
        );
      }

      // 返回扁平化的设置（兼容 content.js 现有逻辑）
      const flatSettings = {
        ...settings,
        apiKey: currentConfig?.apiKey || settings.apiKey || "",
        apiBaseUrl: currentConfig?.apiBaseUrl || settings.apiBaseUrl || "",
        modelName: currentConfig?.modelName || settings.modelName || "",
      };

      sendResponse(flatSettings);
    });
    return true;
  }

  if (message.type === "UPDATE_STATS") {
    updateStats(message.wordCount).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "GET_STATS") {
    chrome.storage.local.get("stats").then((result) => {
      sendResponse(result.stats);
    });
    return true;
  }

  // API 请求处理
  if (message.type === "API_TRANSLATE_SENTENCE") {
    handleTranslateSentence(message.data)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        console.error("[Background] API_TRANSLATE_SENTENCE error:", error);
        sendResponse({ error: error.message });
      });
    return true;
  }

  if (message.type === "API_GET_WORD_DETAIL") {
    handleGetWordDetail(message.data)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        console.error("[Background] API_GET_WORD_DETAIL error:", error);
        sendResponse({ error: error.message });
      });
    return true;
  }
});

// 更新学习统计
async function updateStats(wordCount) {
  const result = await chrome.storage.local.get("stats");
  const stats = result.stats || { totalWords: 0, todayWords: 0, lastDate: "" };
  const today = new Date().toDateString();

  if (stats.lastDate !== today) {
    stats.todayWords = 0;
    stats.lastDate = today;
  }

  stats.totalWords += wordCount;
  stats.todayWords += wordCount;

  await chrome.storage.local.set({ stats });
}

// 检查网站是否匹配过滤列表
function isHostnameInList(hostname, siteList) {
  return siteList.some((pattern) => {
    const regex = new RegExp(
      "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
    );
    return regex.test(hostname);
  });
}

// 获取当前模式对应的列表
function getCurrentSiteList(settings) {
  const filterMode = settings.siteFilterMode || "blacklist";
  if (filterMode === "blacklist") {
    return settings.blacklist || settings.siteList || [];
  } else {
    return settings.whitelist || [];
  }
}

// 更新菜单标题
async function updateMenuTitle(hostname) {
  const result = await chrome.storage.local.get("settings");
  const settings = result.settings || DEFAULT_SETTINGS;
  const filterMode = settings.siteFilterMode || "blacklist";
  const siteList = getCurrentSiteList(settings);

  const isInList = isHostnameInList(hostname, siteList);

  let title;
  if (filterMode === "blacklist") {
    title = isInList ? "从黑名单移除" : "添加到黑名单";
  } else {
    title = isInList ? "从白名单移除" : "添加到白名单";
  }

  try {
    await chrome.contextMenus.update(MENU_ID, { title });
  } catch (e) {
    // 菜单可能尚未创建
  }
}

// 标签页激活时更新菜单
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && tab.url.startsWith("http")) {
      const hostname = new URL(tab.url).hostname;
      await updateMenuTitle(hostname);
    }
  } catch (e) {}
});

// 标签页更新时更新菜单
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.startsWith("http")
  ) {
    try {
      const hostname = new URL(tab.url).hostname;
      await updateMenuTitle(hostname);
    } catch (e) {}
  }
});

// 处理菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab.url) return;

  try {
    const hostname = new URL(tab.url).hostname;
    const result = await chrome.storage.local.get("settings");
    const settings = result.settings || DEFAULT_SETTINGS;
    const filterMode = settings.siteFilterMode || "blacklist";

    // 根据模式获取对应列表的字段名
    const listKey = filterMode === "blacklist" ? "blacklist" : "whitelist";
    let siteList = settings[listKey] || [];

    const isInList = isHostnameInList(hostname, siteList);

    if (isInList) {
      // 移除：精确匹配或通配符匹配
      siteList = siteList.filter((pattern) => {
        const regex = new RegExp(
          "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
        );
        return !regex.test(hostname);
      });
    } else {
      // 添加
      siteList.push(hostname);
    }

    settings[listKey] = siteList;
    await chrome.storage.local.set({ settings });

    // 更新菜单标题
    await updateMenuTitle(hostname);

    // 刷新页面使更改生效
    chrome.tabs.reload(tab.id);
  } catch (e) {
    console.error("[Immersive Learning] Menu click error:", e);
  }
});

// API 请求处理函数

// 带重试的 fetch 封装
async function fetchWithRetry(url, options, retries = 2, retryDelay = 1000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok && i < retries) {
        await sleep(retryDelay * (i + 1));
        continue;
      }
      return response;
    } catch (error) {
      if (i === retries) throw error;
      await sleep(retryDelay * (i + 1));
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 修复畸形 JSON（某些模型返回不稳定）
function repairMalformedJson(str) {
  // 修复 ["key": "value"] 为 {"key": "value"}
  let fixed = str.replace(/\[\s*"([^"]+)"\s*:/g, '{"$1":');
  fixed = fixed.replace(/:\s*"([^"]*)"\s*\]/g, ':"$1"}');

  // 修复 }, { 之间缺少逗号的情况
  fixed = fixed.replace(/\}\s*\{/g, "},{");

  // 修复最外层缺少方括号的情况
  const trimmed = fixed.trim();
  if (trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    fixed = "[" + trimmed + "]";
  }

  return fixed;
}

// 解析翻译结果 JSON
function parseTranslateResult(content, originalText) {
  // 清理 markdown 代码块标记
  content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "");

  let jsonMatch = content.match(/\[[\s\S]*\]/);

  // 尝试匹配连续的对象形式（无外层方括号）
  if (!jsonMatch) {
    jsonMatch = content.match(/\{[\s\S]*\}/);
  }

  if (!jsonMatch) {
    return { success: false, error: "No JSON found in response" };
  }

  const jsonStr = jsonMatch[0];

  try {
    const parsed = JSON.parse(jsonStr);
    const result = Array.isArray(parsed) ? parsed : [parsed];
    return {
      success: true,
      data: result.filter(
        (r) => r.original && r.translation && originalText.includes(r.original)
      ),
    };
  } catch (err) {
    // 尝试修复后再解析
    try {
      const repairedJson = repairMalformedJson(jsonStr);
      const parsed = JSON.parse(repairedJson);
      const result = Array.isArray(parsed) ? parsed : [parsed];
      console.log("[Background] Repaired malformed JSON successfully");
      return {
        success: true,
        data: result.filter(
          (r) =>
            r.original && r.translation && originalText.includes(r.original)
        ),
      };
    } catch (repairErr) {
      return { success: false, error: err.message, rawContent: content };
    }
  }
}

// 单句翻译
async function handleTranslateSentence({
  text,
  difficulty,
  config,
  direction,
  nativeLanguage,
  targetLanguage,
}) {
  const processText = text.length > 500 ? text.substring(0, 500) : text;

  // 根据难度获取配置
  const diffConfig = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG[3];

  const LANGUAGE_NAMES = {
    "zh-CN": "中文",
    "zh-TW": "中文",
    en: "English",
    ja: "日本語",
    ko: "한국어",
    fr: "Français",
    de: "Deutsch",
    es: "Español",
  };

  const nativeName = LANGUAGE_NAMES[nativeLanguage] || nativeLanguage;
  const targetName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;

  let systemPrompt;
  if (direction === "native-to-target") {
    systemPrompt = `【重要！禁止思考和推理！】直接返回JSON数组，不要任何思考过程和其他内容。

你是语言学习助手。从${nativeName}句子中选择词语返回JSON数组。

难度级别：${diffConfig.levelName}
难度说明：${diffConfig.description}
选词指导：${diffConfig.guidance}
数量限制：${diffConfig.quantityGuide}

词性原则：根据难度级别自行判断。低难度专注实词（名词、动词、形容词），高难度可选择高级连词、介词短语等有学习价值的词。

严格要求：
1. 严格遵守数量限制，不要超过上限
2. 不选人名、地名、品牌名
3. 确保词在原文中完整存在
4. 优先选择有学习价值的词

返回格式：[{"original":"原词","translation":"${targetName}翻译"}]
再次强调：直接返回JSON数组，禁止思考推理和额外说明。`;
  } else {
    systemPrompt = `【IMPORTANT! NO THINKING OR REASONING!】Return JSON array directly, no thinking process or extra content.

You are a language learning assistant. Select words from the ${targetName} text and return a JSON array.

Difficulty Level: ${diffConfig.levelName}
Level Description: ${diffConfig.description}
Selection Guidance: ${diffConfig.guidance}
Quantity Limit: ${diffConfig.quantityGuide}

POS Principle: Decide based on difficulty level. Lower difficulty focuses on content words (nouns, verbs, adjectives). Higher difficulty can include advanced conjunctions, prepositions, and other valuable words.

Requirements:
1. Strictly follow quantity limits, do not exceed
2. No proper nouns (names, places, brands)
3. Word must exist in original text
4. Prioritize words with learning value

Format: [{"original":"word","translation":"${nativeName}翻译"}]
Reminder: Return JSON array directly, no thinking or explanation.`;
  }

  // 单次 API 调用尝试
  async function attemptTranslate() {
    const response = await fetchWithRetry(
      `${config.apiBaseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: processText },
          ],
          temperature: 0.3,
          reasoning_effort: "low",
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      const errorDetails = {
        status: response.status,
        statusText: response.statusText,
        url: `${config.apiBaseUrl}/v1/chat/completions`,
        response: errorText,
      };
      throw errorDetails;
    }

    const data = await response.json();

    // 检查响应数据结构
    if (!data?.choices?.[0]?.message?.content) {
      console.warn("[Background] API 响应数据结构异常，跳过该条");
      return { success: false, error: "响应数据结构异常" };
    }

    return parseTranslateResult(data.choices[0].message.content.trim(), text);
  }

  // 解析失败重试机制
  const maxParseRetries = 2;
  for (let attempt = 0; attempt <= maxParseRetries; attempt++) {
    try {
      const result = await attemptTranslate();

      if (result.success) {
        return result.data;
      }

      // 解析失败，记录并重试
      if (attempt < maxParseRetries) {
        console.warn(
          `[Background] JSON parse failed (attempt ${attempt + 1}/${
            maxParseRetries + 1
          }), retrying...`
        );
        console.warn("[Background] Raw content:", result.rawContent);
        await sleep(500);
      } else {
        console.error(
          "[Background] JSON parse error after all retries:",
          result.error
        );
        console.error("[Background] Raw content:", result.rawContent);
        return [];
      }
    } catch (err) {
      // 返回详细错误信息给 content.js
      // err 本身就是 errorDetails 对象（包含 status, statusText, url, response）
      return {
        error: true,
        status: err.status,
        statusText: err.statusText,
        url: err.url,
        response: err.response,
        fullError: err,
      };
    }
  }

  return [];
}

// 单词详情
async function handleGetWordDetail({ english, chinese, context, config }) {
  const response = await fetchWithRetry(
    `${config.apiBaseUrl}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: `【重要！禁止思考和推理！】直接返回JSON对象，不要任何思考过程。

你是英语词典助手。根据给定的英文单词和中文原词，返回JSON格式的单词详情。要求：
1. phonetic: 国际音标（如 /ˈeksəmpəl/）
2. pos: 词性缩写（如 n. v. adj. adv.）
3. meaning: 中文释义（简洁，1-2个含义）
4. example_en: 一个简单的英文例句
5. example_zh: 例句的中文翻译

返回格式：{"phonetic":"...","pos":"...","meaning":"...","example_en":"...","example_zh":"..."}
再次强调：直接返回JSON对象，禁止思考推理。`,
          },
          {
            role: "user",
            content: `英文: ${english}\n中文: ${chinese}\n原文语境: ${context}`,
          },
        ],
        temperature: 0.3,
        reasoning_effort: "low",
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    return {
      error: true,
      errorDetails: {
        status: response.status,
        statusText: response.statusText,
        url: `${config.apiBaseUrl}/v1/chat/completions`,
        response: errorText,
      },
      message: errorText,
    };
  }

  const data = await response.json();

  // 打印完整响应用于调试
  console.log("[Background] 单词详情 API 响应:", JSON.stringify(data, null, 2));

  // 检查响应数据结构
  if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
    console.error("[Background] 单词详情 API 响应数据结构异常:", data);
    return {
      error: true,
      message: "API 响应数据结构异常",
      rawData: data,
    };
  }

  const content = data.choices[0].message.content;
  if (!content) {
    console.error("[Background] 单词详情 API 返回的 content 为空:", data);
    return {
      error: true,
      message: "API 返回的 content 为空",
      rawData: data,
    };
  }

  let trimmedContent = content.trim();

  // 清理 markdown 代码块标记
  trimmedContent = trimmedContent
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "");

  const jsonMatch = trimmedContent.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error("[Background] JSON parse error in getWordDetail:", err);
      console.error("[Background] Raw content:", content);
      return null;
    }
  }
  return null;
}

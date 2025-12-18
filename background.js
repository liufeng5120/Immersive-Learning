// Learn English Naturally - Background Service Worker

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

// 右键菜单 ID
const MENU_ID = "learn-english-toggle-site";

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
  const count = Math.max(1, Math.min(difficulty, 5));

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
    systemPrompt = `从${nativeName}句子中选择${count}个常用词返回JSON数组。严格要求：1.选择有学习价值的词语 2.只选名词/动词/形容词 3.不选虚词助词 4.不选人名地名品牌 5.确保词在原文中完整存在 6.只返回JSON：[{"original":"原词","translation":"${targetName}翻译"}]`;
  } else {
    systemPrompt = `From the ${targetName} text, select ${count} common words and return a JSON array. Requirements: 1.Select words valuable for learning 2.Only nouns/verbs/adjectives 3.No function words 4.No proper nouns 5.Word must exist in original text 6.Return only JSON: [{"original":"word","translation":"${nativeName}翻译"}]`;
  }

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
        max_tokens: 300,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  let content = data.choices[0].message.content.trim();

  // 清理 markdown 代码块标记
  content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "");

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed
        .filter((r) => r.original && r.translation && text.includes(r.original))
        .slice(0, count);
    } catch (err) {
      console.error("[Background] JSON parse error in translateSentence:", err);
      console.error("[Background] Raw content:", content);
      return [];
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
            content: `你是英语词典助手。根据给定的英文单词和中文原词，返回JSON格式的单词详情。要求：
1. phonetic: 国际音标（如 /ˈeksəmpəl/）
2. pos: 词性缩写（如 n. v. adj. adv.）
3. meaning: 中文释义（简洁，1-2个含义）
4. example_en: 一个简单的英文例句
5. example_zh: 例句的中文翻译
只返回JSON对象，格式：{"phonetic":"...","pos":"...","meaning":"...","example_en":"...","example_zh":"..."}`,
          },
          {
            role: "user",
            content: `英文: ${english}\n中文: ${chinese}\n原文语境: ${context}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  let content = data.choices[0].message.content.trim();

  // 清理 markdown 代码块标记
  content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "");

  const jsonMatch = content.match(/\{[\s\S]*?\}/);
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

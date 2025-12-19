// Immersive Learning - Content Script

(function () {
  "use strict";

  // 配置（从 background 获取，此处仅声明）
  let settings = {
    enabled: false,
    difficulty: 3,
    apiKey: "",
    apiBaseUrl: "",
    modelName: "",
    displayStyle: "translation-original",
    excludedSites: [],
    nativeLanguage: "zh-CN",
    targetLanguage: "en",
    enableReverseLearning: true,
    maxConcurrent: 3,
  };

  // 当前翻译方向：'native-to-target' 或 'target-to-native'
  let translationDirection = null;

  // API 错误计数器
  let apiErrorCount = 0;
  const MAX_API_ERRORS = 3;

  // MutationObserver 引用（用于停止观察）
  let domObserver = null;

  // 语言名称映射
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

  // 检测页面语言
  function detectPageLanguage() {
    // 优先使用 html lang 属性
    const htmlLang = document.documentElement.lang?.toLowerCase() || "";
    if (htmlLang) {
      if (htmlLang.startsWith("zh"))
        return htmlLang.includes("tw") || htmlLang.includes("hant")
          ? "zh-TW"
          : "zh-CN";
      if (htmlLang.startsWith("en")) return "en";
      if (htmlLang.startsWith("ja")) return "ja";
      if (htmlLang.startsWith("ko")) return "ko";
      if (htmlLang.startsWith("fr")) return "fr";
      if (htmlLang.startsWith("de")) return "de";
      if (htmlLang.startsWith("es")) return "es";
    }

    // 通过内容检测
    const text = document.body?.innerText?.substring(0, 1000) || "";
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const japaneseChars = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || [])
      .length;
    const koreanChars = (text.match(/[\uac00-\ud7af]/g) || []).length;
    const latinChars = (text.match(/[a-zA-Z]/g) || []).length;

    const total = chineseChars + japaneseChars + koreanChars + latinChars;
    if (total === 0) return null;

    if (chineseChars / total > 0.3) return "zh-CN";
    if (japaneseChars / total > 0.1) return "ja";
    if (koreanChars / total > 0.1) return "ko";
    if (latinChars / total > 0.5) return "en";

    return null;
  }

  // 页面提示函数
  function showPageToast(message, duration = 4000) {
    let toast = document.getElementById("immersive-learning-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "immersive-learning-toast";
      toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff4444;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 999999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: opacity 0.3s;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = "1";
    toast.style.display = "block";

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => {
        toast.style.display = "none";
      }, 300);
    }, duration);
  }

  // 处理 API 错误
  async function handleApiError() {
    apiErrorCount++;
    if (apiErrorCount >= MAX_API_ERRORS) {
      settings.enabled = false;
      try {
        const result = await chrome.storage.local.get("settings");
        const savedSettings = result.settings || {};
        savedSettings.enabled = false;
        await chrome.storage.local.set({ settings: savedSettings });
      } catch (e) {}
      showPageToast(
        "API 连续请求失败，已自动关闭。请检查设置后重新开启。",
        6000
      );
    }
  }

  // 重置错误计数
  function resetApiErrorCount() {
    apiErrorCount = 0;
  }

  // 已处理的元素标记
  const PROCESSED_ATTR = "data-len-processed";

  // 排除的选择器
  const EXCLUDE_SELECTORS = [
    "script",
    "style",
    "code",
    "pre",
    "textarea",
    "input",
    "select",
    ".len-word",
    '[contenteditable="true"]',
    "noscript",
    "iframe",
    "nav",
    "footer",
    ".footer",
    ".nav",
    ".sidebar",
    ".menu",
    ".navigation",
    ".header",
    ".ad",
    ".advertisement",
    ".comment",
    "button",
    "form",
    ".btn",
    ".button",
  ];

  // 单词详情缓存配置
  const WORD_CACHE_KEY = "wordDetailCache";

  // 句子缓存配置
  const SENTENCE_CACHE_KEY = "sentenceCache";
  const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24小时

  // 生成文本哈希
  function hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  // 缓存数量上限 2400
  const MAX_CACHE_ENTRIES = 2400;

  // 通用缓存获取
  async function getCache(cacheKey, key) {
    try {
      const result = await chrome.storage.local.get(cacheKey);
      const cache = result[cacheKey] || {};
      const entry = cache[key];

      if (entry && Date.now() - entry.timestamp < CACHE_EXPIRY_MS) {
        // 异步更新 lastAccess，不阻塞返回
        entry.lastAccess = Date.now();
        chrome.storage.local.set({ [cacheKey]: cache }).catch(() => {});
        return entry.data;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // 通用缓存设置
  async function setCache(cacheKey, key, data) {
    try {
      const result = await chrome.storage.local.get(cacheKey);
      const cache = result[cacheKey] || {};
      const now = Date.now();

      // 清理过期缓存
      for (const k in cache) {
        if (now - cache[k].timestamp >= CACHE_EXPIRY_MS) {
          delete cache[k];
        }
      }

      // 超过上限时删除最久未访问的条目
      const entries = Object.entries(cache);
      if (entries.length >= MAX_CACHE_ENTRIES) {
        entries.sort(
          (a, b) =>
            (a[1].lastAccess || a[1].timestamp) -
            (b[1].lastAccess || b[1].timestamp)
        );
        const toDelete = entries.slice(
          0,
          entries.length - MAX_CACHE_ENTRIES + 1
        );
        toDelete.forEach(([k]) => delete cache[k]);
      }

      cache[key] = { data, timestamp: now, lastAccess: now };
      await chrome.storage.local.set({ [cacheKey]: cache });
    } catch (e) {}
  }

  async function getSentenceCache(text) {
    const cached = await getCache(SENTENCE_CACHE_KEY, hashText(text));
    return cached;
  }

  async function setSentenceCache(text, data) {
    await setCache(SENTENCE_CACHE_KEY, hashText(text), data);
  }

  // 词典缓存：永久有效，只有数量限制
  async function getWordDetailCache(key) {
    try {
      const result = await chrome.storage.local.get(WORD_CACHE_KEY);
      const cache = result[WORD_CACHE_KEY] || {};
      const entry = cache[key];

      if (entry) {
        // 异步更新 lastAccess，不阻塞返回
        entry.lastAccess = Date.now();
        chrome.storage.local.set({ [WORD_CACHE_KEY]: cache }).catch(() => {});
        return entry.data;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async function setWordDetailCache(key, data) {
    try {
      const result = await chrome.storage.local.get(WORD_CACHE_KEY);
      const cache = result[WORD_CACHE_KEY] || {};
      const now = Date.now();

      // 超过上限时删除最久未访问的条目
      const entries = Object.entries(cache);
      if (entries.length >= MAX_CACHE_ENTRIES) {
        entries.sort(
          (a, b) =>
            (a[1].lastAccess || a[1].timestamp) -
            (b[1].lastAccess || b[1].timestamp)
        );
        const toDelete = entries.slice(
          0,
          entries.length - MAX_CACHE_ENTRIES + 1
        );
        toDelete.forEach(([k]) => delete cache[k]);
      }

      cache[key] = { data, timestamp: now, lastAccess: now };
      await chrome.storage.local.set({ [WORD_CACHE_KEY]: cache });
    } catch (e) {}
  }

  // AI 处理器
  const AIProcessor = {
    config: {
      apiKey: "",
      apiBaseUrl: "",
      model: "gpt-4o-mini",
      nativeLanguage: "zh-CN",
      targetLanguage: "en",
      direction: "native-to-target",
    },

    // 单句翻译（独立请求）
    async getSingleReplacement(text, difficulty = 3) {
      if (!this.config.apiKey || !text) return [];

      const processText = text.length > 500 ? text.substring(0, 500) : text;
      const cacheKey = `${this.config.direction}_${processText}`;

      // 检查缓存
      const cached = await getSentenceCache(cacheKey);
      if (cached) {
        return cached;
      }

      try {
        const result = await chrome.runtime.sendMessage({
          type: "API_TRANSLATE_SENTENCE",
          data: {
            text: processText,
            difficulty,
            config: {
              apiKey: this.config.apiKey,
              apiBaseUrl: this.config.apiBaseUrl,
              model: this.config.model,
            },
            direction: this.config.direction,
            nativeLanguage: this.config.nativeLanguage,
            targetLanguage: this.config.targetLanguage,
          },
        });

        if (result.error) {
          console.error("[Immersive Learning] API error:", result.error);
          handleApiError();
          return [];
        }

        resetApiErrorCount();

        // 缓存结果
        if (result && Array.isArray(result)) {
          setSentenceCache(cacheKey, result);
          return result;
        }

        return [];
      } catch (error) {
        console.error("[Immersive Learning] AI error:", error);
        handleApiError();
        return [];
      }
    },

    async getWordDetail(english, chinese, context) {
      if (!this.config.apiKey) return null;

      // 缓存键包含中文释义和语言对，确保同一单词的不同释义使用不同缓存
      const cacheKey = `${english}_${chinese}_${this.config.nativeLanguage}_${this.config.targetLanguage}`;
      const cached = await getWordDetailCache(cacheKey);
      if (cached) return cached;

      try {
        // 通过 background script 发送 API 请求
        const result = await chrome.runtime.sendMessage({
          type: "API_GET_WORD_DETAIL",
          data: {
            english,
            chinese,
            context,
            config: {
              apiKey: this.config.apiKey,
              apiBaseUrl: this.config.apiBaseUrl,
              model: this.config.model,
            },
          },
        });

        if (result.error) {
          console.error(
            "[Immersive Learning] Word detail error:",
            result.error
          );
          return null;
        }

        // 缓存结果
        if (result) {
          await setWordDetailCache(cacheKey, result);
        }
        return result;
      } catch (error) {
        console.error("[Immersive Learning] Word detail error:", error);
        return null;
      }
    },
  };

  async function init() {
    // 获取设置
    try {
      const result = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
      if (result) {
        settings = { ...settings, ...result };
      }
    } catch (e) {}

    // 网站过滤检查
    const hostname = window.location.hostname;
    const filterMode = settings.siteFilterMode || "blacklist";

    // 读取对应模式的列表
    let siteList;
    if (filterMode === "blacklist") {
      siteList = settings.blacklist ||
        settings.siteList ||
        settings.excludedSites || [
          "localhost",
          "127.0.0.1",
          "192.168.*.*",
          "10.*.*.*",
        ];
    } else {
      siteList = settings.whitelist || [];
    }

    const matchesSiteList = siteList.some((pattern) => {
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
      );
      return regex.test(hostname);
    });

    // 黑名单模式：匹配则禁用；白名单模式：不匹配则禁用
    const shouldDisable =
      filterMode === "blacklist" ? matchesSiteList : !matchesSiteList;

    if (shouldDisable) {
      return;
    }

    if (!settings.enabled) {
      return;
    }

    if (!settings.apiKey) {
      return;
    }

    // 检测页面语言并确定翻译方向
    const pageLanguage = detectPageLanguage();
    const nativeLang = settings.nativeLanguage || "zh-CN";
    const targetLang = settings.targetLanguage || "en";

    // 判断页面语言类型
    const isNativePage = pageLanguage?.startsWith(nativeLang.split("-")[0]);
    const isTargetPage = pageLanguage?.startsWith(targetLang.split("-")[0]);

    if (isNativePage) {
      translationDirection = "native-to-target";
    } else if (isTargetPage && settings.enableReverseLearning) {
      translationDirection = "target-to-native";
    } else {
      return;
    }

    // 配置 AI（使用默认值回退）
    AIProcessor.config.apiKey = settings.apiKey;
    AIProcessor.config.apiBaseUrl =
      settings.apiBaseUrl || "https://api.openai.com";
    AIProcessor.config.model = settings.modelName || "gpt-4o-mini";
    AIProcessor.config.nativeLanguage = nativeLang;
    AIProcessor.config.targetLanguage = targetLang;
    AIProcessor.config.direction = translationDirection;

    // 等待 SPA 内容加载
    await sleep(1500);

    // 处理页面
    await processPage();

    // 监听 DOM 变化
    observeDOM();

    // 设置 tooltip 动态定位
    setupTooltipPositioning();

    // 监听设置变化（开关同步）
    listenForSettingsChanges();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 处理页面 - 并发池模式
  // 处理页面 - 并发池模式
  async function processPage() {
    const elements = findTextElements();
    if (elements.length === 0) return;

    const toProcess = elements; // 处理所有元素
    const maxConcurrent = settings.maxConcurrent || 3;

    let index = 0;
    const processing = new Set();

    // 处理单个元素
    async function processElement(el, idx) {
      if (!settings.enabled) return;

      try {
        el.setAttribute(PROCESSED_ATTR, "processing");

        const text = el.textContent.trim();
        const replacements = await AIProcessor.getSingleReplacement(
          text,
          settings.difficulty
        );

        if (replacements && replacements.length > 0) {
          const context = text.substring(0, 100);
          let count = 0;

          for (const { original, translation } of replacements) {
            if (replaceTextInElement(el, original, translation, context))
              count++;
          }

          if (count > 0) {
            chrome.runtime.sendMessage({
              type: "UPDATE_STATS",
              wordCount: count,
            });
          }
        }

        el.setAttribute(PROCESSED_ATTR, "true");
      } catch (error) {
        console.error(`[Immersive Learning] 处理元素 ${idx + 1} 错误:`, error);
        el.setAttribute(PROCESSED_ATTR, "true");
      }
    }

    // 并发池：一个完成立即启动下一个
    async function startNext() {
      if (index >= toProcess.length) {
        return;
      }

      if (!settings.enabled) {
        return;
      }

      const currentIndex = index;
      const el = toProcess[index++];

      const promise = processElement(el, currentIndex).finally(() => {
        processing.delete(promise);
        startNext(); // 完成后立即启动下一个
      });

      processing.add(promise);
    }

    // 启动初始并发
    const initialCount = Math.min(maxConcurrent, toProcess.length);
    for (let i = 0; i < initialCount; i++) {
      startNext();
    }

    // 等待所有请求完成
    while (processing.size > 0) {
      await Promise.race(processing);
    }
  }

  // 查找文本元素 - 按 DOM 顺序（从页面顶部开始）
  function findTextElements() {
    // 只选择块级元素，避免嵌套重复处理
    const selectors = "p, h1, h2, h3, h4, h5, h6, li, td, th, dd, dt";

    const candidates = [];
    try {
      // querySelectorAll 按 DOM 顺序返回元素
      document.querySelectorAll(selectors).forEach((el) => {
        if (shouldProcess(el) && !candidates.includes(el)) {
          candidates.push(el);
        }
      });
    } catch (e) {}

    return candidates;
  }

  // 检查是否处理
  function shouldProcess(element) {
    if (!element || element.hasAttribute(PROCESSED_ATTR)) return false;

    for (const selector of EXCLUDE_SELECTORS) {
      try {
        if (element.matches(selector) || element.closest(selector))
          return false;
      } catch (e) {}
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;

    const text = element.textContent.trim();
    if (text.length < 30) return false;

    // 根据翻译方向检查内容
    if (translationDirection === "native-to-target") {
      const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
      if (chineseCount < 10) return false;
    } else {
      const latinCount = (text.match(/[a-zA-Z]/g) || []).length;
      if (latinCount < 20) return false;
    }

    return true;
  }

  // 替换文本
  function replaceTextInElement(element, original, translation, context) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          let parent = node.parentNode;
          while (parent && parent !== element) {
            if (parent.hasAttribute && parent.hasAttribute(PROCESSED_ATTR)) {
              return NodeFilter.FILTER_REJECT;
            }
            parent = parent.parentNode;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
      false
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      const index = text.indexOf(original);

      if (index === -1) continue;

      const span = document.createElement("span");
      span.className = "len-word";
      span.setAttribute("data-original", original);
      span.setAttribute("data-translation", translation);
      span.setAttribute("data-context", context || "");
      span.setAttribute(PROCESSED_ATTR, "true");

      // 根据显示样式设置内容
      const style = settings.displayStyle || "translation-original";
      let displayText = "";
      let spanClass = "len-word";

      switch (style) {
        case "translation-only":
          displayText = translation;
          spanClass = "len-word len-style-translation-only";
          break;
        case "original-translation":
          displayText = `${original}(${translation})`;
          spanClass = "len-word len-style-original-translation";
          break;
        case "translation-original":
        default:
          displayText = `${translation}(${original})`;
          break;
      }

      span.className = spanClass;
      span.innerHTML = `<span class="len-main-text">${displayText}</span><span class="len-tooltip"><span class="len-tooltip-translation">${translation}</span><div class="len-tooltip-original">${original}</div></span>`;

      const stopEvent = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      span.addEventListener("mousedown", stopEvent, true);
      span.addEventListener(
        "click",
        (e) => {
          stopEvent(e);
          handleWordClick(span);
        },
        true
      );

      const before = text.substring(0, index);
      const after = text.substring(index + original.length);
      const parent = node.parentNode;

      if (before) parent.insertBefore(document.createTextNode(before), node);
      parent.insertBefore(span, node);
      if (after) parent.insertBefore(document.createTextNode(after), node);
      parent.removeChild(node);

      return true;
    }
    return false;
  }

  // 监听 DOM 变化
  function observeDOM() {
    let pending = false;

    const processNewElements = async () => {
      const newElements = findTextElements().filter(
        (el) => !el.hasAttribute(PROCESSED_ATTR)
      );

      if (newElements.length === 0) {
        pending = false;

        return;
      }

      const maxConcurrent = settings.maxConcurrent || 3;
      const toProcess = newElements; // 处理所有新元素

      let index = 0;
      const processing = new Set();

      // 处理单个元素
      async function processElement(el, idx) {
        if (!settings.enabled) return;

        try {
          el.setAttribute(PROCESSED_ATTR, "processing");

          const text = el.textContent.trim();
          const replacements = await AIProcessor.getSingleReplacement(
            text,
            settings.difficulty
          );

          if (replacements && replacements.length > 0) {
            const context = text.substring(0, 100);
            let count = 0;

            for (const { original, translation } of replacements) {
              if (replaceTextInElement(el, original, translation, context))
                count++;
            }

            if (count > 0) {
              chrome.runtime.sendMessage({
                type: "UPDATE_STATS",
                wordCount: count,
              });
            }
          }

          el.setAttribute(PROCESSED_ATTR, "true");
        } catch (error) {
          console.error(
            `[Immersive Learning] [DOM] 处理元素 ${idx + 1} 错误:`,
            error
          );
          el.setAttribute(PROCESSED_ATTR, "true");
        }
      }

      // 并发池：一个完成立即启动下一个
      async function startNext() {
        if (index >= toProcess.length) {
          return;
        }

        if (!settings.enabled) {
          return;
        }

        const currentIndex = index;
        const el = toProcess[index++];

        const promise = processElement(el, currentIndex).finally(() => {
          processing.delete(promise);
          startNext();
        });

        processing.add(promise);
      }

      // 启动初始并发
      const initialCount = Math.min(maxConcurrent, toProcess.length);

      for (let i = 0; i < initialCount; i++) {
        startNext();
      }

      // 等待所有请求完成
      while (processing.size > 0) {
        await Promise.race(processing);
      }
      pending = false;
    };

    const scheduleProcess = () => {
      if (pending) {
        return;
      }
      pending = true;

      // 直接执行而不使用 requestIdleCallback
      // requestIdleCallback 可能因浏览器繁忙被延迟很久
      setTimeout(() => processNewElements(), 0);
    };

    domObserver = new MutationObserver(scheduleProcess);
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  // 停止 DOM 观察
  function stopObserving() {
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
  }

  // 设置 tooltip 动态定位
  function setupTooltipPositioning() {
    document.addEventListener(
      "mouseenter",
      (e) => {
        if (!e.target || !(e.target instanceof Element)) return;
        const wordEl = e.target.closest(".len-word");
        if (!wordEl) return;

        const tooltip = wordEl.querySelector(".len-tooltip");
        if (!tooltip) return;

        // 更新 tooltip 位置
        const updatePosition = () => {
          const rect = wordEl.getBoundingClientRect();
          const tooltipRect = tooltip.getBoundingClientRect();

          // 计算位置：元素上方居中
          let left = rect.left + rect.width / 2;
          let top = rect.top - 8;

          // 边界检测：防止超出视窗
          const maxLeft = window.innerWidth - tooltipRect.width / 2 - 10;
          const minLeft = tooltipRect.width / 2 + 10;
          left = Math.max(minLeft, Math.min(left, maxLeft));

          if (top < tooltipRect.height + 10) {
            // 上方空间不足，显示在下方
            top = rect.bottom + 8 + tooltipRect.height;
          }

          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${top}px`;
          tooltip.style.transform = "translate(-50%, -100%)";
        };

        updatePosition();
      },
      true
    );
  }

  // 监听设置变化（开关同步）
  function listenForSettingsChanges() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes.settings) return;

      const newSettings = changes.settings.newValue;
      const wasEnabled = settings.enabled;
      settings = { ...settings, ...newSettings };

      // 开关状态变化
      if (wasEnabled && !settings.enabled) {
        stopObserving();
        showPageToast("沉浸式学习已关闭", 2000);
      } else if (!wasEnabled && settings.enabled && settings.apiKey) {
        AIProcessor.config.apiKey = settings.apiKey;
        AIProcessor.config.apiBaseUrl =
          settings.apiBaseUrl || "https://api.openai.com";
        AIProcessor.config.model = settings.modelName || "gpt-4o-mini";
        apiErrorCount = 0;
        observeDOM();
        processPage();
        showPageToast("沉浸式学习已开启", 2000);
      }
    });
  }

  // 创建详情弹窗 DOM
  function createDetailPopup() {
    if (document.querySelector(".len-detail-overlay")) return;

    const overlay = document.createElement("div");
    overlay.className = "len-detail-overlay";

    const popup = document.createElement("div");
    popup.className = "len-detail-popup";
    popup.innerHTML = `
      <button class="len-detail-close">&times;</button>
      <div class="len-detail-header">
        <h2 class="len-detail-word"></h2>
        <div class="len-detail-phonetic"></div>
      </div>
      <div class="len-detail-body">
        <div class="len-detail-section len-detail-context-section">
          <div class="len-detail-label">原文语境</div>
          <div class="len-detail-context"></div>
        </div>
        <div class="len-detail-section len-detail-meaning-section">
          <div class="len-detail-label">释义</div>
          <div class="len-detail-meaning"></div>
        </div>
        <div class="len-detail-section len-detail-example-section">
          <div class="len-detail-label">例句</div>
          <div class="len-detail-example">
            <div class="len-detail-example-en"></div>
            <div class="len-detail-example-zh"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    // 关闭事件
    overlay.addEventListener("click", closeDetailPopup);
    popup
      .querySelector(".len-detail-close")
      .addEventListener("click", closeDetailPopup);
  }

  function closeDetailPopup() {
    const overlay = document.querySelector(".len-detail-overlay");
    const popup = document.querySelector(".len-detail-popup");
    if (overlay) overlay.classList.remove("show");
    if (popup) popup.classList.remove("show");
  }

  function showLoadingState(original, translation, context) {
    createDetailPopup();

    const popup = document.querySelector(".len-detail-popup");
    const overlay = document.querySelector(".len-detail-overlay");

    popup.querySelector(".len-detail-word").textContent = translation;
    popup.querySelector(".len-detail-phonetic").innerHTML =
      '<div class="len-detail-skeleton short"></div>';

    const highlightedContext = context.replace(
      new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      `<span class="highlight">${original}</span>`
    );
    popup.querySelector(".len-detail-context").innerHTML = highlightedContext;

    popup.querySelector(".len-detail-meaning").innerHTML = `
      <div class="len-detail-skeleton medium"></div>
      <div class="len-detail-skeleton short"></div>
    `;
    popup.querySelector(".len-detail-example-en").innerHTML =
      '<div class="len-detail-skeleton"></div>';
    popup.querySelector(".len-detail-example-zh").innerHTML =
      '<div class="len-detail-skeleton short"></div>';

    overlay.classList.add("show");
    popup.classList.add("show");
  }

  function updateDetailContent(detail) {
    const popup = document.querySelector(".len-detail-popup");
    if (!popup) return;

    popup.querySelector(".len-detail-phonetic").textContent =
      detail.phonetic || "";
    popup.querySelector(".len-detail-meaning").innerHTML = `
      <span class="len-detail-pos">${detail.pos || "n."}</span>
      ${detail.meaning || ""}
    `;
    popup.querySelector(".len-detail-example-en").textContent =
      detail.example_en || "";
    popup.querySelector(".len-detail-example-zh").textContent =
      detail.example_zh || "";
  }

  // 处理单词点击，显示详情弹窗
  async function handleWordClick(wordEl) {
    if (!wordEl) return;

    const original = wordEl.getAttribute("data-original");
    const translation = wordEl.getAttribute("data-translation");
    const context = wordEl.getAttribute("data-context") || "";

    showLoadingState(original, translation, context);

    // 根据翻译方向调整参数顺序
    let english, chinese;
    if (translationDirection === "native-to-target") {
      chinese = original;
      english = translation;
    } else {
      english = original;
      chinese = translation;
    }

    const detail = await AIProcessor.getWordDetail(english, chinese, context);

    if (detail) {
      updateDetailContent(detail);
    } else {
      updateDetailContent({
        phonetic: "",
        pos: "",
        meaning: "暂无释义",
        example_en: "",
        example_zh: "",
      });
    }
  }

  // 启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

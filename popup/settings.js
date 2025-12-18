// 设置页逻辑
document.addEventListener("DOMContentLoaded", async () => {
  // 语言设置元素
  const nativeLanguageSelect = document.getElementById("nativeLanguage");
  const targetLanguageSelect = document.getElementById("targetLanguage");
  const enableReverseLearningToggle = document.getElementById(
    "enableReverseLearning"
  );

  // API 配置元素
  const apiConfigSelect = document.getElementById("apiConfigSelect");
  const addConfigBtn = document.getElementById("addConfigBtn");
  const deleteConfigBtn = document.getElementById("deleteConfigBtn");
  const apiPresetSelect = document.getElementById("apiPreset");
  const configNameInput = document.getElementById("configName");
  const apiBaseUrlInput = document.getElementById("apiBaseUrl");
  const modelNameInput = document.getElementById("modelName");
  const apiKeyInput = document.getElementById("apiKey");
  const saveConfigBtn = document.getElementById("saveConfigBtn");

  // 显示样式元素
  const displayStyleSelect = document.getElementById("displayStyle");
  const stylePreview = document.getElementById("stylePreview");

  // 性能设置元素

  const maxConcurrentInput = document.getElementById("maxConcurrent");

  // 网站过滤元素
  const blacklistInput = document.getElementById("blacklistSites");
  const whitelistInput = document.getElementById("whitelistSites");
  const blacklistSection = document.getElementById("blacklistSection");
  const whitelistSection = document.getElementById("whitelistSection");
  const filterTabs = document.querySelectorAll(".filter-tab");

  const saveBtn = document.getElementById("saveBtn");

  // 状态
  let currentFilterMode = "blacklist";
  let apiConfigs = [];
  let currentConfigId = null;
  let isAddingNew = false;

  // API 预设配置
  const API_PRESETS = {
    openai: {
      name: "OpenAI",
      url: "https://api.openai.com",
      model: "gpt-4o-mini",
    },
    gemini: {
      name: "Google Gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.0-flash-exp",
    },
    deepseek: {
      name: "DeepSeek",
      url: "https://api.deepseek.com",
      model: "deepseek-chat",
    },
    moonshot: {
      name: "Moonshot",
      url: "https://api.moonshot.cn",
      model: "moonshot-v1-8k",
    },
  };

  // 生成唯一 ID
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // 更新配置下拉列表
  function updateConfigSelect() {
    apiConfigSelect.innerHTML = '<option value="">选择配置...</option>';
    apiConfigs.forEach((config) => {
      const option = document.createElement("option");
      option.value = config.id;
      option.textContent = config.name || "未命名配置";
      apiConfigSelect.appendChild(option);
    });
    if (currentConfigId) {
      apiConfigSelect.value = currentConfigId;
    }
  }

  // 加载配置到表单
  function loadConfigToForm(config) {
    if (config) {
      configNameInput.value = config.name || "";
      apiBaseUrlInput.value = config.apiBaseUrl || "";
      modelNameInput.value = config.modelName || "";
      apiKeyInput.value = config.apiKey || "";
    } else {
      clearConfigForm();
    }
  }

  // 清空配置表单
  function clearConfigForm() {
    configNameInput.value = "";
    apiBaseUrlInput.value = "";
    modelNameInput.value = "";
    apiKeyInput.value = "";
    apiPresetSelect.value = "";
  }

  // 预设选择处理
  apiPresetSelect.addEventListener("change", () => {
    const preset = API_PRESETS[apiPresetSelect.value];
    if (preset) {
      if (!configNameInput.value) {
        configNameInput.value = preset.name;
      }
      apiBaseUrlInput.value = preset.url;
      modelNameInput.value = preset.model;
    }
  });

  // 配置选择处理
  apiConfigSelect.addEventListener("change", () => {
    const selectedId = apiConfigSelect.value;
    if (selectedId) {
      currentConfigId = selectedId;
      isAddingNew = false;
      const config = apiConfigs.find((c) => c.id === selectedId);
      loadConfigToForm(config);
    } else {
      currentConfigId = null;
      clearConfigForm();
    }
  });

  // 新增配置
  addConfigBtn.addEventListener("click", () => {
    currentConfigId = null;
    isAddingNew = true;
    apiConfigSelect.value = "";
    clearConfigForm();
    configNameInput.focus();
  });

  // 删除配置
  deleteConfigBtn.addEventListener("click", async () => {
    if (!currentConfigId) {
      showToast("请先选择要删除的配置");
      return;
    }

    apiConfigs = apiConfigs.filter((c) => c.id !== currentConfigId);
    currentConfigId = apiConfigs.length > 0 ? apiConfigs[0].id : null;

    updateConfigSelect();
    if (currentConfigId) {
      const config = apiConfigs.find((c) => c.id === currentConfigId);
      loadConfigToForm(config);
    } else {
      clearConfigForm();
    }

    await saveAllSettings();
    showToast("配置已删除");
  });

  // 保存当前配置
  saveConfigBtn.addEventListener("click", async () => {
    const name = configNameInput.value.trim();
    if (!name) {
      showToast("请输入配置名称");
      configNameInput.focus();
      return;
    }

    const configData = {
      name,
      apiBaseUrl: apiBaseUrlInput.value.trim(),
      modelName: modelNameInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
    };

    if (isAddingNew || !currentConfigId) {
      // 新增
      const newConfig = { id: generateId(), ...configData };
      apiConfigs.push(newConfig);
      currentConfigId = newConfig.id;
      isAddingNew = false;
    } else {
      // 更新
      const index = apiConfigs.findIndex((c) => c.id === currentConfigId);
      if (index !== -1) {
        apiConfigs[index] = { ...apiConfigs[index], ...configData };
      }
    }

    updateConfigSelect();
    await saveAllSettings();
    showToast("配置已保存");
  });

  // 过滤模式切换
  function updateFilterModeUI(mode) {
    currentFilterMode = mode;
    filterTabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.mode === mode);
    });
    blacklistSection.style.display = mode === "blacklist" ? "block" : "none";
    whitelistSection.style.display = mode === "whitelist" ? "block" : "none";
  }

  filterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      updateFilterModeUI(tab.dataset.mode);
    });
  });

  // 显示样式预览
  function updateStylePreview() {
    const style = displayStyleSelect.value;
    switch (style) {
      case "translation-only":
        stylePreview.innerHTML = "hello";
        break;
      case "original-translation":
        stylePreview.innerHTML =
          '你好<span class="preview-original">(hello)</span>';
        break;
      case "translation-original":
      default:
        stylePreview.innerHTML =
          'hello<span class="preview-original">(你好)</span>';
        break;
    }
  }

  displayStyleSelect.addEventListener("change", updateStylePreview);

  // 加载设置
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get("settings");
      const settings = result.settings || {};

      // 语言设置
      nativeLanguageSelect.value = settings.nativeLanguage || "zh-CN";
      targetLanguageSelect.value = settings.targetLanguage || "en";
      enableReverseLearningToggle.checked =
        settings.enableReverseLearning !== false;

      // API 配置
      apiConfigs = settings.apiConfigs || [];
      currentConfigId = settings.currentApiConfigId || null;

      // 兼容旧版单配置
      if (apiConfigs.length === 0 && settings.apiKey) {
        const legacyConfig = {
          id: generateId(),
          name: "默认配置",
          apiBaseUrl: settings.apiBaseUrl || "",
          modelName: settings.modelName || "",
          apiKey: settings.apiKey || "",
        };
        apiConfigs.push(legacyConfig);
        currentConfigId = legacyConfig.id;
      }

      updateConfigSelect();
      if (currentConfigId) {
        const config = apiConfigs.find((c) => c.id === currentConfigId);
        loadConfigToForm(config);
      }

      // 显示样式
      displayStyleSelect.value =
        settings.displayStyle || "translation-original";
      updateStylePreview();

      // 性能设置
      maxConcurrentInput.value = settings.maxConcurrent || 3;

      // 过滤模式
      const filterMode = settings.siteFilterMode || "blacklist";
      updateFilterModeUI(filterMode);

      const defaultBlacklist = [
        "localhost",
        "127.0.0.1",
        "192.168.*.*",
        "10.*.*.*",
      ];
      const blacklist =
        settings.blacklist ||
        settings.siteList ||
        settings.excludedSites ||
        defaultBlacklist;
      const whitelist = settings.whitelist || [];

      blacklistInput.value = blacklist.join("\n");
      whitelistInput.value = whitelist.join("\n");
    } catch (e) {
      console.error("加载设置失败:", e);
    }
  }

  // 保存所有设置
  async function saveAllSettings() {
    try {
      const result = await chrome.storage.local.get("settings");
      const oldSettings = result.settings || {};

      const maxConcurrent = parseInt(maxConcurrentInput.value) || 3;
      const clampedMaxConcurrent = Math.max(1, Math.min(10, maxConcurrent));

      const settings = {
        ...oldSettings,
        nativeLanguage: nativeLanguageSelect.value,
        targetLanguage: targetLanguageSelect.value,
        enableReverseLearning: enableReverseLearningToggle.checked,
        apiConfigs,
        currentApiConfigId: currentConfigId,
        displayStyle: displayStyleSelect.value,
        siteFilterMode: currentFilterMode,
        blacklist: blacklistInput.value
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s),
        whitelist: whitelistInput.value
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s),

        maxConcurrent: clampedMaxConcurrent,
      };

      await chrome.storage.local.set({ settings });
    } catch (e) {
      console.error("保存设置失败:", e);
      throw e;
    }
  }

  // 保存按钮
  saveBtn.addEventListener("click", async () => {
    try {
      await saveAllSettings();
      showToast("设置已保存");
    } catch (e) {
      showToast("保存失败");
    }
  });

  function showToast(message) {
    let toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2000);
  }

  // 清除缓存按钮
  document
    .getElementById("clearAllCacheBtn")
    .addEventListener("click", async () => {
      await chrome.storage.local.remove(["sentenceCache", "wordDetailCache"]);
      showToast("缓存已清除");
    });

  await loadSettings();
});

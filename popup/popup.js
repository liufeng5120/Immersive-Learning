// Immersive Learning - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const difficultySlider = document.getElementById('difficultySlider');
  const difficultyValue = document.getElementById('difficultyValue');
  const todayWordsEl = document.getElementById('todayWords');
  const totalWordsEl = document.getElementById('totalWords');
  const apiKeyWarning = document.getElementById('apiKeyWarning');
  const settingsBtn = document.getElementById('settingsBtn');

  const difficultyLabels = {
    1: '轻松',
    2: '简单',
    3: '中等',
    4: '较难',
    5: '挑战'
  };

  let currentSettings = {};

  // 检查是否有有效的 API 配置
  function hasValidApiConfig(settings) {
    if (settings.apiConfigs && settings.apiConfigs.length > 0 && settings.currentApiConfigId) {
      const currentConfig = settings.apiConfigs.find(c => c.id === settings.currentApiConfigId);
      return currentConfig && currentConfig.apiKey;
    }
    // 兼容旧版单配置
    return !!settings.apiKey;
  }

  // 加载设置
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get('settings');
      currentSettings = result.settings || {};
      
      enableToggle.checked = currentSettings.enabled === true;
      difficultySlider.value = currentSettings.difficulty || 3;
      difficultyValue.textContent = difficultyLabels[difficultySlider.value];
      
      apiKeyWarning.style.display = hasValidApiConfig(currentSettings) ? 'none' : 'block';
    } catch (e) {
      console.error('加载设置失败:', e);
    }
  }

  // 加载统计
  async function loadStats() {
    try {
      const result = await chrome.storage.local.get('stats');
      const stats = result.stats || { todayWords: 0, totalWords: 0 };
      
      todayWordsEl.textContent = stats.todayWords || 0;
      totalWordsEl.textContent = stats.totalWords || 0;
    } catch (e) {
      console.error('加载统计失败:', e);
    }
  }

  // 保存设置
  async function saveSettings() {
    try {
      await chrome.storage.local.set({ 
        settings: { 
          ...currentSettings,
          enabled: enableToggle.checked,
          difficulty: parseInt(difficultySlider.value)
        } 
      });
    } catch (e) {
      console.error('保存设置失败:', e);
    }
  }

  // 开关切换
  async function handleToggle() {
    if (enableToggle.checked && !hasValidApiConfig(currentSettings)) {
      enableToggle.checked = false;
      showToast('请先在设置中配置 API');
      return;
    }
    currentSettings.enabled = enableToggle.checked;
    await saveSettings();
  }

  function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // 打开设置页
  settingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/settings.html') });
  });

  enableToggle.addEventListener('change', handleToggle);

  difficultySlider.addEventListener('input', () => {
    difficultyValue.textContent = difficultyLabels[difficultySlider.value];
  });

  difficultySlider.addEventListener('change', () => {
    currentSettings.difficulty = parseInt(difficultySlider.value);
    saveSettings();
  });

  await loadSettings();
  await loadStats();
});

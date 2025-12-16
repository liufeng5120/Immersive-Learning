// Learn English Naturally - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  // DOM 元素
  const enableToggle = document.getElementById('enableToggle');
  const difficultySlider = document.getElementById('difficultySlider');
  const difficultyValue = document.getElementById('difficultyValue');
  const apiKeyInput = document.getElementById('apiKey');
  const apiBaseUrlInput = document.getElementById('apiBaseUrl');
  const modelNameInput = document.getElementById('modelName');
  const showOriginalToggle = document.getElementById('showOriginal');
  const excludedSitesInput = document.getElementById('excludedSites');
  const saveBtn = document.getElementById('saveSettingsBtn');
  const todayWordsEl = document.getElementById('todayWords');
  const totalWordsEl = document.getElementById('totalWords');

  // 难度级别文字
  const difficultyLabels = {
    1: '轻松',
    2: '简单',
    3: '中等',
    4: '较难',
    5: '挑战'
  };

  // 加载设置
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get('settings');
      const settings = result.settings || {};
      
      enableToggle.checked = settings.enabled !== false;
      difficultySlider.value = settings.difficulty || 3;
      difficultyValue.textContent = difficultyLabels[difficultySlider.value];
      apiKeyInput.value = settings.apiKey || '';
      apiBaseUrlInput.value = settings.apiBaseUrl || '';
      modelNameInput.value = settings.modelName || '';
      showOriginalToggle.checked = settings.showOriginal !== false;
      excludedSitesInput.value = (settings.excludedSites || ['localhost', '127.0.0.1', '192.168.*.*', '10.*.*.*']).join('\n');
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
    const settings = {
      enabled: enableToggle.checked,
      difficulty: parseInt(difficultySlider.value),
      apiKey: apiKeyInput.value.trim(),
      apiBaseUrl: apiBaseUrlInput.value.trim(),
      modelName: modelNameInput.value.trim(),
      showOriginal: showOriginalToggle.checked,
      excludedSites: excludedSitesInput.value.split('\n').map(s => s.trim()).filter(s => s)
    };

    try {
      await chrome.storage.local.set({ settings });
      showToast('设置已保存');
    } catch (e) {
      console.error('保存设置失败:', e);
      showToast('保存失败');
    }
  }

  // 显示提示
  function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

  // 事件监听
  enableToggle.addEventListener('change', saveSettings);

  difficultySlider.addEventListener('input', () => {
    difficultyValue.textContent = difficultyLabels[difficultySlider.value];
  });

  difficultySlider.addEventListener('change', saveSettings);

  saveBtn.addEventListener('click', saveSettings);

  // 初始化
  await loadSettings();
  await loadStats();
});

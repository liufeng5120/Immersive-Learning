// Learn English Naturally - Background Service Worker

// 默认设置
const DEFAULT_SETTINGS = {
  enabled: true,
  difficulty: 3,
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com',
  modelName: 'gpt-4o-mini',
  showOriginal: true,
  excludedSites: ['localhost', '127.0.0.1', '192.168.*.*', '10.*.*.*']
};

// 右键菜单 ID
const MENU_ID = 'learn-english-toggle-site';

// 扩展安装时初始化
chrome.runtime.onInstalled.addListener(async () => {
  // 初始化设置
  const result = await chrome.storage.local.get('settings');
  if (!result.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  
  // 初始化统计数据
  const stats = await chrome.storage.local.get('stats');
  if (!stats.stats) {
    await chrome.storage.local.set({
      stats: {
        totalWords: 0,
        todayWords: 0,
        lastDate: new Date().toDateString()
      }
    });
  }
  
  // 创建右键菜单
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '排除当前网站',
    contexts: ['page']
  });
  
  console.log('Learn English Naturally 扩展已安装');
});

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    chrome.storage.local.get('settings').then(result => {
      sendResponse(result.settings || DEFAULT_SETTINGS);
    });
    return true;
  }
  
  if (message.type === 'UPDATE_STATS') {
    updateStats(message.wordCount).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (message.type === 'GET_STATS') {
    chrome.storage.local.get('stats').then(result => {
      sendResponse(result.stats);
    });
    return true;
  }
});

// 更新学习统计
async function updateStats(wordCount) {
  const result = await chrome.storage.local.get('stats');
  const stats = result.stats || { totalWords: 0, todayWords: 0, lastDate: '' };
  const today = new Date().toDateString();
  
  if (stats.lastDate !== today) {
    stats.todayWords = 0;
    stats.lastDate = today;
  }
  
  stats.totalWords += wordCount;
  stats.todayWords += wordCount;
  
  await chrome.storage.local.set({ stats });
}

// 检查网站是否被排除
function isHostnameExcluded(hostname, excludedSites) {
  return excludedSites.some(pattern => {
    const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    return regex.test(hostname);
  });
}

// 更新菜单标题
async function updateMenuTitle(hostname) {
  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || DEFAULT_SETTINGS;
  const excludedSites = settings.excludedSites || [];
  
  const isExcluded = isHostnameExcluded(hostname, excludedSites);
  
  try {
    await chrome.contextMenus.update(MENU_ID, {
      title: isExcluded ? '取消排除当前网站' : '排除当前网站'
    });
  } catch (e) {
    // 菜单可能尚未创建
  }
}

// 标签页激活时更新菜单
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && tab.url.startsWith('http')) {
      const hostname = new URL(tab.url).hostname;
      await updateMenuTitle(hostname);
    }
  } catch (e) {}
});

// 标签页更新时更新菜单
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
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
    const result = await chrome.storage.local.get('settings');
    const settings = result.settings || DEFAULT_SETTINGS;
    let excludedSites = settings.excludedSites || [];
    
    const isExcluded = isHostnameExcluded(hostname, excludedSites);
    
    if (isExcluded) {
      // 移除：精确匹配或通配符匹配
      excludedSites = excludedSites.filter(pattern => {
        const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        return !regex.test(hostname);
      });
    } else {
      // 添加
      excludedSites.push(hostname);
    }
    
    settings.excludedSites = excludedSites;
    await chrome.storage.local.set({ settings });
    
    // 更新菜单标题
    await updateMenuTitle(hostname);
    
    // 刷新页面使更改生效
    chrome.tabs.reload(tab.id);
  } catch (e) {
    console.error('[Learn English] Menu click error:', e);
  }
});

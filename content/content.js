// Learn English Naturally - Content Script

(function() {
  'use strict';

  // 配置（从 background 获取，此处仅声明）
  let settings = {
    enabled: false,
    difficulty: 3,
    apiKey: '',
    apiBaseUrl: '',
    modelName: '',
    showOriginal: true
  };

  console.log('[Learn English] Content script loaded v2');

  // 已处理的元素标记
  const PROCESSED_ATTR = 'data-len-processed';
  
  // 排除的选择器
  const EXCLUDE_SELECTORS = [
    'script', 'style', 'code', 'pre', 'textarea', 'input', 'select',
    '.len-word', '[contenteditable="true"]', 'noscript', 'iframe',
    'nav', 'footer', '.footer', '.nav', '.sidebar', '.menu', 
    '.navigation', '.header', '.ad', '.advertisement', '.comment',
    'button', 'form', '.btn', '.button'
  ];

  // 单词详情缓存配置
  const WORD_CACHE_KEY = 'wordDetailCache';
  
  // 句子缓存配置
  const SENTENCE_CACHE_KEY = 'sentenceCache';
  const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24小时
  
  // 生成文本哈希
  function hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
  
  // 通用缓存获取
  async function getCache(cacheKey, key) {
    try {
      const result = await chrome.storage.local.get(cacheKey);
      const cache = result[cacheKey] || {};
      const entry = cache[key];
      
      if (entry && Date.now() - entry.timestamp < CACHE_EXPIRY_MS) {
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
      
      cache[key] = { data, timestamp: now };
      await chrome.storage.local.set({ [cacheKey]: cache });
    } catch (e) {}
  }
  
  // 句子缓存快捷方法
  async function getSentenceCache(text) {
    const cached = await getCache(SENTENCE_CACHE_KEY, hashText(text));
    if (cached) console.log('[Learn English] Sentence cache hit');
    return cached;
  }
  
  async function setSentenceCache(text, data) {
    await setCache(SENTENCE_CACHE_KEY, hashText(text), data);
  }
  
  // 单词详情缓存快捷方法
  async function getWordDetailCache(key) {
    const cached = await getCache(WORD_CACHE_KEY, key);
    if (cached) console.log('[Learn English] Word detail cache hit:', key);
    return cached;
  }
  
  async function setWordDetailCache(key, data) {
    await setCache(WORD_CACHE_KEY, key, data);
  }

  // API 重试配置
  const RETRY_CONFIG = { maxRetries: 2, retryDelay: 1000 };

  // 带重试的 fetch 封装
  async function fetchWithRetry(url, options, retries = RETRY_CONFIG.maxRetries) {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok && i < retries) {
          await sleep(RETRY_CONFIG.retryDelay * (i + 1));
          continue;
        }
        return response;
      } catch (error) {
        if (i === retries) throw error;
        await sleep(RETRY_CONFIG.retryDelay * (i + 1));
      }
    }
  }

  // AI 处理器
  const AIProcessor = {
    config: { apiKey: '', apiBaseUrl: '', model: 'gpt-4o-mini' },

    async getReplacements(text, difficulty = 3) {
      if (!this.config.apiKey) return null;

      const processText = text.length > 500 ? text.substring(0, 500) : text;
      
      // 检查缓存
      const cached = await getSentenceCache(processText);
      if (cached) return cached;
      
      const count = Math.max(1, Math.min(difficulty, 5));
      
      try {
        const response = await fetchWithRetry(`${this.config.apiBaseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              {
                role: 'system',
                content: `从中文句子中选择${count}个常用词返回JSON数组。严格要求：1.必须是2-4个汉字的词语（禁止单字词）2.只选名词/动词/形容词 3.不选虚词助词（的、了、是、在、和、与等）4.不选人名地名品牌 5.确保词在原文中完整存在 6.只返回JSON：[{"zh":"词语","en":"english"}]`
              },
              { role: 'user', content: processText }
            ],
            temperature: 0.3,
            max_tokens: 300
          })
        });

        if (!response.ok) {
          console.error('[Learn English] API error:', response.status);
          return [];
        }

        const data = await response.json();
        const content = data.choices[0].message.content.trim();
        
        const jsonMatch = content.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const result = parsed.filter(r => 
            r.zh && r.en && r.zh.length >= 2 && r.zh.length <= 4 && text.includes(r.zh)
          );
          // 缓存结果
          await setSentenceCache(processText, result);
          return result;
        }
        return [];
      } catch (error) {
        console.error('[Learn English] AI error:', error);
        return [];
      }
    },

    async getWordDetail(english, chinese, context) {
      if (!this.config.apiKey) return null;
      
      // 检查缓存
      const cacheKey = `${english}_${chinese}`;
      const cached = await getWordDetailCache(cacheKey);
      if (cached) return cached;

      try {
        const response = await fetchWithRetry(`${this.config.apiBaseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              {
                role: 'system',
                content: `你是英语词典助手。根据给定的英文单词和中文原词，返回JSON格式的单词详情。要求：
1. phonetic: 国际音标（如 /ˈeksəmpəl/）
2. pos: 词性缩写（如 n. v. adj. adv.）
3. meaning: 中文释义（简洁，1-2个含义）
4. example_en: 一个简单的英文例句
5. example_zh: 例句的中文翻译
只返回JSON对象，格式：{"phonetic":"...","pos":"...","meaning":"...","example_en":"...","example_zh":"..."}`
              },
              { role: 'user', content: `英文: ${english}\n中文: ${chinese}\n原文语境: ${context}` }
            ],
            temperature: 0.3,
            max_tokens: 300
          })
        });

        if (!response.ok) throw new Error(`API: ${response.status}`);

        const data = await response.json();
        const content = data.choices[0].message.content.trim();
        
        const jsonMatch = content.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          // 缓存结果
          await setWordDetailCache(cacheKey, result);
          return result;
        }
        return null;
      } catch (error) {
        console.error('[Learn English] Word detail error:', error);
        return null;
      }
    }
  };

  // 初始化
  async function init() {
    console.log('[Learn English] Initializing...');
    
    // 获取设置
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      console.log('[Learn English] Settings:', result);
      if (result) {
        settings = { ...settings, ...result };
      }
    } catch (e) {
      console.log('[Learn English] Get settings failed:', e);
    }

    // 检查是否为排除的网站
    const hostname = window.location.hostname;
    const excludedSites = settings.excludedSites || ['localhost', '127.0.0.1', '192.168.*.*', '10.*.*.*'];
    
    const isExcluded = excludedSites.some(pattern => {
      // 将通配符转换为正则表达式
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return regex.test(hostname);
    });
    
    if (isExcluded) {
      console.log('[Learn English] Skipping excluded site:', hostname);
      return;
    }

    console.log('[Learn English] showOriginal =', settings.showOriginal);

    if (!settings.enabled) {
      console.log('[Learn English] Disabled');
      return;
    }

    if (!settings.apiKey) {
      console.log('[Learn English] No API Key');
      return;
    }

    // 配置 AI（使用默认值回退）
    AIProcessor.config.apiKey = settings.apiKey;
    AIProcessor.config.apiBaseUrl = settings.apiBaseUrl || 'https://api.openai.com';
    AIProcessor.config.model = settings.modelName || 'gpt-4o-mini';

    // 等待 SPA 内容加载
    await sleep(1500);
    
    // 处理页面
    await processPage();

    // 监听 DOM 变化
    observeDOM();
    
    // 启用单词点击详情
    setupWordClickHandler();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 处理页面 - 并发版本
  async function processPage() {
    const elements = findTextElements();
    
    console.log('[Learn English] Found', elements.length, 'elements');
    
    if (elements.length === 0) return;

    const toProcess = elements.slice(0, 15);
    
    // 立即标记所有待处理元素，防止重复选中
    toProcess.forEach(el => el.setAttribute(PROCESSED_ATTR, 'processing'));
    
    const maxConcurrent = 5;
    let processed = 0;
    
    // 分批并发处理
    for (let i = 0; i < toProcess.length; i += maxConcurrent) {
      const batch = toProcess.slice(i, i + maxConcurrent);
      console.log(`[Learn English] Batch ${Math.floor(i / maxConcurrent) + 1}: ${batch.length} items`);
      
      const results = await Promise.allSettled(
        batch.map(el => processElement(el))
      );
      
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value) processed++;
      });
    }
    
    console.log('[Learn English] Done, processed:', processed);
  }

  // 查找文本元素 - 通用策略
  function findTextElements() {
    const candidates = [];
    
    // 通用选择器：段落、标题、列表项、链接等
    const selectors = ['p', 'h1', 'h2', 'h3', 'h4', 'li', 'td', 'th', 'dd', 'dt', 'span', 'a', 'div'];
    
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(el => {
          if (shouldProcess(el) && !candidates.includes(el)) {
            candidates.push(el);
          }
        });
      } catch (e) {}
    }
    
    console.log('[Learn English] Candidates from selectors:', candidates.length);
    return candidates;
  }

  // 检查是否处理
  function shouldProcess(element) {
    if (!element || element.hasAttribute(PROCESSED_ATTR)) return false;

    for (const selector of EXCLUDE_SELECTORS) {
      try {
        if (element.matches(selector) || element.closest(selector)) return false;
      } catch (e) {}
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    const text = element.textContent.trim();
    // 要求至少30个字符，确保是句子而非短词
    if (text.length < 30) return false;

    const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    // 要求至少10个中文字符
    if (chineseCount < 10) return false;

    return true;
  }

  // 处理单个元素
  async function processElement(element) {
    element.setAttribute(PROCESSED_ATTR, 'true');
    
    const text = element.textContent.trim();
    
    try {
      const replacements = await AIProcessor.getReplacements(text, settings.difficulty);
      
      if (!replacements || replacements.length === 0) return false;
      
      console.log('[Learn English] Replacements:', replacements);
      
      let count = 0;
      for (const { zh, en } of replacements) {
        if (replaceTextInElement(element, zh, en)) count++;
      }
      
      if (count > 0) {
        chrome.runtime.sendMessage({ type: 'UPDATE_STATS', wordCount: count });
        return true;
      }
      return false;
    } catch (error) {
      console.error('[Learn English] Error:', error);
      return false;
    }
  }

  // 替换文本
  function replaceTextInElement(element, chinese, english) {
    const walker = document.createTreeWalker(
      element, 
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          // 跳过已经被处理的元素内的文本节点
          let parent = node.parentNode;
          while (parent && parent !== element) {
            if (parent.hasAttribute && parent.hasAttribute(PROCESSED_ATTR)) {
              return NodeFilter.FILTER_REJECT;
            }
            parent = parent.parentNode;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );

    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent;
      const index = text.indexOf(chinese);
      
      if (index === -1) continue;
      
      const span = document.createElement('span');
      span.className = 'len-word';
      span.setAttribute('data-zh', chinese);
      span.setAttribute(PROCESSED_ATTR, 'true'); // 标记已处理
      
      // 根据设置显示原文
      const showOrig = settings.showOriginal !== false;
      const displayText = showOrig ? `${english}(${chinese})` : english;
      
      console.log('[Learn English] Replace:', chinese, '->', displayText);
      
      span.innerHTML = `${displayText}<span class="len-tooltip"><span class="len-tooltip-en">${english}</span><div class="len-tooltip-zh">${chinese}</div></span>`;
      
      const before = text.substring(0, index);
      const after = text.substring(index + chinese.length);
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
      const newElements = findTextElements().filter(el => !el.hasAttribute(PROCESSED_ATTR));
      if (newElements.length > 0) {
        console.log('[Learn English] New elements:', newElements.length);
        for (const el of newElements.slice(0, 5)) {
          await processElement(el);
        }
      }
      pending = false;
    };
    
    const scheduleProcess = () => {
      if (pending) return;
      pending = true;
      // 使用 requestIdleCallback 优化性能，降低对主线程的影响
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => processNewElements(), { timeout: 2000 });
      } else {
        setTimeout(processNewElements, 1000);
      }
    };
    
    const observer = new MutationObserver(scheduleProcess);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // 创建详情弹窗 DOM
  function createDetailPopup() {
    if (document.querySelector('.len-detail-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'len-detail-overlay';
    
    const popup = document.createElement('div');
    popup.className = 'len-detail-popup';
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
    overlay.addEventListener('click', closeDetailPopup);
    popup.querySelector('.len-detail-close').addEventListener('click', closeDetailPopup);
  }

  function closeDetailPopup() {
    const overlay = document.querySelector('.len-detail-overlay');
    const popup = document.querySelector('.len-detail-popup');
    if (overlay) overlay.classList.remove('show');
    if (popup) popup.classList.remove('show');
  }

  function showLoadingState(english, chinese, context) {
    createDetailPopup();
    
    const popup = document.querySelector('.len-detail-popup');
    const overlay = document.querySelector('.len-detail-overlay');
    
    popup.querySelector('.len-detail-word').textContent = english;
    popup.querySelector('.len-detail-phonetic').innerHTML = '<div class="len-detail-skeleton short"></div>';
    
    // 高亮原文中的中文词
    const highlightedContext = context.replace(
      new RegExp(chinese, 'g'),
      `<span class="highlight">${chinese}</span>`
    );
    popup.querySelector('.len-detail-context').innerHTML = highlightedContext;
    
    popup.querySelector('.len-detail-meaning').innerHTML = `
      <div class="len-detail-skeleton medium"></div>
      <div class="len-detail-skeleton short"></div>
    `;
    popup.querySelector('.len-detail-example-en').innerHTML = '<div class="len-detail-skeleton"></div>';
    popup.querySelector('.len-detail-example-zh').innerHTML = '<div class="len-detail-skeleton short"></div>';
    
    overlay.classList.add('show');
    popup.classList.add('show');
  }

  function updateDetailContent(detail) {
    const popup = document.querySelector('.len-detail-popup');
    if (!popup) return;
    
    popup.querySelector('.len-detail-phonetic').textContent = detail.phonetic || '';
    popup.querySelector('.len-detail-meaning').innerHTML = `
      <span class="len-detail-pos">${detail.pos || 'n.'}</span>
      ${detail.meaning || ''}
    `;
    popup.querySelector('.len-detail-example-en').textContent = detail.example_en || '';
    popup.querySelector('.len-detail-example-zh').textContent = detail.example_zh || '';
  }

  // 监听单词点击
  function setupWordClickHandler() {
    document.addEventListener('click', async (e) => {
      const wordEl = e.target.closest('.len-word');
      if (!wordEl) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const chinese = wordEl.getAttribute('data-zh');
      const english = wordEl.querySelector('.len-tooltip-en')?.textContent || '';
      
      // 获取原文语境（还原已替换的单词）
      const parentEl = wordEl.closest('p, h1, h2, h3, h4, li, div');
      let context = '';
      if (parentEl) {
        const clone = parentEl.cloneNode(true);
        // 将所有 .len-word 替换回原始中文
        clone.querySelectorAll('.len-word').forEach(el => {
          const zh = el.getAttribute('data-zh');
          el.replaceWith(document.createTextNode(zh));
        });
        context = clone.textContent.substring(0, 100);
      }
      
      console.log('[Learn English] Word clicked:', english, chinese);
      
      // 显示加载状态
      showLoadingState(english, chinese, context);
      
      // 请求详情
      const detail = await AIProcessor.getWordDetail(english, chinese, context);
      
      if (detail) {
        updateDetailContent(detail);
      } else {
        updateDetailContent({
          phonetic: '',
          pos: '',
          meaning: '暂无释义',
          example_en: '',
          example_zh: ''
        });
      }
    });
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

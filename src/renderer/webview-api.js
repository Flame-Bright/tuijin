/*
 * WebView2 bridge. Electron uses preload.js instead, so this file exits early
 * when an API has already been exposed.
 */
(() => {
  if (window.api || !window.chrome?.webview) return;

  document.documentElement.classList.add('native-host');

  const pending = new Map();
  const listeners = {
    state: new Set(),
    focus: new Set(),
    maximized: new Set(),
    widgetMode: new Set()
  };
  let sequence = 0;

  function onMessage(event) {
    const message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'response') {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.ok) request.resolve(message.data);
      else request.reject(new Error(message.error || '操作没有完成'));
      return;
    }

    if (message.type === 'state') {
      for (const callback of listeners.state) callback(message.state);
      return;
    }

    if (message.type === 'focus-task') {
      for (const callback of listeners.focus) callback(message.taskId);
      return;
    }

    if (message.type === 'maximized') {
      for (const callback of listeners.maximized) callback(Boolean(message.value));
      return;
    }

    if (message.type === 'widget-mode') {
      for (const callback of listeners.widgetMode) callback(message.mode);
    }
  }

  window.chrome.webview.addEventListener('message', onMessage);

  window.addEventListener('error', (event) => {
    fire('debug:log', {
      message: `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    fire('debug:log', {
      message: `Unhandled rejection: ${event.reason?.stack || event.reason}`
    });
  });

  function fire(type, payload = {}) {
    window.chrome.webview.postMessage({ type, payload });
  }

  function invoke(type, payload = {}, timeoutMs = 15000) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('桌面宿主没有响应'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      window.chrome.webview.postMessage({ type, id, payload });
    });
  }

  async function getStateWithRetry() {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await invoke('app:get-state', {}, 1400);
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
    throw lastError;
  }

  function subscribe(key, callback) {
    listeners[key].add(callback);
    return () => listeners[key].delete(callback);
  }

  window.api = {
    getState: () => getStateWithRetry(),

    createTask: (input) => invoke('task:create', { input }),
    updateTask: (id, patch) => invoke('task:update', { id, patch }),
    deleteTask: (id) => invoke('task:delete', { id }),
    toggleTaskDone: (id) => invoke('task:toggle-done', { id }),

    addMilestone: (taskId, input) => invoke('milestone:add', { taskId, input }),
    updateMilestone: (taskId, milestoneId, patch) =>
      invoke('milestone:update', { taskId, milestoneId, patch }),
    toggleMilestone: (taskId, milestoneId) =>
      invoke('milestone:toggle', { taskId, milestoneId }),
    deleteMilestone: (taskId, milestoneId) =>
      invoke('milestone:delete', { taskId, milestoneId }),

    updateSettings: (patch) => invoke('settings:update', { patch }),
    clearCompleted: () => invoke('tasks:clear-completed'),

    openMain: (taskId) => invoke('window:open-main', { taskId: taskId || null }),
    openWidget: () => invoke('window:open-widget'),
    hideWidget: () => invoke('window:hide-widget'),
    toggleWidget: () => invoke('window:toggle-widget'),
    closeMain: () => invoke('window:close-main'),
    minimizeMain: () => invoke('window:minimize-main'),
    toggleMaximize: () => invoke('window:toggle-maximize'),

    // 桌面浮层：形态切换与拖动
    expandWidget: () => invoke('widget:expand'),
    collapseWidget: () => invoke('widget:collapse'),
    beginWidgetDrag: () => invoke('widget:drag-start'),
    widgetDragMove: (dx, dy) => invoke('widget:drag-move', { dx, dy }),
    endWidgetDrag: () => invoke('widget:drag-end'),

    // 壁纸
    pickWallpaper: () => invoke('wallpaper:pick'),
    clearWallpaper: () => invoke('wallpaper:clear'),

    // 桌面浮层的自定义图片（小人换图）
    pickWidgetCustom: () => invoke('widget-custom:pick'),
    clearWidgetCustom: () => invoke('widget-custom:clear'),

    openDataFolder: () => invoke('app:open-data-folder'),

    // 工作台边缘缩放：无边框窗口的拖拽缩放手势由渲染层发起
    resizeStart: (edge) => invoke('window:resize-start', { edge }),
    resizeMove: (dx, dy) => invoke('window:resize-move', { dx, dy }),
    resizeEnd: () => invoke('window:resize-end'),

    onState: (callback) => subscribe('state', callback),
    onFocusTask: (callback) => subscribe('focus', callback),
    onMaximized: (callback) => subscribe('maximized', callback),
    onWidgetMode: (callback) => subscribe('widgetMode', callback)
  };

  function isInteractive(target) {
    return Boolean(
      target.closest('button, input, textarea, select, a, label, .no-drag')
    );
  }

  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    const zone = event.target.closest('.titlebar, .widget-head');
    if (!zone || isInteractive(event.target)) return;
    event.preventDefault();
    fire('window:drag');
  });

  // Avoid a white flash before the first paint.
  document.documentElement.style.backgroundColor = 'transparent';
})();

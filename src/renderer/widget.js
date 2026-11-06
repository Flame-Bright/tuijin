/* ==========================================================================
   推进 · 桌面浮层
   一个页面承载三种形态：ball（136×136 圆）/ buddy（176×208 卡通人）/
   expanded（384×580 详情面板）。形态由宿主推来的 widget-mode 决定，
   html[data-widget-style] 切换布局。宿主用 SetWindowRgn 裁窗口形状，
   页面必须精确铺满，没有透明通道。
   ========================================================================== */

import {
  categoryOf,
  completedLabel,
  dueInfo,
  escapeHTML,
  formatHeaderDate,
  hexToRgba,
  icon,
  milestoneStats,
  nextMilestone,
  overallProgress,
  progressOf,
  showToast,
  sortTasks,
  todayKey
} from './shared.js';

const $ = (selector, root = document) => root.querySelector(selector);

/** 形态常量，和契约 / 宿主的 WidgetForm.ModeName() 一一对应。 */
const MODE = { BALL: 'ball', BUDDY: 'buddy', CUSTOM: 'custom', EXPANDED: 'expanded' };

/** 自定义图片的默认值，和宿主 WidgetCustomSettings 对齐。 */
const CUSTOM_DEFAULTS = { file: null, fit: 'cover', dim: 0.12, showText: true };

/** 进度 → 卡通人情绪。阈值按验收描述：0 躺平 / 1–40 / 41–80 / 81–99 / 100。 */
const MOOD_LABELS = {
  slump: '先躺一会儿',
  rise: '刚爬起来',
  work: '正在使劲',
  near: '就差一点',
  party: '全都成了'
};

const RING_RADIUS = 52;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** 拖动阈值：小于这个像素当作点击。 */
const DRAG_THRESHOLD = 3;
/** 长按出菜单的时长。 */
const LONG_PRESS_MS = 620;

const els = {
  root: document.documentElement,
  stageBall: $('#stageBall'),
  ballPct: $('#ballPct'),
  ballMeta: $('#ballMeta'),
  ballRing: $('#ballRing'),

  stageBuddy: $('#stageBuddy'),
  buddyPct: $('#buddyPct'),
  buddyMood: $('#buddyMood'),
  buddyLabel: $('#buddyLabel'),

  stageCustom: $('#stageCustom'),
  customImg: $('#customImg'),
  customInfo: $('#customInfo'),
  customPct: $('#customPct'),
  customMeta: $('#customMeta'),

  xHead: $('#xHead'),
  xDate: $('#xDate'),
  xPin: $('#xPin'),
  xPinHint: $('#xPinHint'),
  xRing: $('#xRing'),
  xRingPct: $('#xRingPct'),
  xSumNote: $('#xSumNote'),
  xSumDue: $('#xSumDue'),
  xSumBar: $('#xSumBar'),
  xSumSub: $('#xSumSub'),
  xActiveCount: $('#xActiveCount'),
  xDoneCount: $('#xDoneCount'),
  xList: $('#xList'),
  xForm: $('#xForm'),
  xInput: $('#xInput'),
  xCatName: $('#xCatName'),
  xCatDot: $('#xCatDot'),
  ctxMenu: $('#ctxMenu'),
  toastRoot: $('#toastRoot')
};

const ui = {
  data: null,
  mode: MODE.BALL,
  tab: 'active',
  category: 'life',
  busy: false,
  expanded: false,
  /** 宿主是否推过 widget-mode。没推过时首次 state 用 settings.widgetStyle 定形态。 */
  hostModeKnown: false
};

/* ==========================================================================
   外观：完全按契约第三节
   ========================================================================== */

function applyAppearance(settings) {
  const root = document.documentElement;
  const fontScale = Number(settings?.fontScale);
  root.style.setProperty(
    '--ui-scale',
    String(Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1)
  );
  root.dataset.theme = settings?.theme === 'dark' ? 'dark' : 'light';
  root.dataset.accent = settings?.accent || 'clay';

  const wall = settings?.wallpaper || {};
  const dim = Number(wall.dim);
  const blur = Number(wall.blur);
  root.style.setProperty('--wallpaper-dim', String(Number.isFinite(dim) ? dim : 0.18));
  root.style.setProperty('--wallpaper-blur', `${Number.isFinite(blur) ? blur : 0}px`);

  if (wall.kind === 'image' && wall.file) {
    root.dataset.wallpaper = 'image';
    root.style.setProperty(
      '--wallpaper-css',
      `url("https://tuijin.wall/${encodeURIComponent(wall.file)}")`
    );
  } else if (wall.kind === 'preset') {
    root.dataset.wallpaper = wall.preset || 'sunrise';
    root.style.removeProperty('--wallpaper-css');
  } else {
    root.dataset.wallpaper = 'none';
    root.style.removeProperty('--wallpaper-css');
  }
}

/** 把进度烘到圆环上（用 dashoffset，避免每次重建 SVG）。 */
function paintRing(ring, value) {
  if (!ring) return;
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  ring.setAttribute('stroke-dasharray', RING_LENGTH.toFixed(2));
  ring.setAttribute('stroke-dashoffset', (RING_LENGTH * (1 - pct / 100)).toFixed(2));
}

function pctMarkup(value) {
  return `${value}<span class="pct-sign">%</span>`;
}

/* ==========================================================================
   形态
   ========================================================================== */

function normalizeMode(mode) {
  if (mode === MODE.EXPANDED) return MODE.EXPANDED;
  if (mode === MODE.CUSTOM) return MODE.CUSTOM;
  if (mode === MODE.BUDDY) return MODE.BUDDY;
  return MODE.BALL;
}

function applyMode(mode) {
  let next = normalizeMode(mode);
  // 宿主会照 settings.widgetStyle 推 "custom"，但没图时不该停在空形态上：
  // 和 collapsedModeOf 用同一套回落，避免两处逻辑走偏。
  if (next === MODE.CUSTOM && !widgetCustomOf(ui.data?.settings).file) {
    next = MODE.BUDDY;
  }
  ui.mode = next;
  ui.expanded = next === MODE.EXPANDED;
  els.root.dataset.widgetStyle = next;
  closeContextMenu();

  if (ui.expanded) {
    requestAnimationFrame(() => {
      els.xInput?.blur();
      if (els.xList) els.xList.scrollTop = 0;
    });
  }

  // 展开/收起会改变置顶提示的可见性
  applyPinState();
}

/**
 * 收起态应该长什么样。
 * custom 但还没有图（或图被移除）时回落成卡通人 —— 两者窗口尺寸和圆角相同，
 * 所以这个回落不需要宿主重设窗口，纯渲染层解决。
 */
function collapsedModeOf(settings) {
  const style = settings?.widgetStyle;
  if (style === 'custom') {
    return widgetCustomOf(settings).file ? MODE.CUSTOM : MODE.BUDDY;
  }
  if (style === 'buddy') return MODE.BUDDY;
  return MODE.BALL;
}

/** 自定义图片相关的设置，缺字段按默认值补。 */
function widgetCustomOf(settings) {
  const raw = settings?.widgetCustom || {};
  const fit = raw.fit === 'contain' ? 'contain' : 'cover';
  const dim = Number(raw.dim);
  return {
    file: typeof raw.file === 'string' && raw.file ? raw.file : null,
    fit,
    dim: Number.isFinite(dim) ? Math.min(0.6, Math.max(0, dim)) : CUSTOM_DEFAULTS.dim,
    showText: raw.showText !== false
  };
}

function customImageUrl(file) {
  return `https://tuijin.widget/${encodeURIComponent(file)}`;
}

/* ==========================================================================
   数据派生
   ========================================================================== */

function allTasks() {
  return ui.data?.tasks || [];
}

function sortedActive() {
  return sortTasks(allTasks().filter((task) => task.status === 'active'), 'due');
}

function sortedDone() {
  return allTasks()
    .filter((task) => task.status === 'done')
    .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
}

/** 情绪判定。没任务时也是躺平。 */
function moodOf(progress, totalCount) {
  if (!totalCount) return 'slump';
  if (progress >= 100) return 'party';
  if (progress <= 0) return 'slump';
  if (progress <= 40) return 'rise';
  if (progress <= 80) return 'work';
  return 'near';
}

function categoryIds() {
  const ids = (ui.data?.categories || []).map((item) => item.id).filter(Boolean);
  return ids.length ? ids : ['life', 'work', 'study', 'idea'];
}

/* ==========================================================================
   渲染 · 收起态
   ========================================================================== */

function renderBall() {
  if (!ui.data) return;
  const tasks = allTasks();
  const active = sortedActive();
  const progress = overallProgress(tasks);

  paintRing(els.ballRing, progress);
  els.ballPct.innerHTML = pctMarkup(progress);
  els.stageBall?.classList.toggle('is-done', progress >= 100 && tasks.length > 0);

  if (!tasks.length) els.ballMeta.textContent = '还没有事';
  else if (active.length) els.ballMeta.textContent = `${active.length} 件在推`;
  else els.ballMeta.textContent = '都完成了';
}

/** 176 宽的窗口里，这行字必须短。 */
function buddyCaption(activeCount, doneCount) {
  if (activeCount) return `${activeCount} 件在推`;
  if (doneCount) return `已完成 ${doneCount} 件`;
  return '点一下，拆第一步';
}

function renderBuddy() {
  if (!ui.data) return;
  const tasks = allTasks();
  const active = sortedActive();
  const done = sortedDone();
  const progress = overallProgress(tasks);
  const mood = moodOf(progress, tasks.length);

  els.stageBuddy.dataset.mood = mood;
  els.buddyPct.innerHTML = pctMarkup(progress);
  els.buddyMood.textContent = MOOD_LABELS[mood];
  els.buddyLabel.textContent = buddyCaption(active.length, done.length);
}

/** 自定义图片形态：底图 + 可选的进度文字。没图时回落成卡通人。 */
function renderCustom() {
  if (!ui.data) return;
  const custom = widgetCustomOf(ui.data.settings);
  const stage = els.stageCustom;
  if (!stage) return;

  stage.dataset.fit = custom.fit;
  stage.dataset.showText = custom.showText ? 'true' : 'false';
  stage.style.setProperty('--cu-dim', String(custom.dim));

  const tasks = allTasks();
  const active = sortedActive();
  const done = sortedDone();
  const progress = overallProgress(tasks);

  if (custom.file && els.customImg) {
    const url = customImageUrl(custom.file);
    // 只在真的换了图时重设 src，避免每次 state 推送都重新拉图闪一下
    if (els.customImg.dataset.src !== url) {
      els.customImg.dataset.src = url;
      els.customImg.src = url;
    }
    stage.classList.add('has-image');
  } else {
    if (els.customImg) {
      els.customImg.removeAttribute('src');
      delete els.customImg.dataset.src;
    }
    stage.classList.remove('has-image');
  }

  if (els.customPct) els.customPct.innerHTML = pctMarkup(progress);
  if (els.customMeta) els.customMeta.textContent = buddyCaption(active.length, done.length);
}

/* ==========================================================================
   渲染 · 展开面板
   ========================================================================== */

function summaryParts(active, done) {
  const tasks = allTasks();
  const nodes = milestoneStats(tasks);
  const dueToday = active.filter((task) => task.dueDate === todayKey()).length;
  const parts = [];
  if (dueToday) parts.push(`${dueToday} 个今天到期`);
  if (nodes.total) parts.push(`${nodes.done}/${nodes.total} 节点完成`);
  if (!active.length && done.length) parts.push('都完成了，留一点空白');
  if (!parts.length) parts.push('把模糊的事，推进一步');
  return parts;
}

function summaryNote(active, done) {
  const tasks = allTasks();
  if (!tasks.length) return '还没有什么事';
  if (!active.length) {
    return done.length ? `这一轮 ${done.length} 件都收尾了` : '还没有什么事';
  }
  const top = active[0];
  return top ? `正在推：${top.title}` : `${active.length} 件在推进`;
}

function renderSummary(active, done) {
  const tasks = allTasks();
  const progress = overallProgress(tasks);
  const dueToday = active.filter((task) => task.dueDate === todayKey()).length;

  paintRing(els.xRing, progress);
  els.xRingPct.innerHTML = pctMarkup(progress);
  els.xSumNote.textContent = summaryNote(active, done);
  els.xSumBar.style.width = `${progress}%`;

  if (dueToday) {
    els.xSumDue.textContent = `${dueToday} 个今天到期`;
    els.xSumDue.classList.remove('is-empty');
  } else if (active.length) {
    els.xSumDue.textContent = `${active.length} 件进行中`;
    els.xSumDue.classList.remove('is-empty');
  } else {
    els.xSumDue.textContent = '';
    els.xSumDue.classList.add('is-empty');
  }

  els.xSumSub.textContent = summaryParts(active, done).join(' · ');
}

function emptyMarkup(mode) {
  if (mode === 'done') {
    return `
      <div class="x-empty">
        <div class="x-empty-art">${icon('check', 16)}</div>
        <div class="x-empty-title">还没有完成的事</div>
        <p class="x-empty-copy">完成一个节点也算数。先从手边最小的一步开始。</p>
      </div>
    `;
  }
  return `
    <div class="x-empty">
      <div class="x-empty-art">${icon('spark', 16)}</div>
      <div class="x-empty-title">现在没有进行中的事</div>
      <p class="x-empty-copy">在下面写一件想做的事，或者打开工作台，把一件事拆成下一小步。</p>
    </div>
  `;
}

function cardMarkup(task) {
  const cat = categoryOf(ui.data.categories, task.category);
  const progress = progressOf(task);
  const next = nextMilestone(task);
  const done = task.status === 'done';
  const due = dueInfo(task.dueDate);
  const nodeDone = task.milestones.filter((item) => item.done).length;

  let nextMarkup = '';
  if (done) {
    nextMarkup = `
      <div class="x-done-meta">
        ${icon('check', 9)}
        <span>${escapeHTML(completedLabel(task.completedAt))}</span>
        <span>· ${nodeDone}/${task.milestones.length} 节点</span>
      </div>
    `;
  } else if (next) {
    const nextDue = dueInfo(next.dueDate);
    nextMarkup = `
      <button class="x-next" type="button" data-action="toggle-node" data-task-id="${escapeHTML(task.id)}" data-node-id="${escapeHTML(next.id)}" title="完成这个节点">
        <span class="x-node-check">${icon('check', 7)}</span>
        <span class="x-node-title">${escapeHTML(next.title)}</span>
        ${nextDue ? `<span class="x-node-due ${escapeHTML(nextDue.tone)}">${escapeHTML(nextDue.label)}</span>` : ''}
      </button>
    `;
  } else if (task.milestones.length) {
    nextMarkup = `
      <div class="x-next">
        <span class="x-node-check is-done">${icon('check', 7)}</span>
        <span class="x-node-title is-placeholder">所有节点完成，可以收尾</span>
      </div>
    `;
  } else {
    nextMarkup = `
      <div class="x-next">
        <span class="x-node-check" style="border-style:dashed">${icon('plus', 7)}</span>
        <span class="x-node-title is-placeholder">拆出第一个能开始的小节点</span>
      </div>
    `;
  }

  return `
    <article
      class="x-card ${done ? 'is-done' : ''}"
      data-task-id="${escapeHTML(task.id)}"
      tabindex="0"
      role="button"
      aria-label="打开任务：${escapeHTML(task.title)}"
      style="--cat-color:${escapeHTML(cat.color)};--cat-tint:${hexToRgba(cat.color, 0.12)}"
    >
      <div class="x-card-top">
        <span class="x-cat-tag"><span class="dot"></span>${escapeHTML(cat.name)}</span>
        ${due && !done ? `<span class="x-due ${escapeHTML(due.tone)}">${escapeHTML(due.label)}</span>` : ''}
        <span class="x-pct">${progress}%</span>
      </div>
      <div class="x-title">${escapeHTML(task.title)}</div>
      <div class="x-bar"><span style="width:${progress}%"></span></div>
      ${nextMarkup}
    </article>
  `;
}

function renderExpanded({ keepScroll = false } = {}) {
  if (!ui.data) return;
  els.xDate.textContent = formatHeaderDate(new Date());

  const active = sortedActive();
  const done = sortedDone();
  renderSummary(active, done);

  els.xActiveCount.textContent = String(active.length);
  els.xDoneCount.textContent = String(done.length);
  for (const tab of document.querySelectorAll('[data-tab]')) {
    const selected = tab.dataset.tab === ui.tab;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', String(selected));
  }

  const tasks = ui.tab === 'active' ? active : done;
  const scrollTop = keepScroll ? els.xList.scrollTop : 0;
  els.xList.innerHTML = tasks.length ? tasks.map(cardMarkup).join('') : emptyMarkup(ui.tab);
  if (keepScroll) els.xList.scrollTop = scrollTop;

  applyPinState();
  renderCategoryButton();
}

function render(options) {
  if (!ui.data) return;
  // 数据变了（例如刚选了图 / 刚移除了图）要重新定一次收起态该长什么样，
  // 否则回落只在形态推送的那一刻生效。
  if (!ui.expanded) {
    const wanted = collapsedModeOf(ui.data.settings);
    if (els.root.dataset.widgetStyle !== wanted) {
      applyMode(wanted);
    }
  }

  applyAppearance(ui.data.settings || {});
  renderBall();
  renderBuddy();
  renderCustom();
  renderExpanded(options);
}

/* ==========================================================================
   设置相关
   ========================================================================== */

function currentPinned() {
  return ui.data?.settings?.widgetPinned !== false;
}

function currentStyle() {
  return collapsedModeOf(ui.data?.settings);
}

function applyPinState() {
  const pinned = currentPinned();
  if (els.xPin) {
    els.xPin.classList.toggle('is-on', pinned);
    els.xPin.title = pinned ? '取消置顶' : '让浮层保持置顶';
    els.xPin.setAttribute('aria-label', els.xPin.title);
  }
  const ctxPin = $('#ctxPin');
  if (ctxPin) ctxPin.textContent = pinned ? '取消置顶' : '保持置顶';

  // 展开态没开置顶时给个可以一点就开的提示
  if (els.xPinHint) {
    const show = !pinned && ui.expanded;
    els.xPinHint.hidden = !show;
  }
  for (const mark of document.querySelectorAll('[data-check]')) {
    const button = mark.closest('button');
    if (button) button.classList.toggle('is-checked', currentStyle() === mark.dataset.check);
  }
}

function renderCategoryButton() {
  const cat = categoryOf(ui.data?.categories, ui.category);
  els.xCatName.textContent = cat.name;
  els.xCatDot.style.background = cat.color;
}

function showToastMessage(message, tone = 'normal') {
  if (!ui.expanded) return;
  showToast(els.toastRoot, message, tone);
}

/* ==========================================================================
   动作
   ========================================================================== */

async function addTask() {
  const title = els.xInput.value.trim();
  if (!title) {
    els.xInput.focus();
    return;
  }
  if (ui.busy) return;
  ui.busy = true;
  const submit = $('button[type="submit"]', els.xForm);
  if (submit) submit.disabled = true;
  try {
    await window.api.createTask({ title, category: ui.category });
    els.xInput.value = '';
    ui.tab = 'active';
    els.xInput.focus();
  } catch (error) {
    showToastMessage(error.message || '没有添加成功', 'error');
  } finally {
    ui.busy = false;
    if (submit) submit.disabled = false;
  }
}

async function togglePin() {
  if (!ui.data) return;
  const next = !currentPinned();
  ui.data.settings.widgetPinned = next;
  applyPinState();
  try {
    await window.api.updateSettings({ widgetPinned: next });
    showToastMessage(next ? '已置顶，会停在其他窗口上方。' : '已取消置顶。');
  } catch (error) {
    ui.data.settings.widgetPinned = !next;
    applyPinState();
    showToastMessage(error.message || '置顶状态没有保存', 'error');
  }
}

async function switchStyle(style) {
  const next = normalizeMode(style);
  closeContextMenu();
  if (ui.expanded && currentStyle() === next) return;
  try {
    // 宿主收到 settings:update 后会用 CollapsedMode 重设窗口（仅收起态），
    // 并推 widget-mode，所以这里只发命令，不自己切布局。
    await window.api.updateSettings({ widgetStyle: next });
    // 选了「自己的图」但还没选图：按卡通人显示，并顺手把人引到工作台去选图
    if (next === MODE.CUSTOM && !widgetCustomOf(ui.data?.settings).file) {
      showToastMessage('还没有选图，先按卡通人显示；去工作台「外观 → 自己的图」选一张。');
    }
  } catch (error) {
    showToastMessage(error.message || '形态没有切换', 'error');
  }
}

async function expand() {
  if (ui.expanded) return;
  try {
    await window.api.expandWidget();
  } catch (error) {
    showToastMessage(error.message || '展开失败', 'error');
  }
}

async function collapse() {
  if (!ui.expanded) return;
  closeContextMenu();
  try {
    await window.api.collapseWidget();
  } catch (error) {
    showToastMessage(error.message || '收起失败', 'error');
  }
}

/* ==========================================================================
   拖动：pointerdown + pointermove 的相对位移 → widget:drag-start/move/end
   不用老的 window:drag（那是宿主 StartWindowDrag，会瞬移）。
   ========================================================================== */

const drag = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  moved: false,
  stage: null,
  /** 宿主拖起点是否已建立 */
  started: false,
  /** beginWidgetDrag 的 promise 链，保证 drag-move 在 start 之后 */
  queue: Promise.resolve()
};

/** 哪些地方按下可以拖：球整块、小人整块、面板只有头部。 */
function dragStageOf(event) {
  if (event.target.closest('button, input, textarea, select, a, .ctx, .x-list')) return null;
  const stage = event.target.closest('.stage');
  if (!stage) return null;
  if (stage.id === 'stageExpanded') {
    return event.target.closest('.x-head') ? stage : null;
  }
  return stage;
}

/**
 * 取指针在屏幕上的位置。WebView2 一定给 screenX/screenY；只有极端情况下
 * 两者同时为 0 时才退回 client 坐标（那种情况下没有宿主搬窗口，够用）。
 */
function pointerPos(event) {
  if (event.screenX || event.screenY) {
    return { x: event.screenX, y: event.screenY };
  }
  return { x: event.clientX, y: event.clientY };
}

function beginDrag(event, stage) {
  const pos = pointerPos(event);
  drag.active = true;
  drag.pointerId = event.pointerId;
  drag.startX = pos.x;
  drag.startY = pos.y;
  drag.lastX = pos.x;
  drag.lastY = pos.y;
  drag.moved = false;
  drag.stage = stage;
  drag.started = false;
  drag.queue = Promise.resolve();
  stage.classList.add('is-dragging');
  try {
    // 捕获指针：宿主搬窗口时鼠标可能短暂离开页面，捕获后事件仍然回来
    stage.setPointerCapture(event.pointerId);
  } catch {
    // 不支持就算了，document 上的监听还在
  }
}

function startHostDrag() {
  drag.started = true;
  drag.queue = drag.queue
    .then(() => window.api.beginWidgetDrag())
    .catch(() => {
      drag.started = false;
    });
}

function moveHostDrag(dx, dy) {
  drag.queue = drag.queue
    .then(() => window.api.widgetDragMove(dx, dy))
    .catch(() => {});
}

/**
 * 用 screenX/screenY 而不是 clientX/clientY：
 * 宿主会跟着光标搬窗口，clientX 是相对窗口的，窗口一移动读数就被重置，
 * 用它会形成「窗口跟着自己跑」的正反馈。屏幕坐标不受窗口位置影响。
 * 乘 devicePixelRatio 是因为宿主 MoveWindow 收的是物理像素。
 */
function onPointerMove(event) {
  if (!drag.active || event.pointerId !== drag.pointerId) return;

  const pos = pointerPos(event);
  const scale = window.devicePixelRatio || 1;
  const dx = Math.round((pos.x - drag.lastX) * scale);
  const dy = Math.round((pos.y - drag.lastY) * scale);
  if (!dx && !dy) return;

  if (!drag.moved) {
    const totalX = (pos.x - drag.startX) * scale;
    const totalY = (pos.y - drag.startY) * scale;
    if (Math.abs(totalX) < DRAG_THRESHOLD && Math.abs(totalY) < DRAG_THRESHOLD) return;
    drag.moved = true;
    startHostDrag();
  }

  drag.lastX = pos.x;
  drag.lastY = pos.y;
  if (drag.started) moveHostDrag(dx, dy);
}

/** 收尾。返回拖动过程中是否真的移动过（用来决定要不要吞掉这次点击）。 */
function endDrag() {
  if (!drag.active) return false;
  const moved = drag.moved;
  const stage = drag.stage;
  const pointerId = drag.pointerId;
  drag.active = false;
  drag.moved = false;
  drag.stage = null;
  drag.pointerId = null;
  clearTimeout(longPressTimer);
  if (stage) {
    stage.classList.remove('is-dragging');
    try {
      stage.releasePointerCapture(pointerId);
    } catch {
      // 已经释放或从未捕获
    }
  }

  if (moved) {
    drag.queue = drag.queue
      .then(() => window.api.endWidgetDrag())
      .catch(() => {});
    // 拖动结束浏览器还会补一个 click，别让它当成「点一下展开」
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 160);
  } else if (drag.started) {
    drag.queue = drag.queue.then(() => window.api.endWidgetDrag()).catch(() => {});
  }
  drag.started = false;
  return moved;
}

/* ==========================================================================
   右键 / 长按菜单
   ========================================================================== */

let suppressClick = false;
let longPressTimer = null;

function openContextMenu(x, y) {
  if (!els.ctxMenu) return;
  applyPinState();
  els.ctxMenu.hidden = false;
  // 先显示再量，保证菜单不越出窗口
  const rect = els.ctxMenu.getBoundingClientRect();
  const maxX = Math.max(4, window.innerWidth - rect.width - 4);
  const maxY = Math.max(4, window.innerHeight - rect.height - 4);
  els.ctxMenu.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
  els.ctxMenu.style.top = `${Math.max(4, Math.min(y, maxY))}px`;
}

function closeContextMenu() {
  if (els.ctxMenu) els.ctxMenu.hidden = true;
}

function menuAllowed() {
  // 136 / 176 的窗口装不下菜单，收起态不给右键
  return ui.expanded;
}

/* ==========================================================================
   事件
   ========================================================================== */

function bindPointerEvents() {
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (!drag.active) {
      const stage = dragStageOf(event);
      if (stage) beginDrag(event, stage);
    }

    // 长按菜单（只有展开面板放得下）
    if (menuAllowed() && !event.target.closest('button, input, textarea, select')) {
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        if (drag.moved) return;
        suppressClick = true;
        drag.active = false;
        drag.stage?.classList.remove('is-dragging');
        drag.stage = null;
        openContextMenu(event.clientX, event.clientY);
      }, LONG_PRESS_MS);
    }
  });

  document.addEventListener('pointermove', onPointerMove);

  document.addEventListener('pointerup', (event) => {
    if (!drag.active || event.pointerId !== drag.pointerId) {
      clearTimeout(longPressTimer);
      return;
    }
    const stage = drag.stage;
    const moved = endDrag();
    if (stage && !moved && !suppressClick) onStageTap(stage);
  });

  document.addEventListener('pointercancel', () => {
    clearTimeout(longPressTimer);
    endDrag();
  });

  window.addEventListener('blur', () => {
    clearTimeout(longPressTimer);
    endDrag();
  });

  document.addEventListener('dragstart', (event) => event.preventDefault());
}

/** 收起态点一下 = 展开；展开态点面板空白什么都不做。 */
function onStageTap(stage) {
  if (stage.id === 'stageExpanded') return;
  expand();
}

function bindClickEvents() {
  document.addEventListener('click', async (event) => {
    const menuItem = event.target.closest('[data-menu]');
    if (menuItem) {
      event.stopPropagation();
      const action = menuItem.dataset.menu;
      closeContextMenu();
      if (action === 'main') window.api.openMain();
      else if (action === 'ball' || action === 'buddy' || action === 'custom') switchStyle(action);
      else if (action === 'pin') togglePin();
      else if (action === 'hide') window.api.hideWidget();
      return;
    }

    if (els.ctxMenu && !els.ctxMenu.hidden && !event.target.closest('#ctxMenu')) {
      closeContextMenu();
    }

    if (suppressClick) {
      suppressClick = false;
      return;
    }

    const nodeButton = event.target.closest('[data-action="toggle-node"]');
    if (nodeButton) {
      event.stopPropagation();
      const taskId = nodeButton.dataset.taskId;
      const nodeId = nodeButton.dataset.nodeId;
      if (!taskId || !nodeId) return;
      try {
        await window.api.toggleMilestone(taskId, nodeId);
      } catch (error) {
        showToastMessage(error.message || '节点没有更新', 'error');
      }
      return;
    }

    const tab = event.target.closest('[data-tab]');
    if (tab) {
      ui.tab = tab.dataset.tab;
      renderExpanded();
      return;
    }

    if (event.target.closest('#xCollapse')) {
      collapse();
      return;
    }

    if (event.target.closest('#xPin')) {
      togglePin();
      return;
    }

    if (event.target.closest('#xPinHint')) {
      togglePin();
      return;
    }

    const menuButton = event.target.closest('#xMenuBtn');
    if (menuButton) {
      const rect = menuButton.getBoundingClientRect();
      openContextMenu(rect.right - 140, rect.bottom + 4);
      return;
    }

    if (event.target.closest('#xCat')) {
      const ids = categoryIds();
      const index = ids.indexOf(ui.category);
      ui.category = ids[(index + 1) % ids.length];
      renderCategoryButton();
      try {
        await window.api.updateSettings({ composerCategory: ui.category });
      } catch {
        // 只影响这一次会话
      }
      return;
    }

    const card = event.target.closest('[data-task-id]');
    if (card && !event.target.closest('[data-action]')) {
      window.api.openMain(card.dataset.taskId);
    }
  });

  // 卡片键盘操作
  els.xList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.x-card');
    if (!card || event.target !== card) return;
    event.preventDefault();
    window.api.openMain(card.dataset.taskId);
  });

  // 收起态键盘：Enter / 空格展开；Esc 关菜单
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeContextMenu();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (ui.expanded) return;
    if (!document.activeElement?.closest?.('.stage')) return;
    event.preventDefault();
    expand();
  });

  els.xForm.addEventListener('submit', (event) => {
    event.preventDefault();
    addTask();
  });

  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (!menuAllowed()) return;
    openContextMenu(event.clientX, event.clientY);
  });
}

function bindHostEvents() {
  window.api.onState((state) => {
    const first = !ui.data;
    ui.data = state;
    const settings = state?.settings || {};

    if (!ui.category || first) ui.category = settings.composerCategory || 'life';

    // 宿主构造 WidgetForm 时用 ApplyMode 定初态、不推 widget-mode，
    // 所以首帧按 settings.widgetStyle（窗口已是展开尺寸时保持展开）自己定；
    // 之后一律以宿主推送为准。
    if (first && !ui.hostModeKnown) {
      applyMode(resolveInitialMode(settings));
    }

    render({ keepScroll: !first && ui.expanded });
    if (first) {
      requestAnimationFrame(() => {
        if (els.xList) els.xList.scrollTop = 0;
      });
    }
  });

  if (typeof window.api.onWidgetMode === 'function') {
    window.api.onWidgetMode((mode) => {
      ui.hostModeKnown = true;
      applyMode(mode);
      render();
    });
  }

  // 宿主改窗口尺寸到推送之间有一小段空档，用 resize 兜底：
  // 尺寸变到展开档就立刻切布局，避免大圆球闪一下；反之亦然。
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const inferred = inferModeFromViewport();
      if (inferred === MODE.EXPANDED && !ui.expanded) {
        ui.hostModeKnown = true;
        applyMode(MODE.EXPANDED);
        render();
      } else if (inferred !== MODE.EXPANDED && ui.expanded) {
        ui.hostModeKnown = true;
        applyMode(collapsedModeOf(ui.data?.settings));
        render();
      }
    }, 40);
  });
}

/* ==========================================================================
   启动
   ========================================================================== */

function readInitialMode() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (mode) return normalizeMode(mode);
  return inferModeFromViewport();
}

/**
 * 宿主初始化时只按 settings.widgetStyle 定窗口，不推 widget-mode。
 * 页面首次加载时用窗口尺寸兜底判断：
 * 展开态是 384×580，收起态最大也就 216×255（大号卡通人），两者差得很开。
 * 收起态再按宽高比区分球（正方形）和卡通人（竖长），就不再依赖写死的像素值，
 * 三档大小都成立。
 */
function inferModeFromViewport() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (height >= 420 && width >= 300) return MODE.EXPANDED;

  // 收起态：宽高接近 1:1 是球，明显竖长是卡通人 / 自定义图（两者尺寸一致，
  // 靠 settings.widgetStyle 再区分，这里只负责判断「不是球」）
  const ratio = height / Math.max(width, 1);
  return ratio > 1.08 ? MODE.BUDDY : MODE.BALL;
}

/**
 * 首帧 / 首次 state 时决定形态。
 * 宿主构造 WidgetForm 时就按 settings.widgetStyle 定好窗口尺寸（136 / 176），
 * 所以窗口尺寸本身就是最可靠的信息：直接按尺寸认，比 settings 更不会错位。
 * 尺寸落在两者之间（不该出现）时才回落到 settings.widgetStyle。
 */
function resolveInitialMode(settings) {
  const byViewport = inferModeFromViewport();
  if (byViewport === MODE.EXPANDED) return MODE.EXPANDED;

  // 收起态想要哪个（已含「选了图但没图 → 卡通人」的回落）
  const wanted = collapsedModeOf(settings);

  // 竖长窗口：buddy 和 custom 尺寸相同，只能靠设置区分
  if (byViewport === MODE.BUDDY) {
    return wanted === MODE.BALL ? MODE.BUDDY : wanted;
  }

  // 球形态：再和设置对一下，两边都指向球才用球
  if (wanted !== MODE.BALL && window.innerWidth > window.innerHeight * 1.08) {
    return wanted;
  }
  return MODE.BALL;
}

async function init() {
  // 首帧先定形态，避免三种布局同时可见
  applyMode(readInitialMode());
  bindPointerEvents();
  bindClickEvents();
  bindHostEvents();

  try {
    const result = await window.api.getState();
    ui.data = result.state;
    const settings = result.state?.settings || {};
    ui.category = settings.composerCategory || 'life';
    if (!ui.hostModeKnown) {
      applyMode(resolveInitialMode(settings));
    }
    render();
  } catch (error) {
    els.ballMeta.textContent = '连接中';
    els.buddyLabel.textContent = '连接中';
    showToastMessage(error.message || '读取数据失败', 'error');
  }
}

init();

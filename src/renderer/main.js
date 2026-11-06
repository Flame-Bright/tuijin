import {
  categoryOf,
  completedLabel,
  completedThisWeek,
  debounce,
  dueInfo,
  emptyProgressRingSVG,
  escapeHTML,
  formatHeaderDate,
  formatShortDate,
  greeting,
  hexToRgba,
  icon,
  milestoneStats,
  nextMilestone,
  overallProgress,
  progressOf,
  relativeTime,
  showToast,
  sortTasks,
  todayKey
} from './shared.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/* ---------------- 外观常量（与宿主 Appearance 白名单保持一致） ---------------- */

const ACCENTS = ['clay', 'sage', 'ocean', 'plum', 'amber', 'ink'];
const PRESETS = ['sunrise', 'dusk', 'forest', 'ocean', 'paper', 'night', 'gradient', 'web'];
const WIDGET_STYLES = ['ball', 'buddy', 'custom'];
const WIDGET_SIZES = ['small', 'medium', 'large'];
const SIZE_LABELS = { small: '小', medium: '中', large: '大' };

const FONT_MIN = 0.8;
const FONT_MAX = 1.6;
const FONT_STEP = 0.05;
const FONT_DEFAULT = 1;

const WALLPAPER_DEFAULTS = {
  kind: 'none',
  preset: 'sunrise',
  file: null,
  dim: 0.18,
  blur: 0,
  onMain: true
};

/* 桌面浮层的自定义图片（契约第一节 widgetCustom） */
const WIDGET_CUSTOM_DEFAULTS = {
  file: null,
  fit: 'cover',
  dim: 0.12,
  showText: true
};
const WIDGET_CUSTOM_FITS = ['cover', 'contain'];
const WIDGET_CUSTOM_DIM_MIN = 0;
const WIDGET_CUSTOM_DIM_MAX = 0.6;

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/* 滑块位置（0–1），用来给 range 轨道上色 */
function rangeRatio(value, min, max) {
  if (max <= min) return 0;
  return (clampNumber(value, min, max, min) - min) / (max - min);
}

function normalizedWallpaper(wallpaper) {
  const wall = wallpaper || {};
  let kind = 'none';
  if (wall.kind === 'image' && wall.file) kind = 'image';
  else if (wall.kind === 'preset') kind = 'preset';

  return {
    kind,
    preset: PRESETS.includes(wall.preset) ? wall.preset : WALLPAPER_DEFAULTS.preset,
    file: wall.file || null,
    dim: clampNumber(wall.dim, 0, 0.8, WALLPAPER_DEFAULTS.dim),
    blur: clampNumber(wall.blur, 0, 24, WALLPAPER_DEFAULTS.blur),
    onMain: wall.onMain !== false
  };
}

function wallpaperUrl(file) {
  return `https://tuijin.wall/${encodeURIComponent(file)}`;
}

/* 自定义图片走浮层专用虚拟主机（契约第一节） */
function widgetCustomUrl(file) {
  return `https://tuijin.widget/${encodeURIComponent(file)}`;
}

function normalizeWidgetCustom(custom) {
  const source = custom || {};
  return {
    file: source.file || null,
    fit: WIDGET_CUSTOM_FITS.includes(source.fit) ? source.fit : WIDGET_CUSTOM_DEFAULTS.fit,
    dim: clampNumber(source.dim, WIDGET_CUSTOM_DIM_MIN, WIDGET_CUSTOM_DIM_MAX, WIDGET_CUSTOM_DEFAULTS.dim),
    showText: source.showText !== false
  };
}

function clampScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return FONT_DEFAULT;
  return Math.round(clampNumber(number, FONT_MIN, FONT_MAX, FONT_DEFAULT) * 100) / 100;
}

function scaleText(scale) {
  return `${Math.round(clampScale(scale) * 100)}%`;
}

const els = {
  dateLine: $('#dateLine'),
  heroGreeting: $('#heroGreeting'),
  heroSub: $('#heroSub'),
  overallRing: $('#overallRing'),
  overallLabel: $('#overallLabel'),
  composer: $('#composer'),
  composerInput: $('#composerInput'),
  composerDue: $('#composerDue'),
  taskGrid: $('#taskGrid'),
  listTitle: $('#listTitle'),
  listCount: $('#listCount'),
  sortSelect: $('#sortSelect'),
  allCount: $('#allCount'),
  activeCount: $('#activeCount'),
  doneCount: $('#doneCount'),
  drawerRoot: $('#drawerRoot'),
  detailTitle: $('#detailTitle'),
  detailNote: $('#detailNote'),
  detailCategory: $('#detailCategory'),
  drawerCatDot: $('#drawerCatDot'),
  detailRingWrap: $('#detailRingWrap'),
  progressSlider: $('#progressSlider'),
  progressHint: $('#progressHint'),
  autoRow: $('#autoRow'),
  autoProgress: $('#autoProgress'),
  detailDue: $('#detailDue'),
  detailCreated: $('#detailCreated'),
  detailStatusChip: $('#detailStatusChip'),
  nodeCount: $('#nodeCount'),
  nodeList: $('#nodeList'),
  nodeForm: $('#nodeForm'),
  nodeInput: $('#nodeInput'),
  nodeDue: $('#nodeDue'),
  completeBtn: $('#completeBtn'),
  deleteBtn: $('#deleteBtn'),
  modalRoot: $('#modalRoot'),
  modalCopy: $('#modalCopy'),
  confirmDeleteBtn: $('#confirmDeleteBtn'),
  toastRoot: $('#toastRoot'),
  globalSearch: $('#globalSearch'),
  maximizeBtn: $('#maximizeBtn'),
  fontQuickValue: $('#fontQuickValue'),
  appearanceRoot: $('#appearanceRoot'),
  fontScaleRange: $('#fontScaleRange'),
  fontScaleLabel: $('#fontScaleLabel'),
  wallpaperPresetRow: $('#wallpaperPresetRow'),
  wallpaperImageRow: $('#wallpaperImageRow'),
  wallpaperThumb: $('#wallpaperThumb'),
  wallpaperFileName: $('#wallpaperFileName'),
  wallpaperDimRange: $('#wallpaperDimRange'),
  wallpaperDimLabel: $('#wallpaperDimLabel'),
  wallpaperBlurRange: $('#wallpaperBlurRange'),
  wallpaperBlurLabel: $('#wallpaperBlurLabel'),
  wallpaperOnMain: $('#wallpaperOnMain'),
  widgetPinnedSwitch: $('#widgetPinnedSwitch'),
  widgetVisibleSwitch: $('#widgetVisibleSwitch'),
  widgetCustomRow: $('#widgetCustomRow'),
  widgetCustomThumb: $('#widgetCustomThumb'),
  widgetCustomName: $('#widgetCustomName'),
  widgetCustomPickBtn: $('#widgetCustomPickBtn'),
  widgetCustomClearBtn: $('#widgetCustomClearBtn'),
  widgetCustomDimRange: $('#widgetCustomDimRange'),
  widgetCustomDimLabel: $('#widgetCustomDimLabel'),
  widgetCustomShowText: $('#widgetCustomShowText')
};

const ui = {
  data: null,
  view: 'all',
  category: null,
  search: '',
  sort: 'manual',
  composerCategory: 'life',
  selectedId: null,
  drawerOpen: false,
  modalOpen: false,
  pendingDeleteId: null,
  isSliding: false,
  composerBusy: false,
  lastFocus: null,
  appearanceOpen: false,
  appearanceLastFocus: null,
  fontScale: FONT_DEFAULT,
  accent: 'clay',
  widgetStyle: 'ball',
  widgetSize: 'small',
  wallpaper: { ...WALLPAPER_DEFAULTS },
  widgetCustom: { ...WIDGET_CUSTOM_DEFAULTS }
};

const seenTaskIds = new Set();
let info = null;

function getTask(id = ui.selectedId) {
  if (!ui.data || !id) return null;
  return ui.data.tasks.find((task) => task.id === id) || null;
}

/* ---------------- 外观应用（契约第三节） ---------------- */

function applyAppearance(settings) {
  const root = document.documentElement;
  // 本地还没落盘的改动优先，避免宿主推送的旧 state 把拖动中的滑块弹回去
  const source = pendingAppearancePatch
    ? mergePatch(settings || {}, pendingAppearancePatch)
    : (settings || {});

  const fontScale = clampScale(source.fontScale ?? FONT_DEFAULT);
  root.style.setProperty('--ui-scale', String(fontScale));
  ui.fontScale = fontScale;

  root.dataset.theme = source.theme === 'dark' ? 'dark' : 'light';
  ui.accent = ACCENTS.includes(source.accent) ? source.accent : 'clay';
  root.dataset.accent = ui.accent;

  ui.widgetStyle = WIDGET_STYLES.includes(source.widgetStyle) ? source.widgetStyle : 'ball';
  ui.widgetSize = WIDGET_SIZES.includes(source.widgetSize) ? source.widgetSize : 'small';

  const wall = normalizedWallpaper(source.wallpaper);
  ui.wallpaper = wall;

  // 浮层自定义图片：file / fit / dim / showText
  ui.widgetCustom = normalizeWidgetCustom(source.widgetCustom);

  root.style.setProperty('--wallpaper-dim', String(wall.dim));
  root.style.setProperty('--wallpaper-blur', `${wall.blur}px`);

  let presetName = 'none';
  if (wall.kind === 'image' && wall.file) {
    root.dataset.wallpaper = 'image';
    root.style.setProperty('--wallpaper-css', `url("${wallpaperUrl(wall.file)}")`);
  } else if (wall.kind === 'preset') {
    presetName = wall.preset;
    root.dataset.wallpaper = wall.preset;
    root.style.removeProperty('--wallpaper-css');
  } else {
    root.dataset.wallpaper = 'none';
    root.style.removeProperty('--wallpaper-css');
  }

  // 工作台只在「铺到工作台 + 有壁纸」时显示壁纸层
  const wallpaperOn = wall.kind !== 'none' && wall.onMain;
  if (wallpaperOn) root.dataset.wallpaperOn = '1';
  else delete root.dataset.wallpaperOn;

  syncAppearanceUI(presetName);
}

/* 把当前外观状态刷到面板控件上 */
function syncAppearanceUI(presetName = null) {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const wall = ui.wallpaper;

  for (const button of $$('[data-theme-set]')) {
    button.classList.toggle('active', button.dataset.themeSet === theme);
    button.classList.toggle('is-on', button.dataset.themeSet === theme);
  }

  const percentText = scaleText(ui.fontScale);
  if (els.fontScaleRange) {
    els.fontScaleRange.value = String(ui.fontScale);
    els.fontScaleRange.style.setProperty(
      '--range',
      `${rangeRatio(ui.fontScale, FONT_MIN, FONT_MAX) * 100}%`
    );
  }
  if (els.fontScaleLabel) els.fontScaleLabel.textContent = percentText;
  if (els.fontQuickValue) els.fontQuickValue.textContent = `字号 ${percentText}`;

  for (const chip of $$('[data-action="font-preset"]')) {
    chip.classList.toggle('is-on', Math.abs(Number(chip.dataset.scale) - ui.fontScale) < 0.001);
  }

  for (const swatch of $$('[data-accent-set]')) {
    swatch.classList.toggle('is-on', swatch.dataset.accentSet === ui.accent);
  }

  for (const card of $$('[data-widget-style]')) {
    card.classList.toggle('is-on', card.dataset.widgetStyle === ui.widgetStyle);
  }

  for (const card of $$('[data-widget-size]')) {
    card.classList.toggle('is-on', card.dataset.widgetSize === ui.widgetSize);
  }

  for (const seg of $$('[data-wallpaper-kind]')) {
    seg.classList.toggle('is-on', seg.dataset.wallpaperKind === wall.kind);
  }

  const activePreset = presetName === null ? (wall.kind === 'preset' ? wall.preset : '') : presetName;
  for (const swatch of $$('[data-wallpaper-preset]')) {
    swatch.classList.toggle('is-on', swatch.dataset.wallpaperPreset === activePreset);
  }

  if (els.wallpaperPresetRow) {
    els.wallpaperPresetRow.classList.toggle('is-shown', wall.kind === 'preset');
  }

  if (els.wallpaperImageRow) {
    els.wallpaperImageRow.classList.toggle('is-shown', wall.kind === 'image');
  }

  if (els.wallpaperThumb) {
    els.wallpaperThumb.style.backgroundImage = wall.file ? `url("${wallpaperUrl(wall.file)}")` : '';
  }

  if (els.wallpaperFileName) {
    els.wallpaperFileName.textContent = wall.file || '还没有选图片';
  }

  if (els.wallpaperDimRange) {
    els.wallpaperDimRange.value = String(wall.dim);
    els.wallpaperDimRange.style.setProperty(
      '--range',
      `${rangeRatio(wall.dim, 0, 0.8) * 100}%`
    );
  }
  if (els.wallpaperDimLabel) els.wallpaperDimLabel.textContent = `${Math.round(wall.dim * 100)}%`;

  if (els.wallpaperBlurRange) {
    els.wallpaperBlurRange.value = String(wall.blur);
    els.wallpaperBlurRange.style.setProperty(
      '--range',
      `${rangeRatio(wall.blur, 0, 24) * 100}%`
    );
  }
  if (els.wallpaperBlurLabel) els.wallpaperBlurLabel.textContent = String(Math.round(wall.blur));

  if (els.wallpaperOnMain) els.wallpaperOnMain.checked = Boolean(ui.wallpaper.onMain);
  if (els.widgetPinnedSwitch) {
    els.widgetPinnedSwitch.checked = ui.data?.settings?.widgetPinned !== false;
  }
  // 缺省 true：老数据没有这个字段时按「显示」处理
  if (els.widgetVisibleSwitch) {
    els.widgetVisibleSwitch.checked = ui.data?.settings?.widgetVisible !== false;
  }

  /* ---- 自定义图片设置区（只在桌面形态选了 custom 时露出来） ---- */
  const custom = ui.widgetCustom;

  if (els.widgetCustomRow) {
    els.widgetCustomRow.classList.toggle('is-shown', ui.widgetStyle === 'custom');
  }

  for (const chip of $$('[data-widget-fit]')) {
    chip.classList.toggle('is-on', chip.dataset.widgetFit === custom.fit);
  }

  if (els.widgetCustomThumb) {
    els.widgetCustomThumb.style.backgroundImage = custom.file
      ? `url("${widgetCustomUrl(custom.file)}")`
      : '';
  }

  if (els.widgetCustomName) {
    els.widgetCustomName.textContent = custom.file || '还没有选图片';
  }

  if (els.widgetCustomDimRange) {
    const dimValue = Math.round(custom.dim * 100);
    els.widgetCustomDimRange.value = String(dimValue);
    els.widgetCustomDimRange.style.setProperty(
      '--range',
      `${rangeRatio(custom.dim, WIDGET_CUSTOM_DIM_MIN, WIDGET_CUSTOM_DIM_MAX) * 100}%`
    );
  }
  if (els.widgetCustomDimLabel) {
    els.widgetCustomDimLabel.textContent = `${Math.round(custom.dim * 100)}%`;
  }

  if (els.widgetCustomShowText) els.widgetCustomShowText.checked = custom.showText !== false;
}

/* ---------------- 保存：所有外观改动都走 settings:update 的 patch ---------------- */

/* 所有外观改动都走 settings:update 的 patch。
   连续操作会合并成一个 patch（wallpaper 仍然按字段合并），避免后一次覆盖前一次。 */
let pendingAppearancePatch = null;

function mergePatch(base, extra) {
  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(extra || {})) {
    merged[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(merged[key] || {}), ...value }
      : value;
  }
  return merged;
}

const flushAppearance = debounce(async () => {
  const patch = pendingAppearancePatch;
  pendingAppearancePatch = null;
  if (!patch) return;
  try {
    const result = await window.api.updateSettings(patch);
    if (result?.state) {
      // 只同步数据，不重刷外观：本地已经是最新值，重刷反而会在拖动时回跳。
      ui.data = result.state;
    }
  } catch (error) {
    showToastMessage(error.message || '外观没有保存', 'error');
  }
}, 320);

function saveAppearance(patch) {
  if (!patch) return;
  pendingAppearancePatch = mergePatch(pendingAppearancePatch, patch);
  flushAppearance();
}

/* 关面板 / 关窗口前把没落盘的改动补上，避免最后一下拖动丢掉 */
function flushAppearanceNow() {
  flushAppearance.cancel();
  const patch = pendingAppearancePatch;
  pendingAppearancePatch = null;
  if (!patch) return;
  try {
    const result = window.api.updateSettings(patch);
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch {
    // 关闭途中的保存失败不值得打扰用户。
  }
}

/* 字号要实时生效，所以本地先写 --ui-scale，再 debounce 落盘 */
function setFontScale(value, options = {}) {
  const scale = clampScale(value);
  ui.fontScale = scale;
  document.documentElement.style.setProperty('--ui-scale', String(scale));

  if (ui.data?.settings) {
    ui.data.settings.fontScale = scale;
  }

  syncAppearanceUI();

  if (options.persist !== false) {
    saveAppearance({ fontScale: scale });
  }
  return scale;
}

function stepFontScale(direction) {
  const raw = ui.fontScale + direction * FONT_STEP;
  const applied = setFontScale(raw);
  if (raw > FONT_MAX + 0.001) {
    showToastMessage('已经放到最大了');
  } else if (raw < FONT_MIN - 0.001) {
    showToastMessage('已经缩到最小了');
  }
  return applied;
}

function resetFontScale() {
  setFontScale(FONT_DEFAULT);
  showToastMessage('字号已恢复 100%');
}

/* ---------------- 外观面板开关 ---------------- */

function setAppearanceOpen(open) {
  if (ui.appearanceOpen === open) return;
  ui.appearanceOpen = open;
  if (!els.appearanceRoot) return;

  els.appearanceRoot.classList.toggle('is-open', open);
  els.appearanceRoot.setAttribute('aria-hidden', String(!open));

  if (open) {
    ui.appearanceLastFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    syncAppearanceUI();
  } else if (ui.appearanceLastFocus && document.contains(ui.appearanceLastFocus)) {
    try {
      ui.appearanceLastFocus.focus({ preventScroll: true });
    } catch {
      // 焦点只是方便，不是必须。
    }
    ui.appearanceLastFocus = null;
  }
}

function closeAppearance() {
  flushAppearanceNow();
  setAppearanceOpen(false);
}

/* ---------------- 壁纸：选择 / 移除 ---------------- */

/* webview-api.js 不在本任务写入范围；如果宿主侧还没暴露 pickWallpaper，
   这里用自建 invoke 兜底（id 从 1000000 起，避开 webview-api.js 的递增序号）。 */
let wallpaperBridgeFallback = null;

function fallbackWallpaperInvoke(type, payload = {}, timeoutMs = 20000) {
  if (!window.chrome?.webview) {
    return Promise.reject(new Error('桌面宿主没有响应'));
  }
  if (!wallpaperBridgeFallback) {
    let sequence = 1000000;
    const pending = new Map();

    window.chrome.webview.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object' || message.type !== 'response') return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.ok) request.resolve(message.data);
      else request.reject(new Error(message.error || '操作没有完成'));
    });

    wallpaperBridgeFallback = function invoke(command, commandPayload) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('桌面宿主没有响应'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        window.chrome.webview.postMessage({ type: command, id, payload: commandPayload });
      });
    };
  }
  return wallpaperBridgeFallback(type, payload);
}

function pickWallpaperBridge() {
  if (typeof window.api?.pickWallpaper === 'function') {
    return window.api.pickWallpaper();
  }
  return fallbackWallpaperInvoke('wallpaper:pick');
}

function clearWallpaperBridge() {
  if (typeof window.api?.clearWallpaper === 'function') {
    return window.api.clearWallpaper();
  }
  return fallbackWallpaperInvoke('wallpaper:clear');
}

async function chooseWallpaper() {
  try {
    const result = await pickWallpaperBridge();
    const file = result?.file;
    if (!file) return;
    // 只换图片，保留用户已经调好的压暗/模糊/铺到工作台
    const patch = {
      wallpaper: { kind: 'image', file, preset: ui.wallpaper.preset }
    };
    patchWallpaper(patch.wallpaper);
    showToastMessage('壁纸已换成这张图。', 'success');
  } catch (error) {
    showToastMessage(error.message || '没有选到图片', 'error');
  }
}

async function removeWallpaper() {
  try {
    await clearWallpaperBridge();
  } catch (error) {
    showToastMessage(error.message || '壁纸没有移除', 'error');
    return;
  }
  patchWallpaper({ kind: 'none', file: null });
  showToastMessage('壁纸已移除。');
}

/* ---------------- 浮层自定义图片：选择 / 移除 ---------------- */

/* 桥接命令由宿主提供（契约第二节 widget-custom:*）。
   宿主还没装好时 window.api 上可能还没有这两个方法，这里只兜底提示，不另开通道。 */
async function chooseWidgetCustom() {
  if (typeof window.api?.pickWidgetCustom !== 'function') {
    showToastMessage('桌面宿主还没准备好，稍后再试一次。', 'error');
    return;
  }
  try {
    const result = await window.api.pickWidgetCustom();
    const file = result?.file;
    if (!file) return;
    patchWidgetCustom({ file });
    showToastMessage('桌面小人的图换好了。', 'success');
  } catch (error) {
    showToastMessage(error.message || '没有选到图片', 'error');
  }
}

async function removeWidgetCustom() {
  if (typeof window.api?.clearWidgetCustom !== 'function') {
    showToastMessage('桌面宿主还没准备好，稍后再试一次。', 'error');
    return;
  }
  try {
    await window.api.clearWidgetCustom();
  } catch (error) {
    showToastMessage(error.message || '图片没有移除', 'error');
    return;
  }
  patchWidgetCustom({ file: null });
  showToastMessage('自定义图片已移除。');
}

function patchWidgetCustom(partial) {
  const next = normalizeWidgetCustom({ ...ui.widgetCustom, ...partial });
  ui.widgetCustom = next;
  // 本地设置同步一份，免得宿主下一条 state 把面板刷回旧值
  if (ui.data?.settings) ui.data.settings.widgetCustom = { ...next };
  applyAppearance(ui.data?.settings || { widgetCustom: next });
  saveAppearance({ widgetCustom: partial });
}

/* ---------------- 局部 patch 帮助函数 ---------------- */

function patchWallpaper(partial) {
  const next = normalizedWallpaper({ ...ui.wallpaper, ...partial });
  ui.wallpaper = next;
  // 本地设置也要跟着更新，否则宿主下次推 state / 重渲染会把面板刷回旧值
  if (ui.data?.settings) ui.data.settings.wallpaper = { ...next };
  applyAppearance(ui.data?.settings || { wallpaper: next });
  saveAppearance({ wallpaper: partial });
}

async function setTheme(theme) {
  const value = theme === 'dark' ? 'dark' : 'light';
  if (ui.data?.settings) ui.data.settings.theme = value;
  document.documentElement.dataset.theme = value;
  syncAppearanceUI();
  renderSidebar();
  try {
    await window.api.updateSettings({ theme: value });
  } catch (error) {
    showToastMessage(error.message || '主题没有保存', 'error');
  }
}

async function setAccent(accent) {
  if (!ACCENTS.includes(accent)) return;
  ui.accent = accent;
  document.documentElement.dataset.accent = accent;
  if (ui.data?.settings) ui.data.settings.accent = accent;
  syncAppearanceUI();
  try {
    await window.api.updateSettings({ accent });
  } catch (error) {
    showToastMessage(error.message || '强调色没有保存', 'error');
  }
}

async function setWidgetStyle(style) {
  if (!WIDGET_STYLES.includes(style)) return;
  ui.widgetStyle = style;
  if (ui.data?.settings) ui.data.settings.widgetStyle = style;
  syncAppearanceUI();
  try {
    await window.api.updateSettings({ widgetStyle: style });
    const styleToast = style === 'ball'
      ? '桌面上会是一个圆。'
      : style === 'custom'
        ? '桌面上会是你自己的图；没选图就先按卡通人显示。'
        : '桌面上会是一个小人。';
    showToastMessage(styleToast, 'success');
  } catch (error) {
    showToastMessage(error.message || '桌面形态没有保存', 'error');
  }
}

async function setWidgetSize(size) {
  if (!WIDGET_SIZES.includes(size)) return;
  ui.widgetSize = size;
  if (ui.data?.settings) ui.data.settings.widgetSize = size;
  syncAppearanceUI();
  try {
    await window.api.updateSettings({ widgetSize: size });
    showToastMessage(`浮层大小已设为${SIZE_LABELS[size] || ''}。`, 'success');
  } catch (error) {
    showToastMessage(error.message || '浮层大小没有保存', 'error');
  }
}

async function resetAppearance() {
  const settings = {
    fontScale: FONT_DEFAULT,
    accent: 'clay',
    widgetStyle: 'ball',
    widgetSize: 'small',
    widgetVisible: true,
    wallpaper: { ...WALLPAPER_DEFAULTS },
    widgetCustom: { ...WIDGET_CUSTOM_DEFAULTS }
  };
  ui.wallpaper = { ...WALLPAPER_DEFAULTS };
  ui.widgetCustom = { ...WIDGET_CUSTOM_DEFAULTS };
  ui.widgetSize = 'small';
  // 先落到本地数据，再刷界面：syncAppearanceUI 里的开关读的是 ui.data.settings
  if (ui.data?.settings) Object.assign(ui.data.settings, settings);
  applyAppearance({ ...(ui.data?.settings || {}), ...settings });
  renderSidebar();
  try {
    await window.api.updateSettings(settings);
    showToastMessage('外观已恢复默认。', 'success');
  } catch (error) {
    showToastMessage(error.message || '没有恢复成功', 'error');
  }
}

function autoGrow(element, maxHeight) {
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
}

function syncDateField(input) {
  if (!input) return;
  const hasValue = Boolean(input.value);
  input.classList.toggle('has-value', hasValue);
  input.closest('.date-field')?.classList.toggle('has-value', hasValue);
  const display = input.parentElement?.querySelector('.date-display');
  if (display) display.textContent = input.value ? formatShortDate(input.value) : '';
}

function syncComposerCategory() {
  for (const button of $$('[data-composer-cat]')) {
    button.classList.toggle('active', button.dataset.composerCat === ui.composerCategory);
  }
}

function viewLabel(view = ui.view) {
  if (view === 'active') return '进行中';
  if (view === 'done') return '已完成';
  return '全部任务';
}

function filteredTasks() {
  if (!ui.data) return [];
  let tasks = [...ui.data.tasks];

  if (ui.view === 'active') tasks = tasks.filter((task) => task.status === 'active');
  if (ui.view === 'done') tasks = tasks.filter((task) => task.status === 'done');
  if (ui.category) tasks = tasks.filter((task) => task.category === ui.category);
  if (ui.search) {
    const needle = ui.search.toLowerCase();
    tasks = tasks.filter((task) => {
      const haystack = [
        task.title,
        task.note,
        ...task.milestones.map((item) => item.title)
      ].join('\n').toLowerCase();
      return haystack.includes(needle);
    });
  }

  const sorted = sortTasks(tasks, ui.sort);
  if (ui.view === 'all') {
    sorted.sort((a, b) => {
      if (a.status === b.status) return 0;
      return a.status === 'active' ? -1 : 1;
    });
  }
  return sorted;
}

function ringMarkup(progress, color, extraClass = 'ring-center') {
  const value = Math.max(0, Math.min(100, Math.round(progress)));
  return `${emptyProgressRingSVG(value, color)}<div class="${extraClass}">${value}<small>%</small></div>`;
}

function renderSidebar() {
  if (!ui.data) return;
  const tasks = ui.data.tasks;
  els.allCount.textContent = String(tasks.length);
  els.activeCount.textContent = String(tasks.filter((task) => task.status === 'active').length);
  els.doneCount.textContent = String(tasks.filter((task) => task.status === 'done').length);

  for (const button of $$('[data-view]')) {
    button.classList.toggle('active', button.dataset.view === ui.view);
    button.setAttribute('aria-current', button.dataset.view === ui.view ? 'page' : 'false');
  }

  for (const button of $$('[data-category]')) {
    button.classList.toggle('active', button.dataset.category === ui.category);
    const count = tasks.filter((task) => task.category === button.dataset.category).length;
    const countNode = $(`[data-cat-count="${button.dataset.category}"]`);
    if (countNode) countNode.textContent = String(count);
  }

  for (const button of $$('[data-theme-set]')) {
    button.classList.toggle('active', button.dataset.themeSet === (ui.data.settings.theme || 'light'));
  }
}

function renderHero() {
  if (!ui.data) return;
  const tasks = ui.data.tasks;
  const active = tasks.filter((task) => task.status === 'active');
  const progress = overallProgress(tasks);
  const nodes = milestoneStats(tasks);
  const dueToday = active.filter((task) => task.dueDate === todayKey()).length;
  const completedWeek = completedThisWeek(tasks);

  els.dateLine.textContent = formatHeaderDate(new Date());
  els.heroGreeting.textContent = greeting(new Date());
  els.overallRing.innerHTML = ringMarkup(progress, 'var(--accent)');
  els.overallLabel.textContent = active.length
    ? `${active.length} 件事在路上`
    : tasks.length
      ? '都完成了，歇一会儿'
      : '空白也很好';

  const parts = [];
  if (active.length) parts.push(`<strong>${active.length}</strong> 件事正在推进`);
  if (dueToday) parts.push(`<strong>${dueToday}</strong> 件今天到期`);
  if (nodes.total) parts.push(`<strong>${nodes.done}</strong> / ${nodes.total} 个节点完成`);
  if (completedWeek) parts.push(`本周完成 <strong>${completedWeek}</strong> 件`);
  if (!parts.length) parts.push('把模糊的想法拆成下一小步。');
  els.heroSub.innerHTML = parts.join(' <span style="color:var(--faint)">·</span> ');
}

function emptyStateMarkup() {
  const hasAnyTask = ui.data.tasks.length > 0;

  if (!hasAnyTask) {
    return `
      <div class="empty-state">
        <div class="empty-graphic"><span class="core">${icon('target', 22)}</span></div>
        <div class="empty-title">先写下一件事</div>
        <p class="empty-copy">不用想得很完整。写下一个模糊的念头，再为它拆出第一步，事情就会开始变清楚。</p>
        <button class="empty-btn" type="button" data-action="focus-composer">写下一件事 ${icon('plus', 13)}</button>
      </div>
    `;
  }

  if (ui.search) {
    return `
      <div class="empty-state">
        <div class="empty-graphic"><span class="core">${icon('search', 21)}</span></div>
        <div class="empty-title">没有找到这件事</div>
        <p class="empty-copy">换一个关键词试试，或者清空搜索，看看所有的任务。</p>
        <button class="empty-btn" type="button" data-action="clear-search">清空搜索</button>
      </div>
    `;
  }

  if (ui.view === 'done') {
    return `
      <div class="empty-state">
        <div class="empty-graphic"><span class="core">${icon('check', 22)}</span></div>
        <div class="empty-title">还没有完成的事</div>
        <p class="empty-copy">完成不一定要很大。推进一个节点，也算向前走了一步。</p>
        <button class="empty-btn" type="button" data-action="show-active">看看进行中的事 ${icon('arrow', 13)}</button>
      </div>
    `;
  }

  if (ui.view === 'active') {
    return `
      <div class="empty-state">
        <div class="empty-graphic"><span class="core">${icon('spark', 21)}</span></div>
        <div class="empty-title">进行中的事先空一格</div>
        <p class="empty-copy">手头没有在推进的事。可以写下新的，也可以去已完成里回头看看。</p>
        <button class="empty-btn" type="button" data-action="focus-composer">写下一件事 ${icon('plus', 13)}</button>
      </div>
    `;
  }

  return `
    <div class="empty-state">
      <div class="empty-graphic"><span class="core">${icon('layers', 21)}</span></div>
      <div class="empty-title">这个分类还没有任务</div>
      <p class="empty-copy">要么换一个分类，要么就在这里写下第一件事。</p>
      <button class="empty-btn" type="button" data-action="focus-composer">写下一件事 ${icon('plus', 13)}</button>
    </div>
  `;
}

function taskCardMarkup(task) {
  const cat = categoryOf(ui.data.categories, task.category);
  const progress = progressOf(task);
  const next = nextMilestone(task);
  const done = task.status === 'done';
  const due = dueInfo(task.dueDate);
  const nodeDone = task.milestones.filter((item) => item.done).length;
  const note = task.note ? escapeHTML(task.note).replace(/\s+/g, ' ').slice(0, 100) : '';
  const isNew = !seenTaskIds.has(task.id);

  let nextMarkup = '';
  if (done) {
    nextMarkup = `
      <div class="card-next done-next">
        <span class="node-circle" style="background:var(--sage);border-color:var(--sage);color:#fffdf8">${icon('check', 8)}</span>
        <span class="next-label">完成</span>
        <span class="next-title">${escapeHTML(completedLabel(task.completedAt))}</span>
      </div>
    `;
  } else if (next) {
    const nextDue = dueInfo(next.dueDate);
    nextMarkup = `
      <button class="card-next" type="button" data-action="toggle-node" data-id="${escapeHTML(task.id)}" data-node-id="${escapeHTML(next.id)}" title="完成这个节点">
        <span class="node-circle">${icon('check', 8)}</span>
        <span class="next-label">下一节点</span>
        <span class="next-title">${escapeHTML(next.title)}</span>
        ${nextDue ? `<span class="card-due ${escapeHTML(nextDue.tone)}">${escapeHTML(nextDue.label)}</span>` : ''}
      </button>
    `;
  } else if (task.milestones.length) {
    nextMarkup = `
      <div class="card-next done-next">
        <span class="node-circle" style="background:var(--sage);border-color:var(--sage);color:#fffdf8">${icon('check', 8)}</span>
        <span class="next-label">节点</span>
        <span class="next-title">所有节点都完成了，可以收尾</span>
      </div>
    `;
  } else {
    nextMarkup = `
      <button class="card-next" type="button" data-action="open-task" data-task-id="${escapeHTML(task.id)}" title="添加节点">
        <span class="node-circle" style="border-style:dashed">${icon('plus', 8)}</span>
        <span class="next-label">下一步</span>
        <span class="next-title placeholder">拆出一个能马上开始的小节点</span>
        <span class="next-add">＋</span>
      </button>
    `;
  }

  return `
    <article
      class="task-card ${done ? 'done' : ''} ${isNew ? 'is-entering' : ''}"
      data-task-id="${escapeHTML(task.id)}"
      data-action="open-task"
      tabindex="0"
      role="button"
      aria-label="打开任务：${escapeHTML(task.title)}"
      style="--cat-color:${cat.color};--cat-tint:${hexToRgba(cat.color, 0.12)}"
    >
      <div class="card-top">
        <button class="task-check" type="button" data-action="toggle-done" data-id="${escapeHTML(task.id)}" title="${done ? '重新打开' : '标记完成'}" aria-label="${done ? '重新打开' : '标记完成'}">
          ${icon('check', 11)}
        </button>
        <span class="cat-tag"><span class="dot"></span>${escapeHTML(cat.name)}</span>
        <span class="card-arrow">${icon('arrowUpRight', 13)}</span>
      </div>
      <h3 class="card-title">${escapeHTML(task.title)}</h3>
      ${note ? `<p class="card-note">${note}</p>` : ''}
      <div class="card-progress">
        <span class="progress-num">${progress}<small>%</small></span>
        <span class="progress-bar"><span style="width:${progress}%"></span></span>
      </div>
      ${nextMarkup}
      <div class="card-meta">
        <span class="meta-item">${icon('layers', 10)} ${nodeDone}/${task.milestones.length} 节点</span>
        <span class="spacer"></span>
        ${due ? `<span class="card-due ${escapeHTML(due.tone)}">${icon('calendar', 10)} ${escapeHTML(due.label)}</span>` : `<span class="card-due">${escapeHTML(relativeTime(task.updatedAt))}更新</span>`}
      </div>
    </article>
  `;
}

function renderList() {
  if (!ui.data) return;
  const tasks = filteredTasks();
  const cat = ui.category ? categoryOf(ui.data.categories, ui.category) : null;

  let title = viewLabel();
  if (cat) title = ui.view === 'all' ? cat.name : `${cat.name} · ${viewLabel()}`;
  if (ui.search) title = `搜索「${ui.search.length > 16 ? `${ui.search.slice(0, 16)}…` : ui.search}」`;
  els.listTitle.textContent = title;
  els.listCount.textContent = String(tasks.length);

  if (!tasks.length) {
    els.taskGrid.innerHTML = emptyStateMarkup();
  } else {
    els.taskGrid.innerHTML = tasks.map(taskCardMarkup).join('');
  }

  for (const task of tasks) seenTaskIds.add(task.id);
}

function renderComposer() {
  syncComposerCategory();
  els.sortSelect.value = ui.sort;
}

function renderAll() {
  applyAppearance(ui.data?.settings);
  renderSidebar();
  renderHero();
  renderComposer();
  renderList();
  if (ui.drawerOpen) renderDetail();
}

function setDrawerOpen(open) {
  ui.drawerOpen = open;
  els.drawerRoot.classList.toggle('is-open', open);
  els.drawerRoot.setAttribute('aria-hidden', String(!open));
  if (!open) {
    ui.selectedId = null;
    ui.isSliding = false;
    document.body.style.overflow = '';
  }
}

function openDetail(taskId, resetScroll = true) {
  const task = getTask(taskId);
  if (!task) return;
  ui.selectedId = task.id;
  ui.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  ui.drawerOpen = true;
  els.drawerRoot.classList.add('is-open');
  els.drawerRoot.setAttribute('aria-hidden', 'false');
  renderDetail();
  if (resetScroll) $('.drawer-body').scrollTop = 0;
}

function closeDetail() {
  if (!ui.drawerOpen) return;
  setDrawerOpen(false);
  if (ui.lastFocus && document.contains(ui.lastFocus)) {
    try {
      ui.lastFocus.focus({ preventScroll: true });
    } catch {
      // Focus is a convenience here, not a requirement.
    }
  }
}

function updateRing(element, progress, color) {
  if (!element) return;
  element.innerHTML = ringMarkup(progress, color);
}

function renderNodes(task) {
  const count = task.milestones.filter((item) => item.done).length;
  els.nodeCount.textContent = `${count} / ${task.milestones.length}`;

  if (!task.milestones.length) {
    els.nodeList.innerHTML = `
      <div class="node-empty">
        <span>还没有节点。</span>
        <span>加一个能马上开始的小步骤，事情会清楚很多。</span>
      </div>
    `;
    return;
  }

  els.nodeList.innerHTML = task.milestones.map((milestone) => {
    const due = dueInfo(milestone.dueDate);
    const dueTone = due && due.tone === 'overdue' && !milestone.done ? 'overdue' : '';
    const sub = milestone.done
      ? `<span>${escapeHTML(completedLabel(milestone.doneAt))}</span>`
      : due
        ? `<span class="${dueTone}">${escapeHTML(due.label)}</span>`
        : '';
    return `
      <div class="node-item ${milestone.done ? 'done' : ''}">
        <button class="node-toggle" type="button" data-action="toggle-node" data-id="${escapeHTML(task.id)}" data-node-id="${escapeHTML(milestone.id)}" aria-label="${milestone.done ? '取消完成' : '完成节点'}">
          ${icon('check', 10)}
        </button>
        <div class="node-main">
          <div class="node-title">${escapeHTML(milestone.title)}</div>
          ${sub ? `<div class="node-sub">${sub}</div>` : ''}
        </div>
        <button class="node-delete" type="button" data-action="delete-node" data-id="${escapeHTML(task.id)}" data-node-id="${escapeHTML(milestone.id)}" title="删除节点" aria-label="删除节点">
          ${icon('trash', 13)}
        </button>
      </div>
    `;
  }).join('');
}

function renderDetail() {
  const task = getTask();
  if (!task) {
    closeDetail();
    return;
  }

  const cat = categoryOf(ui.data.categories, task.category);
  const progress = progressOf(task);
  const doneCount = task.milestones.filter((item) => item.done).length;

  if (document.activeElement !== els.detailTitle) {
    els.detailTitle.value = task.title;
  }
  autoGrow(els.detailTitle, 190);

  if (document.activeElement !== els.detailNote) {
    els.detailNote.value = task.note;
  }
  autoGrow(els.detailNote, 190);

  els.detailCategory.value = task.category;
  els.drawerCatDot.style.background = cat.color;
  els.detailDue.value = task.dueDate || '';
  syncDateField(els.detailDue);
  els.detailCreated.textContent = formatShortDate(task.createdAt);

  updateRing(els.detailRingWrap, progress, cat.color);
  const autoHidden = task.milestones.length === 0;
  els.autoRow.style.display = autoHidden ? 'none' : 'flex';
  els.autoProgress.checked = Boolean(task.autoProgress) && task.milestones.length > 0;
  els.autoProgress.disabled = task.status === 'done';
  els.progressSlider.disabled = task.status === 'done';
  if (!ui.isSliding && document.activeElement !== els.progressSlider) {
    els.progressSlider.value = String(progress);
  }
  els.progressSlider.style.setProperty('--range', `${progress}%`);

  if (task.status === 'done') {
    els.progressHint.textContent = `已${completedLabel(task.completedAt)}，做得不错。`;
  } else if (task.autoProgress && task.milestones.length) {
    els.progressHint.textContent = `完成 ${doneCount} / ${task.milestones.length} 个节点，进度自动计算。`;
  } else if (task.milestones.length) {
    els.progressHint.textContent = '拖动滑块调整，或打开按节点自动计算。';
  } else {
    els.progressHint.textContent = '先添加节点，或手动拖动进度。';
  }

  els.detailStatusChip.textContent = task.status === 'done' ? '已完成' : '进行中';
  els.detailStatusChip.style.color = task.status === 'done' ? 'var(--sage)' : 'var(--muted)';

  els.completeBtn.className = task.status === 'done' ? 'btn btn-soft' : 'btn btn-sage';
  els.completeBtn.innerHTML = task.status === 'done'
    ? `${icon('check', 14)}<span>重新打开</span>`
    : `${icon('check', 14)}<span>标记完成</span>`;

  els.nodeForm.style.opacity = task.status === 'done' ? '0.5' : '1';
  els.nodeInput.disabled = task.status === 'done';
  els.nodeDue.disabled = task.status === 'done';
  $('.node-add', els.nodeForm).disabled = task.status === 'done';

  renderNodes(task);
}

function setView(view) {
  ui.view = view;
  if (view === 'all') ui.category = null;
  renderSidebar();
  renderList();
}

function setCategory(category) {
  ui.category = category;
  renderSidebar();
  renderList();
}

function focusComposer() {
  els.composerInput.focus();
  els.composerInput.select();
}

function clearSearch() {
  ui.search = '';
  els.globalSearch.value = '';
  renderList();
}

function showToastMessage(message, tone = 'normal') {
  showToast(els.toastRoot, message, tone);
}

async function createTaskFromComposer() {
  const title = els.composerInput.value.trim();
  if (!title) {
    showToastMessage('先写下这件事，再按添加', 'error');
    els.composerInput.focus();
    return;
  }
  if (ui.composerBusy) return;
  ui.composerBusy = true;
  const submit = $('.composer-submit', els.composer);
  submit.disabled = true;
  try {
    const result = await window.api.createTask({
      title,
      category: ui.composerCategory,
      dueDate: els.composerDue.value || null
    });
    els.composerInput.value = '';
    els.composerDue.value = '';
    syncDateField(els.composerDue);
    if (ui.view === 'done') ui.view = 'active';
    if (ui.category && ui.category !== ui.composerCategory) ui.category = null;
    if (ui.search) clearSearch();
    renderSidebar();
    if (result?.state) {
      ui.data = result.state;
      renderAll();
    }
    showToastMessage('已加入。点开卡片，拆出下一步。', 'success');
    els.composerInput.focus();
  } catch (error) {
    showToastMessage(error.message || '没有添加成功', 'error');
  } finally {
    ui.composerBusy = false;
    submit.disabled = false;
  }
}

const saveTitle = debounce(async () => {
  const id = ui.selectedId;
  const task = getTask(id);
  if (!task) return;
  const value = els.detailTitle.value.trim();
  if (!value || value === task.title) return;
  try {
    await window.api.updateTask(id, { title: value });
  } catch (error) {
    showToastMessage(error.message || '标题没有保存', 'error');
  }
}, 500);

const saveNote = debounce(async () => {
  const id = ui.selectedId;
  const task = getTask(id);
  if (!task) return;
  const value = els.detailNote.value;
  if (value === task.note) return;
  try {
    await window.api.updateTask(id, { note: value });
  } catch (error) {
    showToastMessage(error.message || '备注没有保存', 'error');
  }
}, 550);

function openDeleteModal() {
  const task = getTask();
  if (!task) return;
  ui.pendingDeleteId = task.id;
  ui.modalOpen = true;
  els.modalCopy.textContent = `「${task.title}」和它的所有节点都会被删除，无法恢复。`;
  els.modalRoot.classList.add('is-open');
  els.modalRoot.setAttribute('aria-hidden', 'false');
  els.confirmDeleteBtn.disabled = false;
}

function closeDeleteModal() {
  ui.modalOpen = false;
  ui.pendingDeleteId = null;
  els.modalRoot.classList.remove('is-open');
  els.modalRoot.setAttribute('aria-hidden', 'true');
}

function handleKeydown(event) {
  const target = event.target;
  const inField = target instanceof HTMLElement
    && (target.matches('input, textarea, select') || target.isContentEditable);

  if (event.key === 'Escape') {
    if (ui.modalOpen) {
      closeDeleteModal();
      return;
    }
    if (ui.appearanceOpen) {
      closeAppearance();
      return;
    }
    if (ui.drawerOpen) {
      saveTitle.flush();
      saveNote.flush();
      closeDetail();
      return;
    }
    if (ui.search) {
      clearSearch();
      return;
    }
  }

  /* 字号快捷键：Ctrl + / Ctrl - / Ctrl 0（也接受 = 与数字小键盘） */
  if (event.ctrlKey || event.metaKey) {
    const key = event.key;
    if (key === '+' || key === '=') {
      event.preventDefault();
      stepFontScale(1);
      return;
    }
    if (key === '-' || key === '_') {
      event.preventDefault();
      stepFontScale(-1);
      return;
    }
    if (key === '0') {
      event.preventDefault();
      resetFontScale();
      return;
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    els.globalSearch.focus();
    els.globalSearch.select();
    return;
  }

  if (!inField && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    focusComposer();
  }
}

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const themeButton = event.target.closest('[data-theme-set]');
    if (themeButton) {
      await setTheme(themeButton.dataset.themeSet);
      return;
    }

    const accentButton = event.target.closest('[data-accent-set]');
    if (accentButton) {
      await setAccent(accentButton.dataset.accentSet);
      return;
    }

    const widgetStyleButton = event.target.closest('[data-widget-style]');
    if (widgetStyleButton) {
      await setWidgetStyle(widgetStyleButton.dataset.widgetStyle);
      return;
    }

    const widgetSizeButton = event.target.closest('[data-widget-size]');
    if (widgetSizeButton) {
      await setWidgetSize(widgetSizeButton.dataset.widgetSize);
      return;
    }

    const wallpaperKindButton = event.target.closest('[data-wallpaper-kind]');
    if (wallpaperKindButton) {
      const kind = wallpaperKindButton.dataset.wallpaperKind;
      if (kind === 'none') {
        patchWallpaper({ kind: 'none' });
      } else if (kind === 'preset') {
        patchWallpaper({ kind: 'preset', preset: ui.wallpaper.preset || 'sunrise' });
      } else if (ui.wallpaper.file) {
        patchWallpaper({ kind: 'image', file: ui.wallpaper.file });
      } else {
        await chooseWallpaper();
      }
      return;
    }

    const presetButton = event.target.closest('[data-wallpaper-preset]');
    if (presetButton) {
      patchWallpaper({ kind: 'preset', preset: presetButton.dataset.wallpaperPreset });
      return;
    }

    const widgetFitButton = event.target.closest('[data-widget-fit]');
    if (widgetFitButton) {
      patchWidgetCustom({ fit: widgetFitButton.dataset.widgetFit });
      return;
    }

    const composerCategory = event.target.closest('[data-composer-cat]');
    if (composerCategory) {
      ui.composerCategory = composerCategory.dataset.composerCat;
      syncComposerCategory();
      try {
        await window.api.updateSettings({ composerCategory: ui.composerCategory });
      } catch {
        // The selection still works for this session.
      }
      return;
    }

    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      setView(viewButton.dataset.view);
      return;
    }

    const categoryButton = event.target.closest('[data-category]');
    if (categoryButton) {
      const next = categoryButton.dataset.category;
      setCategory(ui.category === next ? null : next);
      return;
    }

    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;

    if (action === 'open-appearance') {
      setAppearanceOpen(true);
      return;
    }

    if (action === 'close-appearance') {
      closeAppearance();
      return;
    }

    if (action === 'font-inc') {
      stepFontScale(1);
      return;
    }

    if (action === 'font-dec') {
      stepFontScale(-1);
      return;
    }

    if (action === 'font-reset') {
      resetFontScale();
      return;
    }

    if (action === 'font-preset') {
      setFontScale(Number(actionTarget.dataset.scale));
      return;
    }

    if (action === 'pick-wallpaper') {
      await chooseWallpaper();
      return;
    }

    if (action === 'clear-wallpaper') {
      await removeWallpaper();
      return;
    }

    if (action === 'reset-appearance') {
      await resetAppearance();
      return;
    }

    if (action === 'open-task') {
      const id = actionTarget.dataset.taskId
        || actionTarget.closest('[data-task-id]')?.dataset.taskId;
      if (id) openDetail(id);
      return;
    }

    if (action === 'close-drawer') {
      saveTitle.flush();
      saveNote.flush();
      closeDetail();
      return;
    }

    if (action === 'focus-composer') {
      focusComposer();
      return;
    }

    if (action === 'clear-search') {
      clearSearch();
      els.globalSearch.focus();
      return;
    }

    if (action === 'show-active') {
      setView('active');
      return;
    }

    if (action === 'toggle-done') {
      const id = actionTarget.dataset.id;
      if (!id) return;
      const before = getTask(id);
      try {
        await window.api.toggleTaskDone(id);
        if (before?.status === 'active') showToastMessage('完成了。可以歇一口气。', 'success');
        else showToastMessage('已重新打开。');
      } catch (error) {
        showToastMessage(error.message || '没有更新状态', 'error');
      }
      return;
    }

    if (action === 'toggle-node') {
      const id = actionTarget.dataset.id;
      const nodeId = actionTarget.dataset.nodeId;
      if (!id || !nodeId) return;
      try {
        await window.api.toggleMilestone(id, nodeId);
      } catch (error) {
        showToastMessage(error.message || '节点没有更新', 'error');
      }
      return;
    }

    if (action === 'delete-node') {
      const id = actionTarget.dataset.id;
      const nodeId = actionTarget.dataset.nodeId;
      if (!id || !nodeId) return;
      try {
        await window.api.deleteMilestone(id, nodeId);
        showToastMessage('节点已删除。');
      } catch (error) {
        showToastMessage(error.message || '节点没有删除', 'error');
      }
      return;
    }

    if (action === 'close-modal') {
      closeDeleteModal();
      return;
    }
  });

  els.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    createTaskFromComposer();
  });

  els.globalSearch.addEventListener('input', () => {
    ui.search = els.globalSearch.value.trim();
    renderList();
  });

  els.sortSelect.addEventListener('change', async () => {
    ui.sort = els.sortSelect.value;
    renderList();
    try {
      await window.api.updateSettings({ sort: ui.sort });
    } catch {
      // Sorting still applies for this session.
    }
  });

  els.detailTitle.addEventListener('input', () => {
    autoGrow(els.detailTitle, 190);
    saveTitle();
  });

  els.detailTitle.addEventListener('blur', () => {
    if (!els.detailTitle.value.trim()) {
      const task = getTask();
      if (task) {
        els.detailTitle.value = task.title;
        autoGrow(els.detailTitle, 190);
      }
      return;
    }
    saveTitle.flush();
  });

  els.detailNote.addEventListener('input', () => {
    autoGrow(els.detailNote, 190);
    saveNote();
  });

  els.detailNote.addEventListener('blur', () => saveNote.flush());

  els.detailCategory.addEventListener('change', async () => {
    const task = getTask();
    if (!task) return;
    try {
      await window.api.updateTask(task.id, { category: els.detailCategory.value });
    } catch (error) {
      showToastMessage(error.message || '分类没有更新', 'error');
    }
  });

  els.detailDue.addEventListener('change', async () => {
    syncDateField(els.detailDue);
    const task = getTask();
    if (!task) return;
    try {
      await window.api.updateTask(task.id, { dueDate: els.detailDue.value || null });
    } catch (error) {
      showToastMessage(error.message || '日期没有保存', 'error');
    }
  });

  for (const input of [els.composerDue, els.nodeDue]) {
    input.addEventListener('input', () => syncDateField(input));
    input.addEventListener('change', () => syncDateField(input));
  }

  els.autoProgress.addEventListener('change', async () => {
    const task = getTask();
    if (!task) return;
    try {
      await window.api.updateTask(task.id, { autoProgress: els.autoProgress.checked });
      if (els.autoProgress.checked) showToastMessage('已改为按节点自动计算。');
    } catch (error) {
      showToastMessage(error.message || '没有更新计算方式', 'error');
    }
  });

  els.progressSlider.addEventListener('input', () => {
    const task = getTask();
    if (!task) return;
    ui.isSliding = true;
    const value = Number(els.progressSlider.value);
    els.progressSlider.style.setProperty('--range', `${value}%`);
    updateRing(
      els.detailRingWrap,
      value,
      categoryOf(ui.data.categories, task.category).color
    );
    els.progressHint.textContent = `手动设置为 ${value}%`;
  });

  els.progressSlider.addEventListener('change', async () => {
    const task = getTask();
    if (!task) return;
    const value = Number(els.progressSlider.value);
    try {
      await window.api.updateTask(task.id, { progress: value });
      showToastMessage('完成度已更新。');
    } catch (error) {
      showToastMessage(error.message || '完成度没有保存', 'error');
    } finally {
      ui.isSliding = false;
    }
  });

  els.nodeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const task = getTask();
    if (!task) return;
    if (task.status === 'done') {
      showToastMessage('重新打开这件事后，才能添加节点', 'error');
      return;
    }
    const title = els.nodeInput.value.trim();
    if (!title) {
      els.nodeInput.focus();
      return;
    }
    try {
      await window.api.addMilestone(task.id, {
        title,
        dueDate: els.nodeDue.value || null
      });
      els.nodeInput.value = '';
      els.nodeDue.value = '';
      syncDateField(els.nodeDue);
      els.nodeInput.focus();
    } catch (error) {
      showToastMessage(error.message || '节点没有添加', 'error');
    }
  });

  els.completeBtn.addEventListener('click', async () => {
    const task = getTask();
    if (!task) return;
    try {
      await window.api.toggleTaskDone(task.id);
      showToastMessage(task.status === 'active' ? '完成了。可以歇一口气。' : '已重新打开。', 'success');
    } catch (error) {
      showToastMessage(error.message || '没有更新状态', 'error');
    }
  });

  els.deleteBtn.addEventListener('click', openDeleteModal);

  els.confirmDeleteBtn.addEventListener('click', async () => {
    const id = ui.pendingDeleteId;
    if (!id) return;
    els.confirmDeleteBtn.disabled = true;
    try {
      await window.api.deleteTask(id);
      closeDeleteModal();
      closeDetail();
      showToastMessage('这件事已删除。');
    } catch (error) {
      els.confirmDeleteBtn.disabled = false;
      showToastMessage(error.message || '没有删除成功', 'error');
    }
  });

  els.modalRoot.addEventListener('click', (event) => {
    if (event.target === els.modalRoot) closeDeleteModal();
  });

  $('#minimizeBtn').addEventListener('click', () => window.api.minimizeMain());
  $('#closeBtn').addEventListener('click', () => window.api.closeMain());
  els.maximizeBtn.addEventListener('click', () => window.api.toggleMaximize());

  $('#newTaskBtn').addEventListener('click', focusComposer);
  $('#openWidgetBtn').addEventListener('click', () => window.api.openWidget());
  $('#openDataBtn').addEventListener('click', () => window.api.openDataFolder());
  $('#clearCategoryBtn').addEventListener('click', () => setCategory(null));

  document.addEventListener('keydown', handleKeydown);

  /* ---------------- 外观面板控件 ---------------- */

  if (els.fontScaleRange) {
    els.fontScaleRange.addEventListener('input', () => {
      // 拖动时立刻生效，落盘由 debounce 负责
      setFontScale(Number(els.fontScaleRange.value));
    });
  }

  if (els.wallpaperDimRange) {
    els.wallpaperDimRange.addEventListener('input', () => {
      patchWallpaper({ dim: clampNumber(els.wallpaperDimRange.value, 0, 0.8, 0.18) });
    });
  }

  if (els.wallpaperBlurRange) {
    els.wallpaperBlurRange.addEventListener('input', () => {
      patchWallpaper({ blur: clampNumber(els.wallpaperBlurRange.value, 0, 24, 0) });
    });
  }

  if (els.wallpaperOnMain) {
    els.wallpaperOnMain.addEventListener('change', () => {
      patchWallpaper({ onMain: els.wallpaperOnMain.checked });
    });
  }

  if (els.widgetPinnedSwitch) {
    els.widgetPinnedSwitch.addEventListener('change', async () => {
      const pinned = els.widgetPinnedSwitch.checked;
      try {
        await window.api.updateSettings({ widgetPinned: pinned });
        if (ui.data?.settings) ui.data.settings.widgetPinned = pinned;
        showToastMessage(
          pinned ? '会一直停在其他窗口上方。' : '已关掉置顶：被别的软件挡住时，按 Alt + Shift + D 叫回来。',
          pinned ? 'success' : 'normal'
        );
      } catch (error) {
        els.widgetPinnedSwitch.checked = !pinned;
        showToastMessage(error.message || '没有保存', 'error');
      }
    });
  }

  if (els.widgetVisibleSwitch) {
    els.widgetVisibleSwitch.addEventListener('change', async () => {
      const visible = els.widgetVisibleSwitch.checked;
      try {
        await window.api.updateSettings({ widgetVisible: visible });
        if (ui.data?.settings) ui.data.settings.widgetVisible = visible;
        showToastMessage(
          visible ? '球又回到桌面上了。' : '桌面上的球收起来了，工作台照常用。',
          visible ? 'success' : 'normal'
        );
      } catch (error) {
        els.widgetVisibleSwitch.checked = !visible;
        showToastMessage(error.message || '没有保存', 'error');
      }
    });
  }

  /* 自定义图片区：选图 / 移除 / 压暗 / 显示文字（契合方式走上面的点击委托） */
  if (els.widgetCustomPickBtn) {
    els.widgetCustomPickBtn.addEventListener('click', () => {
      chooseWidgetCustom();
    });
  }

  if (els.widgetCustomClearBtn) {
    els.widgetCustomClearBtn.addEventListener('click', () => {
      removeWidgetCustom();
    });
  }

  if (els.widgetCustomDimRange) {
    els.widgetCustomDimRange.addEventListener('input', () => {
      // 滑块是 0–60 的百分数，落到设置里是 0–0.6
      const percent = clampNumber(
        els.widgetCustomDimRange.value,
        WIDGET_CUSTOM_DIM_MIN * 100,
        WIDGET_CUSTOM_DIM_MAX * 100,
        WIDGET_CUSTOM_DEFAULTS.dim * 100
      );
      patchWidgetCustom({ dim: Math.round(percent) / 100 });
    });
  }

  if (els.widgetCustomShowText) {
    els.widgetCustomShowText.addEventListener('change', () => {
      patchWidgetCustom({ showText: els.widgetCustomShowText.checked });
    });
  }

  if (els.appearanceRoot) {
    els.appearanceRoot.addEventListener('click', (event) => {
      if (event.target === els.appearanceRoot) closeAppearance();
    });
  }

  window.addEventListener('beforeunload', flushAppearanceNow);

  els.taskGrid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.task-card');
    if (!card || event.target !== card) return;
    event.preventDefault();
    openDetail(card.dataset.taskId);
  });

  window.api.onState((state) => {
    const firstState = !ui.data;
    const wasOpen = ui.drawerOpen;
    ui.data = state;
    if (firstState) {
      ui.sort = state.settings.sort || 'manual';
      ui.composerCategory = state.settings.composerCategory || 'life';
    }
    if (wasOpen && ui.selectedId && !getTask(ui.selectedId)) {
      setDrawerOpen(false);
    }
    // 用 Alt + Shift + D 或托盘切换过浮球之后，开关要跟着宿主的推送走
    if (els.widgetVisibleSwitch) {
      els.widgetVisibleSwitch.checked = state.settings?.widgetVisible !== false;
    }
    renderAll();
  });

  window.api.onFocusTask((taskId) => {
    if (!taskId) return;
    if (ui.view === 'done') ui.view = 'active';
    if (ui.search) clearSearch();
    const task = getTask(taskId);
    if (task) {
      ui.category = null;
      renderSidebar();
      renderList();
      openDetail(taskId);
    }
  });

  window.api.onMaximized((maximized) => {
    els.maximizeBtn.innerHTML = icon(maximized ? 'restore' : 'maximize', 14);
    els.maximizeBtn.title = maximized ? '还原' : '最大化';
    els.maximizeBtn.setAttribute('aria-label', maximized ? '还原' : '最大化');
  });
}

async function init() {
  bindEvents();
  try {
    const result = await window.api.getState();
    ui.data = result.state;
    info = result.info;
    ui.sort = result.state.settings.sort || 'manual';
    ui.composerCategory = result.state.settings.composerCategory || 'life';
    syncDateField(els.composerDue);
    syncDateField(els.nodeDue);
    applyAppearance(result.state.settings);
    renderAll();

    if (result.focusTaskId) {
      const task = getTask(result.focusTaskId);
      if (task) {
        ui.category = null;
        if (ui.view === 'done' && task.status !== 'done') ui.view = 'active';
        renderSidebar();
        renderList();
        openDetail(task.id);
      }
    }

    if (info?.version) {
      $('#openDataBtn').title = `数据保存在：${info.dataPath}`;
    }

    installWindowResizing();
  } catch (error) {
    showToastMessage(error.message || '读取数据失败', 'error');
  }
}

/* ---------------- 窗口边缘缩放 ----------------
 * 窗口是无边框的（FormBorderStyle.None），系统不再提供缩放边框；
 * WebView2 又会吃掉原生边缘消息，所以缩放手势在这里接管：
 * 鼠标靠近窗口边缘就换光标，按住拖动时按帧把位移发给宿主。
 */

const RESIZE_EDGE = {
  left: 10,
  right: 11,
  top: 12,
  topLeft: 13,
  topRight: 14,
  bottom: 15,
  bottomLeft: 16,
  bottomRight: 17
};

const RESIZE_HOT_ZONE = 8; // CSS px
const RESIZE_CURSORS = {
  [RESIZE_EDGE.left]: 'ew-resize',
  [RESIZE_EDGE.right]: 'ew-resize',
  [RESIZE_EDGE.top]: 'ns-resize',
  [RESIZE_EDGE.bottom]: 'ns-resize',
  [RESIZE_EDGE.topLeft]: 'nwse-resize',
  [RESIZE_EDGE.bottomRight]: 'nwse-resize',
  [RESIZE_EDGE.topRight]: 'nesw-resize',
  [RESIZE_EDGE.bottomLeft]: 'nesw-resize'
};

function edgeAt(x, y) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const left = x <= RESIZE_HOT_ZONE;
  const right = x >= width - RESIZE_HOT_ZONE;
  const top = y <= RESIZE_HOT_ZONE;
  const bottom = y >= height - RESIZE_HOT_ZONE;

  if (top && left) return RESIZE_EDGE.topLeft;
  if (top && right) return RESIZE_EDGE.topRight;
  if (bottom && left) return RESIZE_EDGE.bottomLeft;
  if (bottom && right) return RESIZE_EDGE.bottomRight;
  if (left) return RESIZE_EDGE.left;
  if (right) return RESIZE_EDGE.right;
  if (top) return RESIZE_EDGE.top;
  if (bottom) return RESIZE_EDGE.bottom;
  return 0;
}

function installWindowResizing() {
  if (!window.api?.resizeStart) return;

  let activeEdge = 0;
  let lastX = 0;
  let lastY = 0;
  let queue = Promise.resolve();

  document.addEventListener(
    'mousemove',
    (event) => {
      if (activeEdge) return;
      const edge = edgeAt(event.clientX, event.clientY);
      // 边缘用行内 cursor 覆盖，离开时清掉还原
      document.body.style.cursor = RESIZE_CURSORS[edge] || '';
    },
    { passive: true }
  );

  document.addEventListener(
    'mousedown',
    (event) => {
      if (event.button !== 0) return;
      const edge = edgeAt(event.clientX, event.clientY);
      if (!edge) return;

      event.preventDefault();
      event.stopPropagation();
      activeEdge = edge;
      lastX = event.screenX;
      lastY = event.screenY;
      queue = queue.then(() => window.api.resizeStart(edge)).catch(() => {});
    },
    true
  );

  window.addEventListener(
    'mousemove',
    (event) => {
      if (!activeEdge) return;
      const dx = event.screenX - lastX;
      const dy = event.screenY - lastY;
      if (!dx && !dy) return;
      lastX = event.screenX;
      lastY = event.screenY;
      queue = queue.then(() => window.api.resizeMove(dx, dy)).catch(() => {});
    },
    true
  );

  window.addEventListener(
    'mouseup',
    () => {
      if (!activeEdge) return;
      activeEdge = 0;
      queue = queue.then(() => window.api.resizeEnd()).catch(() => {});
    },
    true
  );

  // 鼠标离开窗口时把光标还原，避免停在缩放光标上
  document.addEventListener('mouseleave', () => {
    if (!activeEdge) document.body.style.cursor = '';
  });
}

init();

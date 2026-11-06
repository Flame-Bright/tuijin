export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  restore: '<rect x="7" y="7" width="11" height="11" rx="1.5"/><path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h7A1.5 1.5 0 0 1 20 5.5v7A1.5 1.5 0 0 1 18.5 14H17"/>',
  pin: '<path d="M9 4h6l-1 5 3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3-1-5Z"/>',
  pinOff: '<path d="M9 4h6l-1 5 3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3-1-5Z"/><path d="M3 3l18 18"/>',
  expand: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>',
  collapse: '<path d="M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.2A8 8 0 0 1 9.8 4 8.2 8.2 0 1 0 20 14.2Z"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M8 3v5M16 3v5M4 10.5h16"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  note: '<path d="M5 4h14v16H5z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  flag: '<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Z"/>',
  edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z"/><path d="m13.5 7 3.5 3.5"/>'
};

export function icon(name, size = 18, extraClass = '') {
  const inner = ICONS[name] || '';
  return `<svg class="icon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function categoryOf(categories, id) {
  return categories.find((item) => item.id === id) || categories[1] || {
    id: 'life',
    name: '生活',
    color: '#6F8F6B'
  };
}

export function hexToRgba(hex, alpha = 0.12) {
  const value = String(hex || '').replace('#', '');
  const normalized = value.length === 3
    ? value.split('').map((char) => `${char}${char}`).join('')
    : value.padEnd(6, '0').slice(0, 6);
  const number = Number.parseInt(normalized, 16);
  const r = (number >> 16) & 255;
  const g = (number >> 8) & 255;
  const b = number & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function pad(value) {
  return String(value).padStart(2, '0');
}

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatHeaderDate(date = new Date()) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

export function formatFullDate(date = new Date()) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

export function formatShortDate(value, withYear = false) {
  const date = typeof value === 'string' && value.length <= 10 ? parseDateKey(value) : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const year = withYear || date.getFullYear() !== new Date().getFullYear();
  return `${year ? `${date.getFullYear()}年` : ''}${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatShortDate(value)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dueInfo(value) {
  if (!value) return null;
  const due = parseDateKey(value);
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);

  if (diff < 0) {
    return {
      label: diff === -1 ? '昨天到期' : `逾期 ${Math.abs(diff)} 天`,
      tone: 'overdue',
      diff
    };
  }
  if (diff === 0) return { label: '今天到期', tone: 'today', diff };
  if (diff === 1) return { label: '明天到期', tone: 'soon', diff };
  if (diff <= 7) return { label: `${diff} 天后`, tone: 'soon', diff };
  return { label: formatShortDate(value), tone: 'normal', diff };
}

export function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 48 * 60 * 60 * 1000) return '昨天';
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
  return formatShortDate(value);
}

export function completedLabel(value) {
  if (!value) return '已完成';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '已完成';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return '今天完成';
  if (diff === 1) return '昨天完成';
  return `${formatShortDate(date)}完成`;
}

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function progressOf(task) {
  if (task.status === 'done') return 100;
  if (task.autoProgress && task.milestones.length) {
    return Math.round((task.milestones.filter((item) => item.done).length / task.milestones.length) * 100);
  }
  return Math.max(0, Math.min(100, Math.round(task.progress)));
}

export function milestoneStats(tasks) {
  let done = 0;
  let total = 0;
  for (const task of tasks) {
    for (const milestone of task.milestones) {
      total += 1;
      if (milestone.done) done += 1;
    }
  }
  return { done, total };
}

export function nextMilestone(task) {
  if (!task || task.status === 'done') return null;
  return task.milestones.find((item) => !item.done) || null;
}

export function overallProgress(tasks) {
  const active = tasks.filter((item) => item.status === 'active');
  if (!active.length) return tasks.length ? 100 : 0;
  return Math.round(active.reduce((sum, task) => sum + progressOf(task), 0) / active.length);
}

export function completedThisWeek(tasks) {
  const now = new Date();
  const day = now.getDay() || 7;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - day + 1);
  return tasks.filter((task) => {
    if (task.status !== 'done' || !task.completedAt) return false;
    return new Date(task.completedAt) >= start;
  }).length;
}

export function sortTasks(tasks, sort) {
  const copy = [...tasks];
  if (sort === 'due') {
    return copy.sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) || a.order - b.order;
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.order - b.order;
    });
  }
  if (sort === 'progress') {
    return copy.sort((a, b) => progressOf(b) - progressOf(a) || a.order - b.order);
  }
  return copy.sort((a, b) => a.order - b.order);
}

export function debounce(fn, wait = 280) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return wrapped;
}

export function showToast(root, message, tone = 'normal') {
  if (!root) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${tone}`;
  toast.innerHTML = `${icon(tone === 'error' ? 'close' : tone === 'success' ? 'check' : 'spark', 15)}<span>${escapeHTML(message)}</span>`;
  root.append(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 260);
  }, 2400);
}

export function emptyProgressRingSVG(progress, color = '#D96C47') {
  const value = Math.max(0, Math.min(100, Number(progress) || 0));
  const circumference = 2 * Math.PI * 52;
  const offset = circumference * (1 - value / 100);
  return `
    <svg class="progress-ring" viewBox="0 0 120 120" role="img" aria-label="进度 ${value}%">
      <circle class="ring-track" cx="60" cy="60" r="52" />
      <circle class="ring-value" cx="60" cy="60" r="52"
        stroke="${escapeHTML(color)}"
        stroke-dasharray="${circumference.toFixed(2)}"
        stroke-dashoffset="${offset.toFixed(2)}" />
    </svg>
  `;
}

// Todo App — frontend logic.
// Talks to the backend in one of three ways:
//   desktop — window.pywebview.api in the Mac window (see app.py)
//   web     — HTTP /api/<method> when opened in a browser over Wi-Fi
//   phone   — window.SCRIPTABLE bridge inside the Scriptable iPhone app (see phone/mini-todo.js)

const MONTH_NAMES = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];
const MONTH_SHORT = [
  "jan","feb","mar","apr","may","jun",
  "jul","aug","sep","oct","nov","dec",
];

const state = {
  selectedDate: formatDate(new Date()),
  viewMonth: new Date().getMonth(),
  viewYear: new Date().getFullYear(),
  activeTab: "todo",
  activeCategory: null,
  daysWithTasks: {},
  categories: [],
};

// Decided by explicit markers, not the URL: pywebview also serves the desktop
// window over http://127.0.0.1, so the protocol can't tell desktop and web apart.
const MODE = window.SCRIPTABLE ? "phone"
  : window.MINI_TODO_WEB ? "web"
  : "desktop";

// localStorage can be unavailable (e.g. in the Scriptable web view), so never let it throw.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};

const WEB_KEY = new URLSearchParams(location.search).get("key")
  || store.get("todo-web-key") || "";
if (MODE === "web" && WEB_KEY) store.set("todo-web-key", WEB_KEY);

// Same method names as the Python Api class, whichever transport is in use.
const api = new Proxy({}, {
  get: (_, name) => async (...args) => {
    if (MODE === "desktop") return window.pywebview.api[name](...args);
    if (MODE === "phone") return window.SCRIPTABLE.call(name, args);
    const res = await fetch(`/api/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Key": WEB_KEY },
      body: JSON.stringify({ args }),
    });
    if (!res.ok) throw new Error(`${name} failed: ${res.status}`);
    return res.json();
  },
});

function pad(n) { return n.toString().padStart(2, "0"); }
function formatDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parseDate(s) { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); }

function sectionLabel(dateStr, prefix) {
  const date = parseDate(dateStr);
  const todayStr = formatDate(new Date());
  const dayWord = dateStr === todayStr
    ? "today"
    : date.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const [,m,d] = dateStr.split("-").map(Number);
  return `${prefix ? prefix + " — " : ""}${dayWord} (${MONTH_SHORT[m-1]} ${d})`;
}

function getCatIndex(name) {
  const i = state.categories.indexOf(name);
  return (i >= 0 ? i : 0) % 6;
}

// ── Theme ──

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  store.set("todo-theme", theme);
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

if (MODE !== "desktop") init();
else {
  window.addEventListener("pywebviewready", init);
  if (window.pywebview) init();
}

async function init() {
  applyTheme(store.get("todo-theme") || "yellow");
  bindEvents();
  await Promise.all([refreshDaysWithTasks(), loadCategories()]);
  renderCalendar();
  await loadTasks();
  if (MODE === "desktop") showPhoneLink();
  // Pick up changes made on another device when coming back to the app.
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    await Promise.all([refreshDaysWithTasks(), loadCategories()]);
    renderCalendar();
    loadTasks();
  });
}

async function showPhoneLink() {
  const url = await api.get_web_url();
  const el = document.getElementById("phoneLink");
  el.textContent = "📱 open on phone";
  el.title = `On the same Wi-Fi, open this in your phone's browser:\n${url}`;
  el.addEventListener("click", () => {
    navigator.clipboard?.writeText(url);
    el.textContent = "📱 link copied ✓";
    setTimeout(() => (el.textContent = "📱 open on phone"), 1800);
  });
  el.classList.remove("hidden");
}

function bindEvents() {
  document.getElementById("addBtn").addEventListener("click", addTask);
  document.getElementById("taskInput").addEventListener("keydown", e => {
    if (e.key === "Enter") addTask();
  });
  document.getElementById("tabTodo").addEventListener("click", () => switchTab("todo"));
  document.getElementById("tabCompleted").addEventListener("click", () => switchTab("completed"));
  document.getElementById("prevMonth").addEventListener("click", () => changeMonth(-1));
  document.getElementById("nextMonth").addEventListener("click", () => changeMonth(1));
  document.getElementById("todayBtn").addEventListener("click", jumpToToday);

  document.getElementById("addCatBtn").addEventListener("click", () => {
    const form = document.getElementById("addCatForm");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
      document.getElementById("catInput").focus();
    }
  });

  document.getElementById("catInput").addEventListener("keydown", e => {
    if (e.key === "Enter") addCategory();
    if (e.key === "Escape") document.getElementById("addCatForm").classList.add("hidden");
  });

  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.theme));
  });
}

function switchTab(tab) {
  state.activeTab = tab;
  document.getElementById("tabTodo").classList.toggle("active", tab === "todo");
  document.getElementById("tabCompleted").classList.toggle("active", tab === "completed");
  loadTasks();
}

function changeMonth(delta) {
  state.viewMonth += delta;
  if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear -= 1; }
  else if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear += 1; }
  renderCalendar();
}

function jumpToToday() {
  const now = new Date();
  state.viewMonth = now.getMonth();
  state.viewYear = now.getFullYear();
  state.selectedDate = formatDate(now);
  state.activeCategory = null;
  renderCategories();
  renderCalendar();
  loadTasks();
}

async function refreshDaysWithTasks() {
  try {
    state.daysWithTasks = await api.get_days_with_tasks();
  } catch (e) {
    state.daysWithTasks = {};
  }
}

function renderCalendar() {
  document.getElementById("calTitle").textContent =
    `${MONTH_NAMES[state.viewMonth]} ${state.viewYear}`;

  const grid = document.getElementById("calGrid");
  grid.innerHTML = "";

  const firstDay = new Date(state.viewYear, state.viewMonth, 1);
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
  const todayStr = formatDate(new Date());

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement("div");
    empty.className = "cal-cell empty";
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${state.viewYear}-${pad(state.viewMonth+1)}-${pad(d)}`;
    const cell = document.createElement("div");
    cell.className = "cal-cell";
    cell.textContent = d;
    if (dateStr === todayStr) cell.classList.add("today");
    if (dateStr === state.selectedDate) cell.classList.add("selected");
    if (state.daysWithTasks[dateStr]) cell.classList.add("has-tasks");
    cell.addEventListener("click", () => selectDate(dateStr));
    grid.appendChild(cell);
  }
}

function selectDate(dateStr) {
  state.selectedDate = dateStr;
  state.activeCategory = null;
  renderCategories();
  renderCalendar();
  loadTasks();
}

// ── Category operations ──

async function loadCategories() {
  try {
    state.categories = await api.get_categories();
  } catch (e) {
    state.categories = [];
  }
  renderCategories();
  refreshCategorySelect();
}

function renderCategories() {
  const list = document.getElementById("categoryList");
  list.innerHTML = "";

  if (state.categories.length === 0) {
    const p = document.createElement("p");
    p.className = "cat-empty";
    p.textContent = "no categories yet.";
    list.appendChild(p);
    return;
  }

  state.categories.forEach((cat, idx) => {
    const item = document.createElement("div");
    item.className = "cat-item" + (cat === state.activeCategory ? " active" : "");
    item.title = `Show all "${cat}" tasks`;
    item.addEventListener("click", () => selectCategory(cat));

    const dot = document.createElement("span");
    dot.className = "cat-dot";
    dot.dataset.ci = idx % 6;

    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = cat;

    const del = document.createElement("button");
    del.className = "cat-del";
    del.textContent = "✕";
    del.title = `Delete "${cat}"`;
    del.addEventListener("click", e => {
      e.stopPropagation();
      deleteCategory(cat);
    });

    item.append(dot, name, del);
    list.appendChild(item);
  });
}

function refreshCategorySelect() {
  const select = document.getElementById("categorySelect");
  const prev = select.value;
  select.innerHTML = '<option value="">no category</option>';
  state.categories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
  if (state.categories.includes(prev)) select.value = prev;
}

function selectCategory(cat) {
  // Clicking the active category again goes back to the selected day.
  state.activeCategory = state.activeCategory === cat ? null : cat;
  renderCategories();
  // New tasks added from this view get the same category by default.
  if (state.activeCategory) document.getElementById("categorySelect").value = cat;
  loadTasks();
}

async function addCategory() {
  const input = document.getElementById("catInput");
  const name = input.value.trim();
  if (!name) return;
  state.categories = await api.add_category(name);
  input.value = "";
  document.getElementById("addCatForm").classList.add("hidden");
  renderCategories();
  refreshCategorySelect();
}

async function deleteCategory(name) {
  state.categories = await api.delete_category(name);
  if (state.activeCategory === name) state.activeCategory = null;
  renderCategories();
  refreshCategorySelect();
  loadTasks();
}

// ── Task operations ──

async function addTask() {
  const input = document.getElementById("taskInput");
  const text = input.value.trim();
  if (!text) return;
  const category = document.getElementById("categorySelect").value;
  await api.add_task(state.selectedDate, text, category);
  input.value = "";
  input.focus();
  await refreshDaysWithTasks();
  renderCalendar();
  loadTasks();
}

async function loadTasks() {
  if (state.activeCategory) return loadCategoryTasks();

  const allTasks = await api.get_tasks(state.selectedDate);
  const showingCompleted = state.activeTab === "completed";
  const filtered = allTasks.filter(t => t.done === showingCompleted);

  document.getElementById("sectionTitle").textContent = sectionLabel(
    state.selectedDate,
    showingCompleted ? "completed" : ""
  );

  const list = document.getElementById("taskList");
  list.innerHTML = "";

  if (filtered.length === 0) {
    list.appendChild(emptyState(showingCompleted
      ? "no completed tasks for this day yet."
      : "no tasks for this day. add one above ✿"));
    return;
  }

  [...filtered].reverse().forEach(task => {
    list.appendChild(renderTaskRow(task, state.selectedDate));
  });
}

// All tasks with the active category, across every day, grouped by date.
async function loadCategoryTasks() {
  const cat = state.activeCategory;
  const tasks = await api.get_tasks_by_category(cat);
  const showingCompleted = state.activeTab === "completed";
  const filtered = tasks.filter(t => t.done === showingCompleted);

  document.getElementById("sectionTitle").textContent =
    `${cat} — ${showingCompleted ? "completed" : "to-do"}`;

  const list = document.getElementById("taskList");
  list.innerHTML = "";

  if (filtered.length === 0) {
    list.appendChild(emptyState(showingCompleted
      ? `no completed "${cat}" tasks yet.`
      : `nothing left to do in "${cat}" ✿`));
    return;
  }

  let lastDate = null;
  filtered.forEach(task => {
    if (task.date !== lastDate) {
      lastDate = task.date;
      const hd = document.createElement("div");
      hd.className = "date-group";
      hd.textContent = sectionLabel(task.date, "");
      hd.title = "Go to this day";
      hd.addEventListener("click", () => {
        const d = parseDate(task.date);
        state.viewMonth = d.getMonth();
        state.viewYear = d.getFullYear();
        selectDate(task.date);
      });
      list.appendChild(hd);
    }
    list.appendChild(renderTaskRow(task, task.date));
  });
}

function emptyState(text) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = text;
  return empty;
}

function renderTaskRow(task, date) {
  const row = document.createElement("div");
  row.className = "task-row";

  const check = document.createElement("div");
  check.className = "task-check" + (task.done ? " checked" : "");
  check.title = task.done ? "Mark as not done" : "Mark as done";
  check.addEventListener("click", async () => {
    await api.toggle_task(date, task.id);
    await refreshDaysWithTasks();
    renderCalendar();
    loadTasks();
  });

  const text = document.createElement("span");
  text.className = "task-text" + (task.done ? " done" : "");
  text.textContent = task.text;
  text.title = "Click to edit";
  text.addEventListener("click", () => editTask(task, text, date));

  row.append(check, text);

  if (task.category) {
    const badge = document.createElement("span");
    badge.className = "cat-badge";
    badge.dataset.ci = getCatIndex(task.category);
    badge.textContent = task.category;
    row.appendChild(badge);
  }

  if (task.done && task.completed_at) {
    const time = document.createElement("span");
    time.className = "task-time";
    time.textContent = task.completed_at;
    row.appendChild(time);
  }

  const del = document.createElement("button");
  del.className = "task-delete";
  del.textContent = "✕";
  del.title = "Delete task";
  del.addEventListener("click", async () => {
    await api.delete_task(date, task.id);
    await refreshDaysWithTasks();
    renderCalendar();
    loadTasks();
  });
  row.appendChild(del);

  return row;
}

function editTask(task, textEl, date) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = task.text;
  input.className = "task-text";
  input.style.cssText = "background:transparent;border:none;outline:none;font:inherit;color:inherit;width:100%;";
  textEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newText = input.value.trim();
    if (newText && newText !== task.text) {
      await api.edit_task(date, task.id, newText);
    }
    loadTasks();
  };

  input.addEventListener("keydown", e => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") loadTasks();
  });
  input.addEventListener("blur", commit);
}

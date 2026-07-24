// Retro ToDo — frontend logic.
// Talks to the Python backend via window.pywebview.api (see app.py's Api class).

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const state = {
  selectedDate: formatDate(new Date()),
  viewMonth: new Date().getMonth(),
  viewYear: new Date().getFullYear(),
  activeTab: "today", // "today" | "completed"
  daysWithTasks: {},
};

function pad(n) {
  return n.toString().padStart(2, "0");
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function sectionLabel(dateStr, prefix) {
  const date = parseDate(dateStr);
  const todayStr = formatDate(new Date());
  const dayWord =
    dateStr === todayStr
      ? "TODAY"
      : date.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  const [, m, d] = dateStr.split("-").map(Number);
  return `${prefix ? prefix + " — " : ""}${dayWord} (${MONTH_SHORT[m - 1]} ${d})`;
}

window.addEventListener("pywebviewready", init);
// Fallback in case the event fires before the listener is attached.
if (window.pywebview) init();

async function init() {
  bindEvents();
  await refreshDaysWithTasks();
  renderCalendar();
  await loadTasks();
}

function bindEvents() {
  document.getElementById("addBtn").addEventListener("click", addTask);
  document.getElementById("taskInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTask();
  });
  document.getElementById("tabToday").addEventListener("click", () => switchTab("today"));
  document.getElementById("tabCompleted").addEventListener("click", () => switchTab("completed"));
  document.getElementById("prevMonth").addEventListener("click", () => changeMonth(-1));
  document.getElementById("nextMonth").addEventListener("click", () => changeMonth(1));
  document.getElementById("todayBtn").addEventListener("click", jumpToToday);
}

function switchTab(tab) {
  state.activeTab = tab;
  document.getElementById("tabToday").classList.toggle("active", tab === "today");
  document.getElementById("tabCompleted").classList.toggle("active", tab === "completed");
  loadTasks();
}

function changeMonth(delta) {
  state.viewMonth += delta;
  if (state.viewMonth < 0) {
    state.viewMonth = 11;
    state.viewYear -= 1;
  } else if (state.viewMonth > 11) {
    state.viewMonth = 0;
    state.viewYear += 1;
  }
  renderCalendar();
}

function jumpToToday() {
  const now = new Date();
  state.viewMonth = now.getMonth();
  state.viewYear = now.getFullYear();
  state.selectedDate = formatDate(now);
  renderCalendar();
  loadTasks();
}

async function refreshDaysWithTasks() {
  try {
    state.daysWithTasks = await window.pywebview.api.get_days_with_tasks();
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
  // JS getDay(): Sun=0..Sat=6. We want a Monday-first grid.
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
    const dateStr = `${state.viewYear}-${pad(state.viewMonth + 1)}-${pad(d)}`;
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
  renderCalendar();
  loadTasks();
}

async function addTask() {
  const input = document.getElementById("taskInput");
  const text = input.value.trim();
  if (!text) return;
  await window.pywebview.api.add_task(state.selectedDate, text);
  input.value = "";
  input.focus();
  await refreshDaysWithTasks();
  renderCalendar();
  if (state.activeTab === "today") loadTasks();
}

async function loadTasks() {
  const allTasks = await window.pywebview.api.get_tasks(state.selectedDate);
  const showingCompleted = state.activeTab === "completed";
  const filtered = allTasks.filter((t) => t.done === showingCompleted);

  document.getElementById("sectionTitle").textContent = sectionLabel(
    state.selectedDate,
    showingCompleted ? "COMPLETED" : ""
  );

  const list = document.getElementById("taskList");
  list.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = showingCompleted
      ? "No completed tasks for this day yet."
      : "No tasks scheduled or logged for this day.";
    list.appendChild(empty);
    return;
  }

  // Most recently added first for "today", most recently completed first for "completed".
  const ordered = [...filtered].reverse();

  ordered.forEach((task) => {
    list.appendChild(renderTaskRow(task));
  });
}

function renderTaskRow(task) {
  const row = document.createElement("div");
  row.className = "task-row";

  const check = document.createElement("div");
  check.className = "task-check" + (task.done ? " checked" : "");
  check.title = task.done ? "Mark as not done" : "Mark as done";
  check.addEventListener("click", async () => {
    await window.pywebview.api.toggle_task(state.selectedDate, task.id);
    await refreshDaysWithTasks();
    renderCalendar();
    loadTasks();
  });

  const text = document.createElement("span");
  text.className = "task-text" + (task.done ? " done" : "");
  text.textContent = task.text;
  text.title = "Click to edit";
  text.addEventListener("click", () => editTask(task, text));

  row.appendChild(check);
  row.appendChild(text);

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
    await window.pywebview.api.delete_task(state.selectedDate, task.id);
    await refreshDaysWithTasks();
    renderCalendar();
    loadTasks();
  });
  row.appendChild(del);

  return row;
}

function editTask(task, textEl) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = task.text;
  input.className = "task-text";
  input.style.background = "transparent";
  input.style.border = "none";
  input.style.outline = "none";
  input.style.font = "inherit";
  input.style.color = "inherit";
  input.style.width = "100%";

  textEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newText = input.value.trim();
    if (newText && newText !== task.text) {
      await window.pywebview.api.edit_task(state.selectedDate, task.id, newText);
    }
    loadTasks();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") loadTasks();
  });
  input.addEventListener("blur", commit);
}

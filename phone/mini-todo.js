// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: yellow; icon-glyph: check-square;

// mini-todo for iPhone — runs in the Scriptable app (https://scriptable.app).
//
// Reads and writes the same iCloud Drive/Applications/mini-todo/tasks.json as the Mac app,
// so it works anywhere (5G, offline) without the Mac. iCloud syncs the file.
//
// One-time setup: Scriptable → Settings → File Bookmarks → add the
// "iCloud Drive/Applications/mini-todo" folder and name the bookmark exactly "mini-todo".
//
// The UI files (index.html, style.css, script.js) are copied into
// iCloud Drive/Applications/mini-todo/ui/ by the Mac app on every launch.

const VERSION = "2026-11-21f";  // bump when changing this file, to spot stale iCloud copies

const fm = FileManager.iCloud();

function dir() { return fm.bookmarkedPath("mini-todo"); }
function dataFile() { return fm.joinPath(dir(), "tasks.json"); }

// Logs to Scriptable's console and to phone-log.txt next to tasks.json, so the
// log can be read from the Mac even when the script wasn't run from the editor.
function log(msg, isError = false) {
  isError ? console.error(msg) : console.log(msg);
  try {
    const path = fm.joinPath(dir(), "phone-log.txt");
    const old = fm.fileExists(path) ? fm.readString(path) || "" : "";
    const line = `${new Date().toISOString()} ${isError ? "ERROR " : ""}${msg}`;
    fm.writeString(path, [...old.split("\n").filter(Boolean).slice(-199), line].join("\n") + "\n");
  } catch (e) {}
}

async function readText(path) {
  if (!fm.isFileDownloaded(path)) await fm.downloadFileFromiCloud(path);
  return fm.readString(path);
}

// -- persistence (same file format as app.py) -------------------------------

// Always re-read the file, so changes synced from the Mac are picked up.
async function load() {
  if (!fm.fileExists(dataFile())) return {};
  // Throw on bad JSON rather than returning {}, so a bad sync never wipes the data.
  return JSON.parse(await readText(dataFile()));
}

function save(data) {
  fm.writeString(dataFile(), JSON.stringify(data, null, 2));
}

function isDay(key, value) {
  return key !== "categories" && Array.isArray(value);
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Load, apply `fn` to one day's task list, save, return that day's tasks.
async function updateDay(date, fn) {
  const data = await load();
  data[date] = fn(data[date] || []);
  save(data);
  return data[date];
}

// -- API: mirrors the Api class in app.py ----------------------------------

const api = {
  async get_categories() {
    return (await load()).categories || [];
  },

  async add_category(name) {
    name = (name || "").trim();
    const data = await load();
    data.categories = data.categories || [];
    if (name && !data.categories.includes(name)) {
      data.categories.push(name);
      save(data);
    }
    return data.categories;
  },

  async delete_category(name) {
    const data = await load();
    data.categories = (data.categories || []).filter(c => c !== name);
    save(data);
    return data.categories;
  },

  async get_tasks(date) {
    return (await load())[date] || [];
  },

  async add_task(date, text, category = "") {
    text = (text || "").trim();
    if (!text) return api.get_tasks(date);
    return updateDay(date, tasks => [...tasks, {
      id: String(Date.now()),
      text,
      done: false,
      completed_at: null,
      category: (category || "").trim(),
    }]);
  },

  async toggle_task(date, taskId) {
    return updateDay(date, tasks => tasks.map(t => t.id !== taskId ? t : {
      ...t,
      done: !t.done,
      completed_at: t.done ? null : nowHHMM(),
    }));
  },

  async delete_task(date, taskId) {
    return updateDay(date, tasks => tasks.filter(t => t.id !== taskId));
  },

  async edit_task(date, taskId, newText) {
    newText = (newText || "").trim();
    if (!newText) return api.get_tasks(date);
    return updateDay(date, tasks => tasks.map(t => t.id === taskId ? { ...t, text: newText } : t));
  },

  async get_days_with_tasks() {
    const data = await load();
    const out = {};
    for (const [d, v] of Object.entries(data)) {
      if (isDay(d, v) && v.length) out[d] = v.length;
    }
    return out;
  },

  async get_tasks_by_category(category) {
    const data = await load();
    const out = [];
    for (const d of Object.keys(data).sort().reverse()) {
      if (!isDay(d, data[d])) continue;
      for (const t of data[d]) {
        if (t.category === category) out.push({ ...t, date: d });
      }
    }
    return out;
  },
};

// -- page bridge -----------------------------------------------------------
// The page queues API calls in window.SCRIPTABLE and "rings" by loading a hidden
// minitodo:// iframe. shouldAllowRequest catches that ring, and drain() fetches
// the queued calls, runs them, and sends the results back. Nothing polls the web
// view continuously — doing that kept it from drawing (black screen). A slow
// safety poll covers any missed ring.

const SAFETY_POLL_MS = 1000;

const BRIDGE = `
window.SCRIPTABLE = {
  queue: [], pending: {}, errors: [], seq: 0,
  call(name, args) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending[id] = { resolve, reject };
      this.queue.push({ id, name, args });
      if (this.queue.length === 1) this.ring();
    });
  },
  ring() {
    const f = document.createElement("iframe");
    f.style.display = "none";
    f.src = "minitodo://ring/" + this.seq;
    document.documentElement.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  },
  take() {
    return JSON.stringify({ calls: this.queue.splice(0), errors: this.errors.splice(0) });
  },
  deliver(id, ok, value) {
    const p = this.pending[id];
    delete this.pending[id];
    if (p) ok ? p.resolve(value) : p.reject(new Error(value));
  },
};
window.addEventListener("error", e => SCRIPTABLE.errors.push(String(e.message)));
window.addEventListener("unhandledrejection", e => SCRIPTABLE.errors.push(String(e.reason)));
`;

function sleep(ms) {
  return new Promise(resolve => Timer.schedule(ms, false, resolve));
}

function showAlert(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  return a.present();
}

// Runs every queued page call and delivers the results. Never runs twice at once.
function makeDrainer(wv) {
  let draining = false;
  let again = false;
  return async function drain() {
    if (draining) { again = true; return; }
    draining = true;
    try {
      do {
        again = false;
        const { calls, errors } = JSON.parse(await wv.evaluateJavaScript("SCRIPTABLE.take()"));
        errors.forEach(e => log(`page: ${e}`, true));
        for (const c of calls) {
          let ok = true;
          let value;
          try {
            value = await api[c.name](...c.args);
          } catch (e) {
            ok = false;
            value = String(e);
            log(`${c.name}: ${value}`, true);
          }
          await wv.evaluateJavaScript(
            `SCRIPTABLE.deliver(${c.id}, ${ok}, ${JSON.stringify(value === undefined ? null : value)})`
          );
        }
      } while (again);
    } catch (e) {
      log(`mini-todo: bridge error ${e}`, true);
    } finally {
      draining = false;
    }
  };
}

async function run() {
  const UI = fm.joinPath(dir(), "ui");
  log(`mini-todo ${VERSION}: loading UI from ${UI}`);
  log(`mini-todo: launched ${JSON.stringify({
    inApp: config.runsInApp, homeScreen: config.runsFromHomeScreen,
    siri: config.runsWithSiri, widget: config.runsInWidget,
  })}`);
  const [html, css, js] = await Promise.all(
    ["index.html", "style.css", "script.js"].map(f => readText(fm.joinPath(UI, f)))
  );
  log(`mini-todo: read html ${html.length}, css ${css.length}, js ${js.length} chars`);

  // Inline the stylesheet and scripts, since the web view can't load relative files.
  const page = html
    .replace(/<link rel="stylesheet" href="style.css"\s*\/?>/, () => `<style>${css}</style>`)
    .replace(/<script src="script.js"><\/script>/, () => `<script>${BRIDGE}</script><script>${js}</script>`);

  if (page.includes('href="style.css"') || page.includes('src="script.js"')) {
    throw new Error("couldn't inline the UI files — is ui/index.html up to date?");
  }

  const wv = new WebView();
  const drain = makeDrainer(wv);
  let rings = 0;
  wv.shouldAllowRequest = req => {
    if (String(req.url).startsWith("minitodo:")) {
      rings++;
      drain();
      return false;
    }
    return true;
  };

  // Present first, then load: a web view loaded off-screen sometimes stays 0x0
  // after it's presented, which shows up as a black screen.
  let open = true;
  const closed = wv.present(true).then(() => { open = false; });
  await wv.loadHTML(page);

  // Startup check: did the styles and the app script load in the web view?
  const check = await wv.evaluateJavaScript(
    `(() => { try {
      return JSON.stringify({ background: getComputedStyle(document.body).backgroundColor,
                              mode: typeof MODE === "undefined" ? "script not loaded" : MODE,
                              size: innerWidth + "x" + innerHeight });
    } catch (e) { return "failed: " + e; } })()`
  );
  log(`mini-todo: page check ${check}`);
  if (!String(check).includes('"mode":"phone"')) {
    await showAlert("mini-todo: page didn't load right", `Send this to Claude:\n${check}`);
  }

  let reported = false;
  while (open) {
    await sleep(SAFETY_POLL_MS);
    if (!open) break;
    await drain();
    if (!reported) {
      reported = true;
      // What the page looks like once it's on screen, in case it still shows black.
      log("mini-todo: shown " + await wv.evaluateJavaScript(
        `JSON.stringify({ size: innerWidth + "x" + innerHeight, scrollY,
                          visible: document.visibilityState,
                          tasks: document.querySelectorAll(".task-row").length,
                          days: document.querySelectorAll(".cal-cell").length })`
      ) + `, rings ${rings}`);
    }
  }
  await closed;
}

// -- entry point -----------------------------------------------------------

if (!config.runsInApp) {
  // Shortcuts/Siri can't show the full-screen app view (or alerts), so explain instead.
  log("mini-todo: started outside the app (Run In App is off)", true);
  throw new Error('Open this Shortcut\'s "Run Script" action (tap ›) and turn on "Run In App".');
} else if (fm.bookmarkExists("mini-todo")) {
  try {
    await run();
  } catch (e) {
    log(`mini-todo: ${e}`, true);
    await showAlert("mini-todo error", String(e));
  }
} else {
  await showAlert(
    "mini-todo setup",
    'Go to Scriptable → Settings → File Bookmarks, add the "iCloud Drive/Applications/mini-todo" ' +
    'folder and name the bookmark "mini-todo". Then run this script again.'
  );
}
Script.complete();

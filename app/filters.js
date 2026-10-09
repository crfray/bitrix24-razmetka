"use strict";

// Фильтры по колонкам. Один механизм и для шапки таблицы, и для бокового меню:
// STATE.filter.cols = { ключ_колонки: [выбранные значения] }.
// Внутри колонки значения складываются как ИЛИ, между колонками — как И.

var EMPTY_VALUE = "__EMPTY__";

// Independent area: tool remains tasks within its own data directory.
var TASK_CHATS_FILTER = "__task_chats__";
function taskChatsSelected() {
  return STATE.typeList && pickedFor("tool").indexOf(TASK_CHATS_FILTER) >= 0;
}
function apiFetch(url, options, area) {
  if (url !== "/api/state") {
    if (area === undefined) area = STATE.open ? STATE.openArea : (taskChatsSelected() ? "task_chats" : "main");
    url += (url.indexOf("?") >= 0 ? "&" : "?") + "area=" + (area === "task_chats" ? "task_chats" : "main");
  }
  options = Object.assign({}, options || {});
  if ((options.method || "GET").toUpperCase() !== "GET") {
    options.headers = new Headers(options.headers || {});
    if (AUTH_STATE.csrf) options.headers.set("X-CSRF-Token", AUTH_STATE.csrf);
  }
  return fetch(appUrl(url), options).then(function (response) {
    if (response.status === 401 && url.indexOf("/api/auth/login") !== 0) {
      updateAuth({});
      makeSheetReadOnly();
      showLogin(null, "Сессия истекла. Войдите для редактирования и повторите действие.");
      return new Response(JSON.stringify({ ok: false, "ошибка": "Войдите и повторите действие" }), {
        status: 401, headers: { "Content-Type": "application/json" }
      });
    }
    return response;
  });
}
var TASK_CHATS_LABEL = "\u0427\u0430\u0442\u044b \u0437\u0430\u0434\u0430\u0447";
function isTaskChatEvent(e) {
  if (!STATE.typeList || e.tool !== "tasks") return false;
  return [].concat(e.type || []).indexOf("chat_task") >= 0 ||
    [].concat(e.c_section || []).indexOf("chat_tasks") >= 0 ||
    [].concat(e.c_sub_section || []).indexOf("chat_task_card") >= 0 ||
    e.category === "chat_operations" ||
    (e.source || {}).sheet === "\u0420\u0430\u0437\u043c\u0435\u0442\u043a\u0430 \u0447\u0430\u0442\u043e\u0432";
}


// Значения колонки в виде списка строк — по ним и сравниваем.
function colValues(e, key) {
  if (key === "images") return (e.images || []).length ? ["есть"] : [];
  if (key === "task_url") return e.task_url ? [e.task_url] : [];
  if (key === "type") return [].concat(e.type || []).filter(Boolean);
  if (key === "light") {
    var totals = lightTotals(e);
    return LIGHT_KEYS.filter(function (k) { return totals[k]; });
  }
  if (["c_section", "c_sub_section", "c_element", "status", "measures"].indexOf(key) >= 0) {
    return e[key] || [];
  }
  if (/^p[1-5]$/.test(key)) return (e.params || {})[key] || [];
  if (key === "test_ids") return (e.dev || {}).test_ids || [];
  if (key === "update_code" || key === "eta") {
    var value = (e.dev || {})[key];
    return value ? [value] : [];
  }
  return e[key] ? [String(e[key])] : [];
}

function valueLabel(key, value) {
  if (key === "tool" && value === TASK_CHATS_FILTER) return TASK_CHATS_LABEL;
  if (value === EMPTY_VALUE) return "— пусто —";
  if (key === "state") return STATE_LABEL[value] || value;
  if (key === "impl") return IMPL_LABEL[value] || value;
  if (key === "light") return "есть «" + (LIGHT_LABEL[value] || value) + "»";
  if (key === "priority") return PRIORITY_LABEL[value] || value;
  if (key === "task_url") return taskLabel(value);
  if (key === "images") return "есть скриншоты";
  return value;
}

function pickedFor(key) {
  return STATE.filter.cols[key] || [];
}

function togglePicked(key, value) {
  var list = pickedFor(key).slice();
  var at = list.indexOf(value);
  if (at >= 0) list.splice(at, 1);
  else list.push(value);
  if (list.length) STATE.filter.cols[key] = list;
  else delete STATE.filter.cols[key];
}

// Боковое меню выбирает по одному значению: повторный клик снимает выбор.
function setPicked(key, value) {
  var list = pickedFor(key);
  if (list.length === 1 && list[0] === value) delete STATE.filter.cols[key];
  else STATE.filter.cols[key] = [value];
}

function matchesCols(e, skipKey) {
  var cols = STATE.filter.cols;
  return Object.keys(cols).every(function (key) {
    if (key === skipKey) return true;
    var picked = cols[key];
    if (!picked.length) return true;
    var values = colValues(e, key);
    if (!values.length) return picked.indexOf(EMPTY_VALUE) >= 0;
    if (key === "tool" && picked.indexOf(TASK_CHATS_FILTER) >= 0 && taskChatsSelected()) return true;
    return values.some(function (v) { return picked.indexOf(v) >= 0; });
  });
}

// Всё, что прошло остальные фильтры — по этому пулу считаем счётчики колонки.
function poolExcept(key) {
  return allEvents().filter(function (e) {
    return matchesCols(e, key) && matchesFlag(e) && matchesQuery(e);
  });
}

// --------------------------------------------------------------- окно фильтра
var FILTER_POP = null;

function closeColumnFilter() {
  if (FILTER_POP) {
    FILTER_POP.remove();
    FILTER_POP = null;
  }
}

function openColumnFilter(col, anchor) {
  var wasOpen = FILTER_POP && FILTER_POP.getAttribute("data-key") === col.key;
  closeColumnFilter();
  if (wasOpen) return;

  var pool = poolExcept(col.key);
  var counts = {};
  var empty = 0;
  pool.forEach(function (e) {
    var values = colValues(e, col.key);
    if (!values.length) empty += 1;
    values.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
  });
  var names = Object.keys(counts).sort(function (a, b) {
    return counts[b] - counts[a] || valueLabel(col.key, a).localeCompare(valueLabel(col.key, b));
  });

  var pop = el("div", { class: "filter-pop" });
  pop.setAttribute("data-key", col.key);
  pop.addEventListener("click", function (ev) { ev.stopPropagation(); });

  var list = el("div", { class: "filter-list" });

  function row(value, count) {
    var box = el("input", { type: "checkbox" });
    box.checked = pickedFor(col.key).indexOf(value) >= 0;
    box.addEventListener("change", function () {
      togglePicked(col.key, value);
      render();
    });
    return el("label", { class: "filter-row" }, [
      box,
      el("span", { class: "filter-name", text: valueLabel(col.key, value) }),
      el("span", { class: "n", text: String(count) })
    ]);
  }

  function fill(query) {
    list.textContent = "";
    var shown = names.filter(function (v) {
      return !query || valueLabel(col.key, v).toLowerCase().indexOf(query) >= 0;
    });
    if (empty && (!query || "пусто".indexOf(query) >= 0)) {
      list.appendChild(row(EMPTY_VALUE, empty));
    }
    shown.forEach(function (v) { list.appendChild(row(v, counts[v])); });
    if (!shown.length && !empty) {
      list.appendChild(el("div", { class: "filter-none", text: "Нет значений." }));
    }
  }

  if (names.length > 8) {
    var search = el("input", { class: "filter-search", placeholder: "найти значение" });
    search.addEventListener("input", function () {
      fill(search.value.trim().toLowerCase());
    });
    pop.appendChild(search);
  }
  fill("");
  pop.appendChild(list);
  pop.appendChild(el("div", { class: "filter-foot" }, [
    el("button", {
      type: "button", class: "ghost", text: "Очистить",
      onclick: function () { delete STATE.filter.cols[col.key]; render(); closeColumnFilter(); }
    }),
    el("button", {
      type: "button", class: "ghost", text: "Закрыть", onclick: closeColumnFilter
    })
  ]));

  document.body.appendChild(pop);
  FILTER_POP = pop;

  var box = anchor.getBoundingClientRect();
  var left = Math.min(box.left, window.innerWidth - pop.offsetWidth - 10);
  pop.style.left = Math.round(Math.max(8, left)) + "px";
  pop.style.top = Math.round(box.bottom + 6) + "px";
  var search2 = pop.querySelector(".filter-search");
  if (search2) search2.focus();
}

document.addEventListener("click", closeColumnFilter);
document.addEventListener("keydown", function (ev) {
  if (ev.key === "Escape") closeColumnFilter();
});

"use strict";

// ---------------------------------------------------------------- состояние
var STATE = { tools: {}, dict: {}, states: [], filter: { cols: {}, starred: false, review: false, legacy: false, q: "" }, open: null };

var STATE_LABEL = {
  draft: "черновик", approved: "согласование", in_dev: "в разработке",
  testing: "тестируется", awaiting_release: "ждёт выкатки", live: "работает сейчас",
  broken: "сломано", deprecated: "неактуально"
};
// Состояние реализации — отдельная ось от состояния события: она про то,
// в каком виде разметка сейчас существует в продукте.
var IMPL_STATES = ["backlog", "in_sprint", "rework", "needs_check",
                   "needs_rework", "works"];
var IMPL_LABEL = {
  backlog: "Бэклог", in_sprint: "В этом спринте", rework: "На доработке",
  needs_check: "Требует проверки", needs_rework: "Требует доработки",
  works: "Работает корректно"
};
// Шкала от красного к зелёному: 1 — далеко от готовности, 5 — работает, 0 — вне шкалы.
var STATE_TONE = {
  draft: 1, approved: 2, in_dev: 3, testing: 4,
  awaiting_release: 5, live: 6, broken: 1, deprecated: 0
};
// Бэклог серый: это не «плохо», а «ещё не начато». Красный оставлен под проблему.
var IMPL_TONE = {
  backlog: 0, needs_rework: 1, in_sprint: 2, rework: 3, needs_check: 4, works: 6
};
function toneClass(map, key) {
  var tone = map[key];
  return tone === undefined ? "t0" : "t" + tone;
}

var PRIORITY_STATES = ["high", "medium", "low"];
var PRIORITY_LABEL = { high: "Высокий", medium: "Средний", low: "Низкий" };
var PRIORITY_TONE = { high: 1, medium: 3, low: 0 };

var LIST_FIELDS = ["c_section", "c_sub_section", "c_element", "status"];
var PARAM_FIELDS = ["p1", "p2", "p3", "p4", "p5"];

// Светофор: состояние у каждого значения контекста, а не у строки целиком.
// Строка «В этом спринте» врёт, если из десяти мест работают девять.
// Хранится в e.light = { поле: { значение: "green" | "yellow" | "red" } }; нет записи — серый.
// p* не красим: дефект параметра всегда привязан к месту и уходит в цвет места.
var LIGHT_FIELDS = ["type", "c_section", "c_sub_section", "c_element"];
var LIGHT_KEYS = ["green", "yellow", "red", "grey"];
var LIGHT_CYCLE = ["grey", "green", "yellow", "red"];
var LIGHT_LABEL = { green: "работает", yellow: "частично", red: "не работает", grey: "не проверено" };
var LIGHT_TONE = { green: "t6", yellow: "t3", red: "t1", grey: "t0" };

function lightOf(e, field, value) {
  return ((e.light || {})[field] || {})[value] || "grey";
}
// Карта цветов поля для отрисовки; undefined — поле не красится.
function litFor(e, field) {
  if (!STATE.lights || LIGHT_FIELDS.indexOf(field) < 0) return undefined;
  return (e.light || {})[field] || {};
}
function lightTotals(e) {
  var out = { green: 0, yellow: 0, red: 0, grey: 0 };
  LIGHT_FIELDS.forEach(function (f) {
    var values = f === "type" ? typeValues(e) : (e[f] || []);
    values.forEach(function (v) { out[lightOf(e, f, v)] += 1; });
  });
  return out;
}

// ------------------------------------------------- генератор имени события
// Правила взяты из GLOSSARY.md: сущность_действие_фаза, click_* для намерения.
var VERBS = [
  ["клик", "click"], ["нажат", "click"],
  ["создан", "create"], ["создание", "create"], ["создат", "create"],
  ["добавлен", "add"], ["добавит", "add"], ["добавл", "add"],
  ["удален", "delete"], ["удалит", "delete"], ["удал", "delete"],
  ["редактир", "edit"], ["изменен", "edit"], ["измен", "edit"],
  ["настрой", "settings"], ["копирован", "copy"], ["конвертац", "convert"],
  ["архивац", "archive"], ["разархивац", "unarchive"],
  ["переход", "open"], ["открыт", "open"], ["открыл", "open"],
  ["просмотр", "view"], ["показ", "view"], ["отображ", "view"],
  ["отправк", "send"], ["отправ", "send"], ["сохран", "save"],
  ["скачив", "download"], ["скачат", "download"], ["загруз", "upload"],
  ["прикреп", "attach"], ["принят", "accept"], ["отказ", "decline"],
  ["приглаш", "invite"], ["подтвержден", "submit"], ["очист", "clear"],
  ["поиск", "search"], ["фильтр", "filter"], ["реакц", "reaction"],
  ["заверш", "complete"], ["присоедин", "connect"], ["звонок", "call"],
  ["постанов", "set"], ["поставит", "set"], ["ставит", "set"], ["установ", "set"],
  ["назнач", "assign"], ["выбор", "select"], ["выбрат", "select"],
  ["включ", "enable"], ["выключ", "disable"],
  ["подписк", "subscribe"], ["отписк", "unsubscribe"],
  ["закреп", "pin"], ["открепл", "unpin"], ["упомин", "mention"],
  ["перетаск", "drag"], ["сортиров", "sort"], ["перенос", "move"], ["перемещ", "move"],
  ["экспорт", "export"], ["импорт", "import"], ["печат", "print"],
  ["обновл", "update"], ["восстановл", "restore"], ["отмет", "mark"],
  ["скрыт", "hide"], ["раскрыт", "expand"], ["оцен", "rate"], ["голосов", "vote"]
];
var ENTITIES = [
  ["подзадач", "subtask"], ["задач", "task"], ["проект", "project"],
  ["файл", "file"], ["папк", "folder"], ["диск", "disk"],
  ["чат", "chat"], ["сообщен", "message"], ["коммент", "comment"], ["пост", "post"],
  ["встреч", "meeting"], ["событи", "event"], ["календар", "calendar"],
  ["участник", "user"], ["пользовател", "user"], ["отдел", "department"],
  ["шаблон", "pattern"], ["поток", "flow"], ["канал", "channel"], ["лент", "feed"],
  ["раздел", "section"], ["таб", "tab"], ["карточк", "card"], ["коллаб", "collab"],
  ["базу знаний", "bk"], ["базе знаний", "bk"], ["маркет", "market"],
  ["копилот", "copilot"], ["чек лист", "checklist"], ["чеклист", "checklist"],
  ["ссылк", "link"], ["приглашен", "invite"],
  ["уведомлен", "notification"], ["оповещен", "notification"],
  ["напоминан", "reminder"], ["дедлайн", "deadline"], ["срок", "deadline"],
  ["исполнител", "assignee"], ["наблюдател", "auditor"],
  ["вкладк", "tab"], ["настройк", "settings"], ["фильтр", "filter"],
  ["робот", "robot"], ["группа", "group"], ["канбан", "kanban"], ["гант", "gantt"],
  ["виджет", "widget"], ["баннер", "banner"], ["подсказк", "hint"]
];
var PHASES = [["старт", "start"], ["начал", "start"], ["заверш", "finish"],
              ["окончан", "finish"], ["финиш", "finish"]];

// Зоны интерфейса: в них можно войти, но они не объект с идентификатором.
var SECTION_LIKE = ["section", "tab", "feed", "calendar", "market", "bk", "disk", "flow"];

var LETTER = /[a-zа-яё0-9]/;

function findAll(text, table) {
  var out = [];
  for (var i = 0; i < table.length; i++) {
    var needle = table[i][0];
    var from = 0;
    while (true) {
      var at = text.indexOf(needle, from);
      if (at < 0) break;
      // Основа должна начинать слово, иначе «отвеЧАТь» сойдёт за «чат».
      if (at === 0 || !LETTER.test(text.charAt(at - 1))) {
        out.push({ token: table[i][1], at: at, len: needle.length });
        break;
      }
      from = at + 1;
    }
  }
  // Раньше — значит главнее: русское описание почти всегда начинается с действия.
  out.sort(function (a, b) { return a.at - b.at || b.len - a.len; });
  return out;
}
function firstToken(text, table) {
  var all = findAll(text, table);
  return all.length ? all[0] : null;
}

function analyzeName(description, params) {
  var text = (description || "").toLowerCase();
  if (!text.trim()) {
    return { name: "", why: "Сначала напиши описание сценария." };
  }
  var verb = firstToken(text, VERBS);
  var phase = firstToken(text, PHASES);

  // Сущность ищем вне глагола, иначе «Принятие приглашения» даёт invite_invite.
  var rest = verb ? text.slice(0, verb.at) + " " + text.slice(verb.at + verb.len) : text;
  var cands = findAll(rest, ENTITIES);
  // «проект» — обычно принадлежность (см. GLOSSARY, правило tool), а «событие» в начале
  // описания — это про сам факт трекинга. И то и другое уступает настоящему объекту.
  if (cands.length > 1) {
    var strong = cands.filter(function (c) {
      return c.token !== "project" && c.token !== "event";
    });
    if (strong.length) cands = strong;
  }
  var entity = cands.length ? cands[0].token : null;

  if (!verb) {
    return {
      name: "",
      why: "Не нашёл в описании действия" +
        (entity ? " — сущность узнал, это «" + entity + "»" : "") + ". " +
        "Опиши, что делает пользователь, а не за что отвечает событие. " +
        "Понимаю такие действия: создание, удаление, изменение, переход, открытие, " +
        "отправка, клик, загрузка, сохранение, постановка, назначение, выбор."
    };
  }

  var parts = ["действие «" + verb.token + "»"];
  if (entity) parts.unshift("сущность «" + entity + "»");
  if (phase) parts.push("фаза «" + phase.token + "»");

  var name;
  if (verb.token === "click") {
    var inner = firstToken(rest, VERBS);
    name = ["click", inner ? inner.token : "create", entity].filter(Boolean).join("_");
  } else if (verb.token === "open" || verb.token === "view") {
    var hasId = (params || []).some(function (v) { return /Id_$/.test(v); });
    var isZone = !entity || SECTION_LIKE.indexOf(entity) >= 0;
    name = isZone ? "open_" + (entity === "tab" ? "tab" : "section") : entity + "_view";
    if (isZone) parts.push(hasId ? "зона, хотя есть идентификатор" : "зона без идентификатора");
  } else {
    name = [entity, verb.token, phase ? phase.token : null].filter(Boolean).join("_");
  }
  return { name: name, parts: parts, why: "" };
}

// ------------------------------------------------------------------ утилиты
function el(tag, attrs, kids) {
  var node = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (k) {
    if (k === "class") node.className = attrs[k];
    else if (k === "text") node.textContent = attrs[k];
    else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
  });
  (kids || []).forEach(function (kid) { if (kid) node.appendChild(kid); });
  return node;
}
// Выделение текста мышью не должно открывать карточку — только настоящий клик.
var pressStart = null;
document.addEventListener("mousedown", function (ev) {
  pressStart = { x: ev.clientX, y: ev.clientY };
});
function isPlainClick(ev) {
  var selection = window.getSelection ? String(window.getSelection()) : "";
  if (selection.trim()) return false;
  if (!pressStart) return true;
  return Math.abs(ev.clientX - pressStart.x) <= 4 &&
         Math.abs(ev.clientY - pressStart.y) <= 4;
}

// Картинка открывается поверх страницы, а не в новой вкладке.
var LIGHTBOX_EDIT = null;

function openLightbox(src, caption, onEdit) {
  var media = document.getElementById("lightbox-img");
  var box = document.getElementById("lightbox");
  var old = box.querySelector("video");
  if (old) old.remove();
  if (isVideo(src)) {
    media.hidden = true;
    var player = el("video", { src: src, controls: "controls", autoplay: "autoplay" });
    player.addEventListener("click", function (ev) { ev.stopPropagation(); });
    box.insertBefore(player, box.firstChild);
  } else {
    media.hidden = false;
  }
  document.getElementById("lightbox-img").src = src;
  document.getElementById("lightbox-caption").textContent = caption || "";
  LIGHTBOX_EDIT = onEdit || null;
  document.getElementById("lightbox-edit").hidden = !onEdit;
  document.getElementById("lightbox").hidden = false;
}
function closeLightbox() {
  var box = document.getElementById("lightbox");
  var player = box.querySelector("video");
  if (player) player.remove();
  box.hidden = true;
  document.getElementById("lightbox-img").removeAttribute("src");
}

function isVideo(path) {
  return /\.(mp4|webm|mov|m4v)$/i.test(String(path || ""));
}

// Файл уходит телом запроса: base64 раздувал бы видео на треть.
function uploadFile(file) {
  var ext = (file.name.split(".").pop() || "").toLowerCase();
  return apiFetch("/api/upload-raw", {
    method: "POST",
    headers: { "X-Ext": ext, "Content-Type": "application/octet-stream" },
    body: file
  }).then(function (r) { return r.json(); });
}

// Звёздочка сохраняется сразу: это быстрая отметка, а не правка карточки.
function toggleStar(event) {
  if (!requireEdit(function () { toggleStar(event); })) return;
  event.starred = !event.starred;
  render();
  apiFetch("/api/event", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event)
  }).then(function (r) { return r.json(); }).then(function (res) {
    if (!res.ok) { alert(res["ошибка"] || "отметка не сохранилась"); load(); }
  });
}

function unlinkMedia(path) {
  if (!path) return;
  apiFetch("/api/unlink", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: path })
  }).catch(function () { /* файл останется лежать — для пользователя это не ошибка */ });
}

// Своя подсказка вместо системного title: тот ждёт около секунды и обрезается
// прокручиваемым контейнером таблицы.
var TIP = null;
function tipNode() {
  if (!TIP) {
    TIP = el("div", { class: "tip" });
    TIP.hidden = true;
    document.body.appendChild(TIP);
  }
  return TIP;
}
function showTip(text, target) {
  if (!text) return;
  var tip = tipNode();
  tip.textContent = text;
  tip.hidden = false;
  var box = target.getBoundingClientRect();
  var top = box.top - tip.offsetHeight - 8;
  if (top < 4) top = box.bottom + 8;
  var left = Math.min(box.left, window.innerWidth - tip.offsetWidth - 8);
  tip.style.top = Math.round(top) + "px";
  tip.style.left = Math.round(Math.max(8, left)) + "px";
}
function hideTip() { if (TIP) TIP.hidden = true; }
function withTip(node, text) {
  if (!text) return node;
  node.addEventListener("mouseenter", function () { showTip(text, node); });
  node.addEventListener("mouseleave", hideTip);
  return node;
}
window.addEventListener("scroll", hideTip, true);

function allEvents() {
  var out = [];
  var source = taskChatsSelected() ? (STATE.chatTools || {}) : STATE.tools;
  Object.keys(source).forEach(function (t) { out = out.concat(source[t]); });
  return out;
}
function dictValues(field) {
  var bucket = (STATE.dict["поля"] || {})[field];
  if (!bucket) return [];
  return bucket["значения"].map(function (i) { return i["значение"]; }).sort();
}

// ------------------------------------------------------------------- фильтр
// Поиск смотрит во все поля события, а не в часть — иначе «kanban» не находится.
function haystack(e) {
  var parts = [e.description, e.event, e.tool, e.category, typeValues(e).join(" "),
               e.state, STATE_LABEL[e.state] || ""];
  ["c_section", "c_sub_section", "c_element", "status", "measures"].forEach(function (f) {
    parts.push((e[f] || []).join(" "));
  });
  var params = e.params || {};
  Object.keys(params).forEach(function (k) {
    parts.push(k, (params[k] || []).join(" "));
  });
  ["platform", "team", "funnel", "comment", "checked", "owner"].forEach(function (f) {
    parts.push(e[f] || "");
  });
  parts.push(e.impl || "", IMPL_LABEL[e.impl] || "", e.task_url || "",
             e.priority || "", PRIORITY_LABEL[e.priority] || "");
  var dev = e.dev || {};
  parts.push(dev.update_code || "", (dev.test_ids || []).join(" "), dev.eta || "");
  (e.questions || []).forEach(function (q) { parts.push(q.text, q.answer || ""); });
  if (e.legacy) parts.push("старый формат legacy");
  return parts.join(" ").toLowerCase();
}

// Поиск по атрибуту: «type=task», «c_section=project», «p1=isDemo_Y».
// Пустое значение — «поле не заполнено», звёздочка — «заполнено чем угодно».
var FIELD_ALIASES = {
  tool: "tool", category: "category", type: "type", event: "event",
  name: "event", state: "state", "состояние": "state",
  c_section: "c_section", section: "c_section",
  c_sub_section: "c_sub_section", sub_section: "c_sub_section", sub: "c_sub_section",
  c_element: "c_element", element: "c_element",
  status: "status",
  p1: "p1", p2: "p2", p3: "p3", p4: "p4", p5: "p5",
  testid: "test_ids", test_id: "test_ids", test_ids: "test_ids",
  update_code: "update_code", code: "update_code", eta: "eta",
  description: "description", desc: "description",
  legacy: "legacy", review: "review",
  platform: "platform", "фронт": "platform", "бэк": "platform",
  team: "team", "команда": "team",
  funnel: "funnel", "воронка": "funnel",
  comment: "comment", "комментарий": "comment",
  checked: "checked", "проверка": "checked",
  impl: "impl", "реализация": "impl",
  measures: "measures", "мера": "measures", "меры": "measures",
  light: "light", "светофор": "light",
  task: "task_url", task_url: "task_url", "задача": "task_url",
  priority: "priority", "приоритет": "priority",
  owner: "owner", "кто": "owner", "исполнитель": "owner"
};

// type у задач - список, у проектов - строка. Читаем одинаково.
function typeValues(e) {
  return [].concat(e.type || []).filter(Boolean);
}

function fieldValues(e, key) {
  if (key === "type") return typeValues(e);
  if (key === "impl") return e.impl ? [e.impl, IMPL_LABEL[e.impl] || ""] : [];
  if (key === "light") {
    var totals = lightTotals(e);
    return LIGHT_KEYS.filter(function (k) { return totals[k]; })
      .reduce(function (acc, k) { return acc.concat([k, LIGHT_LABEL[k]]); }, []);
  }
  if (key === "task_url") return e.task_url ? [e.task_url] : [];
  if (key === "priority") return e.priority ? [e.priority, PRIORITY_LABEL[e.priority]] : [];
  if (["description", "event", "tool", "category", "type", "state",
       "platform", "team", "funnel", "comment", "checked", "owner"].indexOf(key) >= 0) {
    return e[key] ? [String(e[key])] : [];
  }
  if (["c_section", "c_sub_section", "c_element", "status", "measures"].indexOf(key) >= 0) {
    return e[key] || [];
  }
  if (/^p[1-5]$/.test(key)) return (e.params || {})[key] || [];
  var dev = e.dev || {};
  if (key === "test_ids") return dev.test_ids || [];
  if (key === "update_code") return dev.update_code ? [dev.update_code] : [];
  if (key === "eta") return dev.eta ? [dev.eta] : [];
  if (key === "legacy") return e.legacy ? ["да", "yes"] : ["нет", "no"];
  if (key === "review") {
    return (e.questions || []).map(function (q) { return q.text + " " + (q.answer || ""); });
  }
  return [];
}

function parseTerm(term) {
  var m = term.match(/^([a-z_0-9а-я]+)[=:](.*)$/);
  if (!m || !FIELD_ALIASES[m[1]]) return null;
  return { key: FIELD_ALIASES[m[1]], want: m[2] };
}

// Вертикальная черта — «или»: «project_view|projects_view» найдёт любое из двух,
// «type=task|task_mini» проверит оба значения одного поля.
function matchTerm(e, term) {
  var parsed = parseTerm(term);
  if (!parsed) {
    var hay = haystack(e);
    return term.split("|").some(function (part) {
      return part && hay.indexOf(part) >= 0;
    });
  }
  var values = fieldValues(e, parsed.key);
  return parsed.want.split("|").some(function (want) {
    if (want === "") return values.length === 0;
    if (want === "*") return values.length > 0;
    return values.some(function (v) {
      return String(v).toLowerCase().indexOf(want) >= 0;
    });
  });
}

function matchesQuery(e) {
  // Несколько слов — это И, а не ИЛИ: «задач kanban» сужает, а не расширяет.
  // Пробелы вокруг черты убираем: «a | b» — это одно условие, а не три.
  var query = STATE.filter.q.trim().toLowerCase().replace(/\s*\|\s*/g, "|");
  var terms = query.split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  return terms.every(function (t) { return matchTerm(e, t); });
}

// Что реально встречается в этом поле — для подсказки, когда поиск пуст.
function realValues(key) {
  var seen = {};
  allEvents().forEach(function (e) {
    fieldValues(e, key).forEach(function (v) { seen[v] = (seen[v] || 0) + 1; });
  });
  return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a]; });
}

function openQuestions(e) {
  return (e.questions || []).filter(function (q) { return !q.done; });
}
function needsReview(e) { return openQuestions(e).length > 0; }

function matchesFlag(e) {
  var f = STATE.filter;
  if (f.starred && !e.starred) return false;
  if (f.review && !needsReview(e)) return false;
  if (f.legacy && !e.legacy) return false;
  return true;
}

function visible() {
  return allEvents().filter(function (e) {
    return matchesCols(e) && matchesFlag(e) && matchesQuery(e);
  });
}

// Счётчик грани считается без неё самой, иначе у выбранного пункта всегда всё,
// а у остальных — нули, и непонятно, куда вообще можно переключиться.
function poolFor(facet) {
  return poolExcept(facet === "review" || facet === "legacy" ? null : facet);
}

function hasFilters() {
  var f = STATE.filter;
  return Boolean(Object.keys(f.cols).length || f.starred || f.review || f.legacy || f.q.trim());
}

function resetFilters() {
  STATE.filter = { cols: {}, starred: false, review: false, legacy: false, q: "" };
  document.getElementById("search").value = "";
  render();
}

// ----------------------------------------------------------------- отрисовка
function renderSide() {
  var tools = document.getElementById("tools");
  var states = document.getElementById("states");
  tools.textContent = ""; states.textContent = "";

  function button(label, count, active, onclick, cls, tone) {
    return el("button", { class: (cls || "side-btn") + (active ? " on" : ""), onclick: onclick }, [
      el("span", { class: "with-dot" }, [
        tone ? el("i", { class: "dot " + tone }) : null,
        el("span", { text: label })
      ]),
      el("span", { class: "n", text: String(count) })
    ]);
  }
  var toolPool = [].concat.apply([], Object.keys(STATE.tools).map(function (t) { return STATE.tools[t]; })).filter(function (e) {
    return matchesCols(e, "tool") && matchesFlag(e) && matchesQuery(e);
  });
  var chatPool = [].concat.apply([], Object.keys(STATE.chatTools || {}).map(function (t) { return STATE.chatTools[t]; })).filter(function (e) {
    return matchesCols(e, "tool") && matchesFlag(e) && matchesQuery(e);
  });
  var byTool = {};
  toolPool.forEach(function (e) { byTool[e.tool] = (byTool[e.tool] || 0) + 1; });

  tools.appendChild(button("Все инструменты", toolPool.length, !pickedFor("tool").length,
    function () { delete STATE.filter.cols.tool; render(); }));
  Object.keys(STATE.tools).sort().forEach(function (t) {
    tools.appendChild(button(t, byTool[t] || 0, pickedFor("tool")[0] === t, function () {
      setPicked("tool", t); render();
    }));
    if (t === "tasks" && STATE.typeList) {
      tools.appendChild(button(TASK_CHATS_LABEL,
        chatPool.length,
        pickedFor("tool")[0] === TASK_CHATS_FILTER, function () {
          setPicked("tool", TASK_CHATS_FILTER); render();
        }));
    }
  });

  var tasksNav = document.getElementById("tasks");
  tasksNav.textContent = "";
  var taskPool = poolFor("task");
  var byTask = {};
  var without = 0;
  taskPool.forEach(function (e) {
    if (e.task_url) byTask[e.task_url] = (byTask[e.task_url] || 0) + 1;
    else without += 1;
  });
  var taskUrls = Object.keys(byTask).sort(function (a, b) {
    return byTask[b] - byTask[a] || taskLabel(a).localeCompare(taskLabel(b));
  });
  if (!taskUrls.length) {
    tasksNav.appendChild(el("div", { class: "side-empty",
      text: "Ни одно событие пока не привязано к задаче." }));
  }
  taskUrls.forEach(function (url) {
    tasksNav.appendChild(button(taskLabel(url), byTask[url],
      pickedFor("task_url")[0] === url,
      function () { setPicked("task_url", url); render(); }));
  });
  if (without) {
    tasksNav.appendChild(button("без задачи", without,
      pickedFor("task_url")[0] === EMPTY_VALUE,
      function () { setPicked("task_url", EMPTY_VALUE); render(); }));
  }

  var prios = document.getElementById("prios");
  prios.textContent = "";
  var prioCounts = {};
  poolFor("priority").forEach(function (e) {
    if (e.priority) prioCounts[e.priority] = (prioCounts[e.priority] || 0) + 1;
  });
  PRIORITY_STATES.forEach(function (key) {
    prios.appendChild(button(PRIORITY_LABEL[key], prioCounts[key] || 0,
      pickedFor("priority")[0] === key, function () {
        setPicked("priority", key); render();
      }, null, toneClass(PRIORITY_TONE, key)));
  });

  var impls = document.getElementById("impls");
  impls.textContent = "";
  var implCounts = {};
  poolFor("impl").forEach(function (e) {
    if (e.impl) implCounts[e.impl] = (implCounts[e.impl] || 0) + 1;
  });
  IMPL_STATES.forEach(function (key) {
    impls.appendChild(button(IMPL_LABEL[key], implCounts[key] || 0,
      pickedFor("impl")[0] === key, function () {
        setPicked("impl", key); render();
      }, null, toneClass(IMPL_TONE, key)));
  });

  var counts = {};
  poolFor("state").forEach(function (e) { counts[e.state] = (counts[e.state] || 0) + 1; });
  STATE.states.forEach(function (s) {
    states.appendChild(button(STATE_LABEL[s] || s, counts[s] || 0,
      pickedFor("state")[0] === s, function () {
        setPicked("state", s); render();
      }, null, toneClass(STATE_TONE, s)));
  });

  var flags = document.getElementById("flags");
  flags.textContent = "";
  flags.appendChild(button("★ Важные",
    poolFor("starred").filter(function (e) { return e.starred; }).length,
    STATE.filter.starred, function () {
      STATE.filter.starred = !STATE.filter.starred; render();
    }, "chip-btn"));
  flags.appendChild(button("Требуют разбора",
    poolFor("review").filter(needsReview).length, STATE.filter.review, function () {
      STATE.filter.review = !STATE.filter.review; render();
    }, "chip-btn"));
  flags.appendChild(button("Старый формат имени",
    poolFor("legacy").filter(function (e) { return e.legacy; }).length,
    STATE.filter.legacy, function () {
      STATE.filter.legacy = !STATE.filter.legacy; render();
    }, "chip-btn"));
}

// Все поля спеки видны прямо в таблице — как в Excel, только без ячеек.
var COLUMNS = [
  { key: "description", label: "Описание", kind: "desc", group: "Сценарий" },
  { key: "event", label: "event", kind: "name", group: "Сценарий" },
  { key: "priority", label: "приоритет", kind: "priority", group: "Сценарий" },
  { key: "impl", label: "состояние реализации", kind: "impl", group: "Состояния" },
  { key: "light", label: "светофор", kind: "light", group: "Состояния" },
  { key: "state", label: "состояние события", kind: "state", group: "Состояния" },
  { key: "owner", label: "кто сейчас занимается", kind: "plain", group: "Состояния" },
  { key: "task_url", label: "задача в Битрикс24", kind: "link", group: "Состояния" },
  { key: "platform", label: "фронт/бэк", kind: "plain", group: "Кто и как" },
  { key: "team", label: "команда", kind: "plain", group: "Кто и как" },
  { key: "comment", label: "комментарий", kind: "text", group: "Кто и как" },
  { key: "checked", label: "проверка разметки", kind: "text", group: "Кто и как" },
  { key: "measures", label: "меры, в которых используется", kind: "chips", group: "Кто и как" },
  { key: "tool", label: "tool", kind: "plain", group: "Событие" },
  { key: "category", label: "category", kind: "plain", group: "Событие" },
  { key: "type", label: "type", kind: "plain", group: "Событие" },
  { key: "c_section", label: "c_section", kind: "chips", group: "Контекст" },
  { key: "c_sub_section", label: "c_sub_section", kind: "chips", group: "Контекст" },
  { key: "c_element", label: "c_element", kind: "chips", group: "Контекст" },
  { key: "status", label: "status", kind: "chips", group: "Контекст" },
  { key: "p1", label: "p1", kind: "param", group: "Параметры" },
  { key: "p2", label: "p2", kind: "param", group: "Параметры" },
  { key: "p3", label: "p3", kind: "param", group: "Параметры" },
  { key: "p4", label: "p4", kind: "param", group: "Параметры" },
  { key: "p5", label: "p5", kind: "param", group: "Параметры" },
  { key: "update_code", label: "код обновления", kind: "dev", group: "Разработка" },
  { key: "test_ids", label: "testId", kind: "devchips", group: "Разработка" },
  { key: "eta", label: "выход", kind: "dev", group: "Разработка" },
  { key: "images", label: "скриншоты", kind: "shots", group: "Материалы" }
];

function startsGroup(index) {
  return index === 0 || COLUMNS[index - 1].group !== COLUMNS[index].group;
}

// Описание и имя события примерзают слева: по ним опознают строку.
function stickyClass(col) {
  if (col.kind === "desc") return "col-desc ";
  if (col.kind === "name") return "col-event ";
  return "";
}

function startsGroup(index) {
  return index === 0 || COLUMNS[index - 1].group !== COLUMNS[index].group;
}

// Описание и имя события примерзают слева: по ним опознают строку.
function stickyClass(col) {
  if (col.kind === "desc") return "col-desc ";
  if (col.kind === "name") return "col-event ";
  return "";
}

// Из ссылки на задачу вытаскиваем номер: в таблице он читается лучше URL.
function taskLabel(url) {
  var byView = String(url).match(/task\/view\/(\d+)/);
  if (byView) return "№" + byView[1];
  var trailing = String(url).match(/(\d{3,})\/?$/);
  return trailing ? "№" + trailing[1] : "открыть";
}

function chipCell(values, notes, lights) {
  var list = values || [];
  if (!list.length) return el("td", { class: "muted-cell", text: "—" });
  // Не больше трёх значений в строке, иначе колонка растягивает всю таблицу.
  return el("td", { class: "chips-cell" }, [
    el("div", { class: "chip-grid" }, list.map(function (v) {
      var note = notes && notes[v];
      if (!lights) {
        return withTip(el("span", { class: "tag" + (note ? " noted" : ""), text: v }), note);
      }
      // Под светофором жёлтый занят цветом состояния, поэтому комментарий — пунктиром.
      var light = lights[v] || "grey";
      return withTip(el("span", {
        class: "tag lit lt-" + light + (note ? " has-note" : ""), text: v
      }), LIGHT_LABEL[light] + (note ? " — " + note : ""));
    }))
  ]);
}

function lightSummaryCell(e) {
  var totals = lightTotals(e);
  var shown = LIGHT_KEYS.filter(function (k) { return totals[k]; });
  if (!shown.length) return el("td", { class: "muted-cell", text: "—" });
  return el("td", { class: "nowrap" }, shown.map(function (k) {
    return withTip(el("span", { class: "lsum" }, [
      el("i", { class: "dot " + LIGHT_TONE[k] }),
      el("span", { text: String(totals[k]) })
    ]), LIGHT_LABEL[k] + ": " + totals[k] + " знач.");
  }));
}

function cellFor(col, e) {
  if (col.kind === "desc") {
    var star = el("button", {
      type: "button",
      class: "star" + (e.starred ? " on" : ""),
      text: e.starred ? "★" : "☆",
      onclick: function (ev) { ev.stopPropagation(); toggleStar(e); }
    });
    withTip(star, e.starred ? "Снять отметку" : "Отметить как важное");
    return el("td", { class: "col-desc" }, [
      el("div", { class: "desc-inner" }, [
        star,
        el("div", { text: e.description || "без описания" }),
        openQuestions(e).length
          ? el("span", { class: "tag warn", text: "вопросов: " + openQuestions(e).length })
          : null
      ])
    ]);
  }
  if (col.kind === "name") {
    return el("td", { class: "mono nowrap col-event" }, [
      el("span", { text: e.event }),
      e.legacy ? el("span", { class: "tag dim", title: "имя записано в старом формате, грамматика к нему не применяется", text: "старый формат" }) : null
    ]);
  }
  if (col.key === "type" && STATE.typeList) {
    return chipCell(typeValues(e), (e.notes || {}).type, litFor(e, "type"));
  }
  if (col.kind === "plain") {
    var plain = Array.isArray(e[col.key]) ? e[col.key].join(", ") : e[col.key];
    return el("td", { class: plain ? "cell-plain" : "muted-cell", text: plain || "—" });
  }
  if (col.kind === "text") {
    return el("td", { class: e[col.key] ? "prose" : "muted-cell", text: e[col.key] || "—" });
  }
  var notes = (e.notes || {})[col.key];
  if (col.kind === "chips") return chipCell(e[col.key], notes, litFor(e, col.key));
  if (col.kind === "light") return lightSummaryCell(e);
  if (col.kind === "param") return chipCell((e.params || {})[col.key], notes);
  if (col.kind === "shots") {
    var shots = e.images || [];
    if (!shots.length) return el("td", { class: "muted-cell", text: "—" });
    return el("td", { class: "nowrap" }, shots.map(function (img) {
      if (isVideo(img.file)) {
        return withTip(el("span", {
          class: "tag video-tag", text: "▶ видео",
          onclick: function (ev) {
            ev.stopPropagation();
            openLightbox(appUrl(img.file), img.caption);
          }
        }), img.caption || "видео");
      }
      return withTip(el("img", {
        class: "thumb", src: appUrl(img.file),
        onclick: function (ev) {
          ev.stopPropagation();
          openLightbox(appUrl(img.file), img.caption);
        }
      }), img.caption || "скриншот");
    }));
  }
  if (col.kind === "link") {
    var url = e.task_url;
    if (!url) return el("td", { class: "muted-cell", text: "—" });
    var link = el("a", {
      class: "task-link", href: url, target: "_blank", rel: "noreferrer",
      text: taskLabel(url),
      onclick: function (ev) { ev.stopPropagation(); }
    });
    return el("td", { class: "nowrap" }, [withTip(link, url)]);
  }
  if (col.kind === "priority") {
    if (!e.priority) return el("td", { class: "muted-cell", text: "—" });
    return el("td", { class: "nowrap" }, [
      el("span", { class: "state " + toneClass(PRIORITY_TONE, e.priority),
                   text: PRIORITY_LABEL[e.priority] || e.priority })
    ]);
  }
  if (col.kind === "impl") {
    if (!e.impl) return el("td", { class: "muted-cell", text: "—" });
    return el("td", { class: "nowrap" }, [
      el("span", { class: "state " + toneClass(IMPL_TONE, e.impl),
                   text: IMPL_LABEL[e.impl] || e.impl })
    ]);
  }
  if (col.kind === "devchips") return chipCell((e.dev || {})[col.key], notes);
  if (col.kind === "dev") {
    var v = (e.dev || {})[col.key];
    return el("td", { class: v ? "cell-plain" : "muted-cell", text: v || "—" });
  }
  return el("td", { class: "nowrap" }, [
    el("span", { class: "state " + toneClass(STATE_TONE, e.state) +
                        (e.state === "broken" ? " alarm" : ""),
                 text: STATE_LABEL[e.state] || e.state })
  ]);
}

function renderTable() {
  var head = document.getElementById("head");
  head.textContent = "";
  head.appendChild(el("tr", {}, COLUMNS.map(function (c, i) {
    var picked = pickedFor(c.key);
    var trigger = el("button", {
      type: "button",
      class: "col-filter" + (picked.length ? " on" : ""),
      text: picked.length ? "▼ " + picked.length : "▼",
      onclick: function (ev) { ev.stopPropagation(); openColumnFilter(c, trigger); }
    });
    withTip(trigger, picked.length
      ? "Фильтр: " + picked.map(function (v) { return valueLabel(c.key, v); }).join(", ")
      : "Отобрать значения в колонке «" + c.label + "»");
    return el("th", {
      class: stickyClass(c) + (startsGroup(i) ? "grp-start" : ""),
      title: c.group
    }, [
      el("div", { class: "th-inner" }, [el("span", { text: c.label }), trigger])
    ]);
  })));

  var rows = document.getElementById("rows");
  rows.textContent = "";
  var list = visible();
  var f = STATE.filter;
  document.getElementById("result-count").textContent = list.length + " событий";
  document.getElementById("reset").hidden = !hasFilters();

  var empty = document.getElementById("empty");
  empty.hidden = list.length > 0;
  if (!list.length) {
    var active = [];
    if (f.q.trim()) active.push("поиск «" + f.q.trim() + "»");
    Object.keys(f.cols).forEach(function (key) {
      var names = f.cols[key].map(function (v) { return valueLabel(key, v); });
      active.push(key + ": " + names.join(" или "));
    });
    if (f.starred) active.push("только отмеченные звёздочкой");
    if (f.review) active.push("только требующие разбора");
    if (f.legacy) active.push("только старый формат имени");

    // Если искали по атрибуту — покажем, какие значения там вообще бывают.
    var hint = "";
    f.q.trim().toLowerCase().split(/\s+/).filter(Boolean).forEach(function (t) {
      var parsed = parseTerm(t);
      if (hint || !parsed || !parsed.want || parsed.want === "*") return;
      var vals = realValues(parsed.key).slice(0, 8);
      if (vals.length) {
        hint = " В поле " + parsed.key + " встречаются: " + vals.join(", ") +
               (realValues(parsed.key).length > 8 ? " и другие." : ".");
      }
    });
    empty.textContent = (active.length
      ? "Ничего не нашлось. Действуют фильтры: " + active.join(", ") + "."
      : "Событий пока нет.") + hint;
  }

  list.sort(function (a, b) {
    if (!a.starred !== !b.starred) return a.starred ? -1 : 1;
    return (a.tool + a.event).localeCompare(b.tool + b.event);
  });
  list.forEach(function (e) {
    rows.appendChild(el("tr", {
      onclick: function (ev) {
        if (!isPlainClick(ev)) return;
        var td = ev.target && ev.target.closest ? ev.target.closest("td") : null;
        openSheet(e, td ? td.getAttribute("data-col") : null);
      }
    }, COLUMNS.map(function (c, i) {
      var td = cellFor(c, e);
      td.setAttribute("data-col", c.key);
      if (startsGroup(i)) td.className = (td.className + " grp-start").trim();
      return td;
    })));
  });

  var need = allEvents().filter(needsReview).length;
  document.getElementById("counts").textContent =
    allEvents().length + " событий · " + need + " требуют разбора";
}

// --------------------------------------------------------------- сводка
// Полосы — это величины одной меры, поэтому одна шкала на блок.
// Цвет статуса всегда идёт вместе с подписью и числом, никогда один.
function kpi(number, caption) {
  return el("div", { class: "kpi" }, [
    el("div", { class: "num", text: String(number) }),
    el("div", { class: "cap", text: caption })
  ]);
}

function barRow(label, value, total, tone, onClick, dot) {
  var share = total ? Math.round((value / total) * 100) : 0;
  var fill = el("div", { class: "bar-fill " + (tone || "plain") });
  fill.style.width = (total ? Math.max(value ? 2 : 0, (value / total) * 100) : 0) + "%";
  var row = el("div", { class: "bar-row" + (onClick ? " clickable" : "") }, [
    el("span", { class: "bar-label" }, [
      dot ? el("i", { class: "dot " + dot }) : null,
      el("span", { text: label })
    ]),
    el("div", { class: "bar-track" }, [fill]),
    el("span", { class: "bar-value", text: value + "  ·  " + share + "%" })
  ]);
  withTip(row, label + ": " + value + " из " + total + " (" + share + "%)");
  if (onClick) row.addEventListener("click", onClick);
  return row;
}

function block(title, rows, note) {
  return el("div", { class: "sum-block" }, [
    el("h3", { text: title }),
    el("div", {}, rows),
    note ? el("div", { class: "sum-note", text: note }) : null
  ]);
}

function renderSummary() {
  var box = document.getElementById("summary");
  box.textContent = "";
  var all = allEvents();
  var total = all.length;
  var openQ = all.reduce(function (n, e) { return n + openQuestions(e).length; }, 0);

  box.appendChild(el("div", { class: "sum-block" }, [
    el("div", { class: "kpi-row" }, [
      kpi(total, "событий в спеке"),
      kpi(all.filter(needsReview).length, "событий с открытыми вопросами"),
      kpi(openQ, "открытых вопросов всего"),
      kpi(all.filter(function (e) { return e.legacy; }).length, "имён в старом формате"),
      kpi(all.filter(function (e) { return (e.images || []).length; }).length, "со скриншотами")
    ])
  ]));

  function countBy(field) {
    var map = {};
    all.forEach(function (e) { map[e[field] || ""] = (map[e[field] || ""] || 0) + 1; });
    return map;
  }

  var implCount = countBy("impl");
  box.appendChild(block("Состояние реализации", IMPL_STATES.map(function (key) {
    return barRow(IMPL_LABEL[key], implCount[key] || 0, total, toneClass(IMPL_TONE, key),
      function () { setPicked("impl", key); showSummary(false); render(); },
      toneClass(IMPL_TONE, key));
  }).concat([
    barRow("не указано", implCount[""] || 0, total, "t0", null, "t0")
  ]), "Клик по строке отфильтрует таблицу."));

  if (STATE.lights) {
    var lt = { green: 0, yellow: 0, red: 0, grey: 0 };
    all.forEach(function (e) {
      var t = lightTotals(e);
      LIGHT_KEYS.forEach(function (k) { lt[k] += t[k]; });
    });
    var ltTotal = lt.green + lt.yellow + lt.red + lt.grey;
    box.appendChild(block("Светофор по значениям контекста", LIGHT_KEYS.map(function (k) {
      return barRow(LIGHT_LABEL[k], lt[k], ltTotal, LIGHT_TONE[k],
        function () { setPicked("light", k); showSummary(false); render(); }, LIGHT_TONE[k]);
    }), "Считаются значения type, c_section, c_sub_section, c_element во всех строках. " +
        "Клик отберёт строки, где есть такой цвет."));
  }

  var stateCount = countBy("state");
  box.appendChild(block("Состояние события", STATE.states.map(function (key) {
    return barRow(STATE_LABEL[key] || key, stateCount[key] || 0, total,
      toneClass(STATE_TONE, key),
      function () { setPicked("state", key); showSummary(false); render(); },
      toneClass(STATE_TONE, key));
  })));

  var byTool = {};
  all.forEach(function (e) { byTool[e.tool] = (byTool[e.tool] || 0) + 1; });
  box.appendChild(block("Инструменты", Object.keys(byTool).sort(function (a, b) {
    return byTool[b] - byTool[a];
  }).map(function (tool) {
    return barRow(tool, byTool[tool], total, null,
      function () { setPicked("tool", tool); showSummary(false); render(); });
  })));

  var FILLED = [
    ["команда", function (e) { return !!e.team; }],
    ["фронт/бэк", function (e) { return !!e.platform; }],
    ["c_element", function (e) { return (e.c_element || []).length > 0; }],
    ["хотя бы один p*", function (e) { return Object.keys(e.params || {}).some(function (k) {
      return (e.params[k] || []).length; }); }],
    ["testId", function (e) { return ((e.dev || {}).test_ids || []).length > 0; }],
    ["дата выхода", function (e) { return !!(e.dev || {}).eta; }]
  ];
  box.appendChild(block("Заполненность полей", FILLED.map(function (pair) {
    return barRow(pair[0], all.filter(pair[1]).length, total, null);
  }), "Показывает, где спека пока тонкая."));
}

function showSummary(on) {
  document.getElementById("summary").hidden = !on;
  document.getElementById("table-wrap").hidden = on;
  document.getElementById("toggle-summary").textContent = on ? "К таблице" : "Сводка";
}

// Показывает, сколько таблицы ещё за краем экрана.
function syncScrollbar() {
  var wrap = document.getElementById("table-wrap");
  var track = document.getElementById("hscroll");
  var thumb = document.getElementById("hscroll-thumb");
  if (!wrap || wrap.hidden) { track.hidden = true; return; }
  var total = wrap.scrollWidth;
  var view = wrap.clientWidth;
  if (total <= view + 1) { track.hidden = true; return; }
  track.hidden = false;
  thumb.style.width = Math.max(6, (view / total) * 100) + "%";
  thumb.style.left = (wrap.scrollLeft / total) * 100 + "%";
}

function wireScrollbar() {
  var wrap = document.getElementById("table-wrap");
  var track = document.getElementById("hscroll");
  wrap.addEventListener("scroll", syncScrollbar);
  window.addEventListener("resize", syncScrollbar);

  function scrollToPoint(clientX) {
    var box = track.getBoundingClientRect();
    var total = wrap.scrollWidth;
    var view = wrap.clientWidth;
    if (total <= view) return;
    // Курсор держит середину ползунка, поэтому вычитаем его половину,
    // а остаток раскладываем на полезную часть дорожки — иначе край недостижим.
    var thumbShare = view / total;
    var usable = 1 - thumbShare;
    var at = ((clientX - box.left) / box.width - thumbShare / 2) / (usable || 1);
    wrap.scrollLeft = Math.min(1, Math.max(0, at)) * (total - view);
  }
  var dragging = false;
  track.addEventListener("pointerdown", function (ev) {
    dragging = true;
    track.setPointerCapture(ev.pointerId);
    scrollToPoint(ev.clientX);
  });
  track.addEventListener("pointermove", function (ev) {
    if (dragging) scrollToPoint(ev.clientX);
  });
  track.addEventListener("pointerup", function () { dragging = false; });
  track.addEventListener("pointercancel", function () { dragging = false; });
}

function render() {
  STATE.dict = taskChatsSelected() ? (STATE.chatDict || {}) : (STATE.baseDict || STATE.dict);
  if (STATE.baseTitle) {
    var title = STATE.baseTitle + (taskChatsSelected() ? " · " + TASK_CHATS_LABEL : "");
    document.title = title;
    document.querySelector(".brand").textContent = title;
  }
  renderSide();
  renderTable();
  if (!document.getElementById("summary").hidden) renderSummary();
  syncScrollbar();
}

// --------------------------------------------------------------- форма
function chipEditor(field, values, onChange, notes, lights) {
  var wrap = el("div", {});
  var chips = el("div", { class: "chips" });
  var noteBox = el("div", {});
  var editing = null;

  function editNote(value) {
    if (!requireEdit(reopenSheetAfterLogin)) return;
    editing = value;
    noteBox.textContent = "";
    if (value === null) { redraw(); return; }
    var input = el("input", { placeholder: "комментарий к этому значению" });
    input.value = (notes && notes[value]) || "";
    input.addEventListener("input", function () {
      if (!notes) return;
      var text = input.value.trim();
      if (text) notes[value] = text; else delete notes[value];
    });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); editNote(null); }
    });
    noteBox.appendChild(el("div", { class: "note-edit" }, [
      el("span", { class: "note-for", text: value }),
      input,
      el("button", {
        type: "button", class: "ghost", text: "Готово",
        onclick: function () { editNote(null); }
      })
    ]));
    input.focus();
  }

  // Клик по кружку: не проверено → работает → частично → не работает → не проверено.
  function cycleLight(v) {
    if (!requireEdit(reopenSheetAfterLogin)) return;
    var next = LIGHT_CYCLE[(LIGHT_CYCLE.indexOf(lights[v] || "grey") + 1) % LIGHT_CYCLE.length];
    if (next === "grey") delete lights[v]; else lights[v] = next;
    hideTip();
    redraw();
  }

  function redraw() {
    chips.textContent = "";
    values.forEach(function (v, i) {
      var note = notes && notes[v];
      var light = lights ? (lights[v] || "grey") : null;
      var cls = lights
        ? "chip lit lt-" + light + (note ? " has-note" : "")
        : "chip" + (note ? " noted" : "");
      chips.appendChild(el("span", { class: cls + (editing === v ? " editing" : "") }, [
        lights ? withTip(el("button", {
          type: "button", class: "light-dot",
          onclick: function () { cycleLight(v); }
        }), LIGHT_LABEL[light] + " — нажми, чтобы сменить") : null,
        withTip(el("span", {
          class: "chip-label", text: v,
          onclick: function () { editNote(editing === v ? null : v); }
        }), note || "нажми, чтобы добавить комментарий"),
        el("button", { type: "button", title: "убрать", text: "×", onclick: function () {
          values.splice(i, 1);
          if (notes) delete notes[v];
          if (lights) delete lights[v];
          onChange(values); redraw();
        } })
      ]));
    });
  }
  redraw();
  var listId = "dl_" + field;
  var input = el("input", { list: listId, placeholder: "добавить значение и Enter" });
  input.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    var v = input.value.trim();
    if (v && values.indexOf(v) < 0) { values.push(v); onChange(values); redraw(); }
    input.value = "";
  });
  var datalist = el("datalist", { id: listId });
  dictValues(field).forEach(function (v) { datalist.appendChild(el("option", { value: v })); });
  wrap.appendChild(chips); wrap.appendChild(noteBox);
  wrap.appendChild(input); wrap.appendChild(datalist);
  return wrap;
}

// В русском тексте любое латинское слово — технический токен. Выносим его
// отдельной плашкой, иначе «переделать event - welcome_points button» не читается.
var CYRILLIC = /[Ѐ-ӿ]/;
var TOKEN = /[A-Za-z][A-Za-z0-9_]{2,}/g;

function markupText(text) {
  var frag = document.createDocumentFragment();
  var src = String(text || "");
  if (!CYRILLIC.test(src)) {
    frag.appendChild(document.createTextNode(src));
    return frag;
  }
  var last = 0;
  var match;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(src)) !== null) {
    if (match.index > last) {
      frag.appendChild(document.createTextNode(src.slice(last, match.index)));
    }
    frag.appendChild(el("code", { class: "tok", text: match[0] }));
    last = match.index + match[0].length;
  }
  if (last < src.length) frag.appendChild(document.createTextNode(src.slice(last)));
  return frag;
}

// Текст вопроса правится по клику: формулировку часто уточняют уже после того,
// как вопрос заведён.
function questionLine(q, redraw) {
  var line = el("div", { class: "qline", title: "нажми, чтобы изменить формулировку" });
  line.appendChild(markupText(q.text));
  line.addEventListener("click", function () {
    if (!requireEdit(function () { reopenSheetAfterLogin(); })) return;
    var area = el("textarea", { class: "qedit", rows: 2 });
    area.value = q.text;
    var closed = false;
    function commit() {
      if (closed) return;
      closed = true;
      var text = area.value.trim();
      if (text) q.text = text;
      redraw();
    }
    area.addEventListener("blur", commit);
    area.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { closed = true; ev.preventDefault(); redraw(); }
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); commit(); }
    });
    line.replaceWith(area);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  });
  return line;
}

// Бэклог вопросов по событию: часть завёл импорт, остальные можно дописать руками.
function questionBlock(draft) {
  var wrap = el("div", { class: "qblock" });
  var showDone = false;

  function redraw() {
    wrap.textContent = "";
    var open = draft.questions.filter(function (q) { return !q.done; });
    var done = draft.questions.filter(function (q) { return q.done; });

    wrap.appendChild(el("div", { class: "qhead" }, [
      el("strong", { text: "Вопросы по событию" }),
      open.length
        ? el("span", { class: "qcount", text: String(open.length) })
        : el("span", { class: "qcount ok", text: "все закрыты" }),
      done.length
        ? el("button", {
            type: "button", class: "ghost qtoggle", "data-view-action": "true",
            text: showDone ? "скрыть закрытые" : "закрытые: " + done.length,
            onclick: function () { showDone = !showDone; redraw(); }
          })
        : null
    ]));

    var shown = showDone ? open.concat(done) : open;
    if (!shown.length) {
      wrap.appendChild(el("div", { class: "qempty", text: "Открытых вопросов нет." }));
    }
    shown.forEach(function (q) {
      var box = el("input", { type: "checkbox" });
      box.checked = !!q.done;
      box.addEventListener("change", function () { q.done = box.checked; redraw(); });

      var answer = el("input", { class: "qanswer", placeholder: "ответ или решение" });
      answer.value = q.answer || "";
      answer.addEventListener("input", function () { q.answer = answer.value; });

      wrap.appendChild(el("div", { class: "qitem" + (q.done ? " done" : "") }, [
        box,
        el("div", { class: "qtext" }, [
          questionLine(q, redraw),
          el("div", { class: "src", text: q.source || "вручную" }),
          answer
        ]),
        el("button", {
          type: "button", class: "ghost danger qdrop", text: "×", title: "удалить вопрос",
          onclick: function () {
            draft.questions.splice(draft.questions.indexOf(q), 1);
            redraw();
          }
        })
      ]));
    });

    var input = el("input", { placeholder: "новый вопрос по этому событию" });
    function add() {
      var text = input.value.trim();
      if (!text) return;
      draft.questions.push({ text: text, source: "вручную", done: false, answer: "" });
      input.value = "";
      redraw();
    }
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); add(); }
    });
    wrap.appendChild(el("div", { class: "qadd" }, [
      input, el("button", { type: "button", class: "ghost", text: "Добавить", onclick: add })
    ]));
    if (!AUTH_STATE.can_edit) {
      wrap.querySelectorAll("input").forEach(function (control) {
        if (control.type === "checkbox") control.disabled = true;
        else control.readOnly = true;
      });
      wrap.querySelectorAll("button:not([data-view-action])").forEach(function (control) {
        control.disabled = true;
      });
    }
  }

  redraw();
  return wrap;
}

function field(label, control, key) {
  if (key) {
    var focusable = control.matches && control.matches("input,textarea,select")
      ? control
      : (control.querySelector && control.querySelector("input,textarea,select"));
    if (focusable) focusable.setAttribute("data-field", key);
  }
  return el("div", { class: "field" }, [el("label", { text: label }), control]);
}

function openSheet(event, focusKey) {
  if (!event.id && !requireEdit(function () { openSheet(event, focusKey); })) return;
  var draft = JSON.parse(JSON.stringify(event));
  draft.params = draft.params || {};
  STATE.open = draft;
  STATE.openArea = taskChatsSelected() ? "task_chats" : "main";
  document.getElementById("sheet").hidden = false;
  document.getElementById("sheet-title").textContent = draft.id ? draft.event : "Новое событие";
  document.getElementById("save-note").textContent = draft.source
    ? "из файла: лист " + draft.source.sheet + ", строка " + draft.source.row : "";

  var body = document.getElementById("sheet-body");
  body.textContent = "";

  draft.notes = draft.notes || {};
  draft.questions = draft.questions || [];
  body.appendChild(questionBlock(draft));
  var desc = el("textarea", { rows: 2 });
  desc.value = draft.description || "";
  desc.addEventListener("input", function () { draft.description = desc.value; });
  body.appendChild(field("Описание сценария", desc, "description"));

  var name = el("input", {});
  name.value = draft.event || "";
  name.addEventListener("input", function () {
    draft.event = name.value.trim();
    draft.name_source = "manual";
  });
  var nameHint = el("div", { class: "note" });
  var suggest = el("button", {
    type: "button", class: "ghost", text: "Предложить",
    onclick: function () {
      var flat = [];
      PARAM_FIELDS.forEach(function (p) { flat = flat.concat(draft.params[p] || []); });
      var result = analyzeName(draft.description, flat);
      if (!result.name) {
        nameHint.className = "note warn-note";
        nameHint.textContent = result.why;
        return;
      }
      name.value = result.name;
      draft.event = result.name;
      draft.name_source = "generated";
      nameHint.className = "note";
      nameHint.textContent = "Собрал из описания: " + result.parts.join(", ") +
        ". Если не нравится — просто перепиши руками.";
    }
  });
  body.appendChild(field("Имя события", el("div", {}, [
    el("div", { class: "name-row" }, [name, suggest]),
    nameHint,
    draft.legacy ? el("div", { class: "note",
      text: "Старый формат записи. Грамматика к такому имени не применяется — это нормально, переименование порвало бы историю в ClickHouse." }) : null
  ]), "event"));

  var grid = el("div", { class: "row2" });
  var singles = [["tool", "Инструмент"], ["category", "Категория"]];
  if (!STATE.typeList) singles.push(["type", "Тип сущности"]);
  singles.forEach(function (pair) {
    var input = el("input", { list: "dl_" + pair[0] + "_s" });
    input.value = draft[pair[0]] || "";
    input.addEventListener("input", function () { draft[pair[0]] = input.value.trim(); });
    var dl = el("datalist", { id: "dl_" + pair[0] + "_s" });
    dictValues(pair[0]).forEach(function (v) { dl.appendChild(el("option", { value: v })); });
    grid.appendChild(field(pair[1], el("div", {}, [input, dl]), pair[0]));
  });
  var state = el("select", {});
  STATE.states.forEach(function (s) {
    var opt = el("option", { value: s, text: STATE_LABEL[s] || s });
    if (s === draft.state) opt.selected = true;
    state.appendChild(opt);
  });
  function paintState() {
    state.className = "toned " + toneClass(STATE_TONE, state.value);
  }
  state.addEventListener("change", function () { draft.state = state.value; paintState(); });
  paintState();
  grid.appendChild(field("Состояние", state, "state"));

  var priority = el("select", {});
  priority.appendChild(el("option", { value: "", text: "— не указан —" }));
  PRIORITY_STATES.forEach(function (key) {
    var option = el("option", { value: key, text: PRIORITY_LABEL[key] });
    if (key === draft.priority) option.selected = true;
    priority.appendChild(option);
  });
  function paintPriority() {
    priority.className = draft.priority ? "toned " + toneClass(PRIORITY_TONE, draft.priority) : "";
  }
  priority.addEventListener("change", function () {
    draft.priority = priority.value; paintPriority();
  });
  paintPriority();
  grid.appendChild(field("Приоритет", priority, "priority"));

  var impl = el("select", {});
  impl.appendChild(el("option", { value: "", text: "— не указано —" }));
  IMPL_STATES.forEach(function (key) {
    var option = el("option", { value: key, text: IMPL_LABEL[key] });
    if (key === draft.impl) option.selected = true;
    impl.appendChild(option);
  });
  function paintImpl() {
    impl.className = impl.value ? "toned " + toneClass(IMPL_TONE, impl.value) : "";
  }
  impl.addEventListener("change", function () { draft.impl = impl.value; paintImpl(); });
  paintImpl();
  grid.appendChild(field("Состояние реализации", impl, "impl"));

  var task = el("input", { type: "url", placeholder: "https://…/tasks/task/view/12345/" });
  task.value = draft.task_url || "";
  task.addEventListener("input", function () { draft.task_url = task.value.trim(); });
  var owner = el("input", { list: "dl_owner", placeholder: "имя или роль" });
  owner.value = draft.owner || "";
  owner.addEventListener("input", function () { draft.owner = owner.value.trim(); });
  var ownerList = el("datalist", { id: "dl_owner" });
  realValues("owner").slice(0, 30).forEach(function (v) {
    ownerList.appendChild(el("option", { value: v }));
  });
  grid.appendChild(field("Кто сейчас занимается",
    el("div", {}, [owner, ownerList]), "owner"));

  grid.appendChild(field("Задача в Битрикс24", task, "task_url"));
  body.appendChild(grid);

  // Поля из Excel вне спеки: кто делает, на какой платформе, что уже проверено.
  var meta = el("div", { class: "row2" });
  [["platform", "фронт / бэк"], ["team", "команда"]].forEach(function (pair) {
    var input = el("input", { list: "dl_" + pair[0] + "_m" });
    input.value = draft[pair[0]] || "";
    input.addEventListener("input", function () { draft[pair[0]] = input.value.trim(); });
    var dl = el("datalist", { id: "dl_" + pair[0] + "_m" });
    realValues(pair[0]).slice(0, 20).forEach(function (v) {
      dl.appendChild(el("option", { value: v }));
    });
    meta.appendChild(field(pair[1], el("div", {}, [input, dl]), pair[0]));
  });
  body.appendChild(meta);

  [["funnel", "Воронка сценария"], ["comment", "Комментарий"],
   ["checked", "Проверка разметки"]].forEach(function (pair) {
    var area = el("textarea", { rows: 2 });
    area.value = draft[pair[0]] || "";
    area.addEventListener("input", function () { draft[pair[0]] = area.value; });
    body.appendChild(field(pair[1], area, pair[0]));
  });

  draft.measures = draft.measures || [];
  draft.notes.measures = draft.notes.measures || {};
  body.appendChild(field("Меры, в которых используется",
    chipEditor("measures", draft.measures, function (v) { draft.measures = v; },
      draft.notes.measures), "measures"));

  draft.light = draft.light || {};
  function litDraft(f) {
    if (!STATE.lights || LIGHT_FIELDS.indexOf(f) < 0) return undefined;
    draft.light[f] = draft.light[f] || {};
    return draft.light[f];
  }
  if (STATE.lights) {
    body.appendChild(el("div", { class: "note light-legend" }, [
      el("span", { text: "Кружок у значения — светофор, нажми на него, чтобы сменить:" })
    ].concat(LIGHT_CYCLE.map(function (k) {
      return el("span", { class: "with-dot" }, [
        el("i", { class: "dot " + LIGHT_TONE[k] }), el("span", { text: LIGHT_LABEL[k] })
      ]);
    })).concat([
      el("span", { text: "Причину жёлтого и красного пиши в комментарий: клик по названию значения." })
    ])));
  }

  if (STATE.typeList) {
    draft.type = typeValues(draft);
    draft.notes.type = draft.notes.type || {};
    body.appendChild(field("type", chipEditor("type", draft.type,
      function (v) { draft.type = v; }, draft.notes.type, litDraft("type")), "type"));
  }

  LIST_FIELDS.forEach(function (f) {
    draft[f] = draft[f] || [];
    draft.notes[f] = draft.notes[f] || {};
    body.appendChild(field(f,
      chipEditor(f, draft[f], function (v) { draft[f] = v; }, draft.notes[f], litDraft(f)), f));
  });

  body.appendChild(el("div", { class: "side-title", text: "Параметры" }));
  PARAM_FIELDS.forEach(function (p) {
    draft.params[p] = draft.params[p] || [];
    draft.notes[p] = draft.notes[p] || {};
    body.appendChild(field(p,
      chipEditor(p, draft.params[p], function (v) { draft.params[p] = v; }, draft.notes[p]), p));
  });

  // Разработка: заполняется, когда событие уходит в работу. testId — якоря для проверки.
  draft.dev = draft.dev || { update_code: "", test_ids: [], eta: "" };
  body.appendChild(el("div", { class: "side-title", text: "Разработка" }));

  var devGrid = el("div", { class: "row2" });
  var code = el("input", { placeholder: "например, tasks 25.400.0" });
  code.value = draft.dev.update_code || "";
  code.addEventListener("input", function () { draft.dev.update_code = code.value.trim(); });
  devGrid.appendChild(field("Код обновления", code, "update_code"));

  var eta = el("input", { type: "date" });
  eta.value = draft.dev.eta || "";
  eta.addEventListener("input", function () { draft.dev.eta = eta.value; });
  devGrid.appendChild(field("Ориентировочная дата выхода", eta, "eta"));
  body.appendChild(devGrid);

  body.appendChild(field("testId элементов — по ним проверка найдёт кнопку на стенде",
    chipEditor("test_ids", draft.dev.test_ids, function (v) { draft.dev.test_ids = v; }),
    "test_ids"));

  // До четырёх скриншотов с подписью — чтобы было видно, о каком месте речь.
  draft.images = (draft.images || []).slice(0, 4);
  body.appendChild(el("div", { class: "side-title", text: "Скриншоты" }));

  var gallery = el("div", { class: "gallery" });
  var picker = el("input", {
    type: "file",
    accept: "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
  });
  var counter = el("div", { class: "note" });

  function redrawGallery() {
    gallery.textContent = "";
    draft.images.forEach(function (img, index) {
      var caption = el("input", { placeholder: "комментарий к картинке" });
      caption.value = img.caption || "";
      caption.addEventListener("input", function () { img.caption = caption.value; });
      // Клик по картинке в карточке — это «хочу поправить», поэтому сразу редактор.
      var annotate = function () {
        if (!AUTH_STATE.can_edit) {
          openLightbox(appUrl(img.file), img.caption);
          return;
        }
        openEditor(appUrl(img.original || img.file), img.shapes || [],
          function (path, shapes) {
            var previous = img.file;
            img.original = img.original || previous;
            img.file = path;
            img.shapes = shapes;
            if (previous !== img.original) unlinkMedia(previous);
            redrawGallery();
          });
      };
      var video = isVideo(img.file);
      var preview = video
        ? el("video", { src: appUrl(img.file), controls: "controls", preload: "metadata" })
        : el("img", { src: appUrl(img.file), alt: img.caption || "скриншот",
                      title: "Добавить визуальные обозначения" });
      if (!video) preview.addEventListener("click", annotate);
      gallery.appendChild(el("figure", { class: "shot" }, [
        preview,
        caption,
        el("div", { class: "shot-actions" }, [
          video ? null : el("button", {
            type: "button", class: "ghost qmark", text: "Добавить визуальные обозначения",
            onclick: annotate
          }),
          el("button", {
            type: "button", class: "ghost", text: "Во весь экран", "data-view-action": "true",
            onclick: function () {
              openLightbox(appUrl(img.file), img.caption, AUTH_STATE.can_edit ? annotate : null);
            }
          }),
          el("button", {
            type: "button", class: "ghost danger", text: "Убрать",
            onclick: function () { draft.images.splice(index, 1); redrawGallery(); }
          })
        ])
      ]));
    });
    picker.hidden = draft.images.length >= 4;
    counter.textContent = draft.images.length >= 4
      ? "Больше четырёх не добавить — убери лишний, если нужен другой."
      : "Добавлено " + draft.images.length + " из 4. Картинки до 6 МБ, видео до 80 МБ.";
  }

  picker.addEventListener("change", function () {
    var chosen = picker.files && picker.files[0];
    if (!chosen) return;
    counter.textContent = "Загружаю…";
    uploadFile(chosen).then(function (res) {
      if (!res.ok) { alert(res["ошибка"] || "файл не загрузился"); redrawGallery(); return; }
      draft.images.push({ file: res.path, caption: "" });
      redrawGallery();
    });
    picker.value = "";
  });

  redrawGallery();
  body.appendChild(gallery);
  body.appendChild(field("Добавить скриншот", picker, "images"));
  body.appendChild(counter);

  document.getElementById("delete-event").hidden = !draft.id;
  document.getElementById("save-event").hidden = !AUTH_STATE.can_edit;
  document.getElementById("readonly-banner").hidden = AUTH_STATE.can_edit;
  if (!AUTH_STATE.can_edit) makeSheetReadOnly();

  // Клик был по конкретной ячейке — ставим курсор ровно туда.
  if (focusKey) {
    var target = body.querySelector('[data-field="' + focusKey + '"]');
    if (target) {
      var box = target.closest(".field");
      if (box) {
        box.scrollIntoView({ block: "center" });
        box.classList.add("flash");
        setTimeout(function () { box.classList.remove("flash"); }, 1600);
      }
      target.focus();
      if (target.setSelectionRange && target.value) {
        try { target.setSelectionRange(target.value.length, target.value.length); }
        catch (err) { /* у некоторых типов полей это запрещено */ }
      }
    }
  }
}

function closeSheet() {
  document.getElementById("sheet").hidden = true;
  STATE.open = null;
  STATE.openArea = null;
}

// ------------------------------------------------------------------ сервер
function load() {
  return apiFetch("/api/state").then(function (r) { return r.json(); }).then(function (d) {
    updateAuth(d.auth || {});
    STATE.tools = d["инструменты"] || {};
    STATE.chatTools = (d.task_chats || {}).tools || {};
    STATE.chatDict = (d.task_chats || {}).dict || {};
    STATE.dict = d["словарь"] || {};
    STATE.baseDict = STATE.dict;
    STATE.states = d["состояния"] || [];
    STATE.typeList = !!d["type_списком"];
    STATE.lights = !!d["светофор"];
    if (!STATE.lights) {
      COLUMNS = COLUMNS.filter(function (c) { return c.kind !== "light"; });
    }
    if (d["пространство"]) {
      document.title = "Разметка 2.0 · " + d["пространство"];
      document.querySelector(".brand").textContent = "Разметка 2.0 · " + d["пространство"];
      STATE.baseTitle = document.title;
    }
    render();
  });
}

function save() {
  if (!requireEdit(save)) return;
  var draft = STATE.open;
  if (!draft) return;
  if (!draft.event) { alert("У события нет имени."); return; }
  if (!draft.tool) { alert("Не указан инструмент."); return; }
  Object.keys(draft.notes || {}).forEach(function (f) {
    if (!Object.keys(draft.notes[f]).length) delete draft.notes[f];
  });
  Object.keys(draft.light || {}).forEach(function (f) {
    if (!Object.keys(draft.light[f]).length) delete draft.light[f];
  });
  if (draft.light && !Object.keys(draft.light).length) delete draft.light;

  apiFetch("/api/event", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft)
  }).then(function (r) { return r.json(); }).then(function (res) {
    if (!res.ok) { alert(res["ошибка"] || "не сохранилось"); return; }
    closeSheet();
    load();
  });
}

function removeEvent() {
  if (!requireEdit(removeEvent)) return;
  var draft = STATE.open;
  if (!draft || !draft.id) return;
  if (!confirm("Удалить событие " + draft.event + "?")) return;
  apiFetch("/api/delete", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: draft.id })
  }).then(function (r) { return r.json(); }).then(function (res) {
    if (!res.ok) { alert(res["ошибка"] || "не удалось удалить"); return; }
    closeSheet(); load();
  });
}

// ------------------------------------------------------------------- запуск
document.getElementById("search").addEventListener("input", function (e) {
  STATE.filter.q = e.target.value;
  render();  // не только таблица: счётчики слева тоже зависят от запроса
});
document.getElementById("reset").addEventListener("click", resetFilters);
document.getElementById("toggle-summary").addEventListener("click", function () {
  var on = document.getElementById("summary").hidden;
  showSummary(on);
  if (on) renderSummary();
});

// Боковое меню можно убрать; выбор помним, но работаем и без хранилища.
var sideOff = false;
try { sideOff = localStorage.getItem("side") === "off"; } catch (err) { sideOff = false; }
function applySide() {
  document.getElementById("side").hidden = sideOff;
  var btn = document.getElementById("toggle-side");
  btn.textContent = sideOff ? "☰ Меню" : "☰";
  btn.title = sideOff ? "Показать боковое меню" : "Скрыть боковое меню";
}
document.getElementById("toggle-side").addEventListener("click", function () {
  sideOff = !sideOff;
  try { localStorage.setItem("side", sideOff ? "off" : "on"); } catch (err) { /* не страшно */ }
  applySide();
  syncScrollbar();
});
applySide();

// Тема: авто по настройке системы, либо принудительно светлая или тёмная.
var THEMES = ["auto", "light", "dark"];
var THEME_LABEL = { auto: "Тема: авто", light: "Тема: светлая", dark: "Тема: тёмная" };
var theme = "auto";
try { theme = localStorage.getItem("theme") || "auto"; } catch (err) { theme = "auto"; }
function applyTheme() {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("toggle-theme").textContent = THEME_LABEL[theme];
}
document.getElementById("toggle-theme").addEventListener("click", function () {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try { localStorage.setItem("theme", theme); } catch (err) { /* переживём */ }
  applyTheme();
});
applyTheme();
wireScrollbar();
document.getElementById("new-event").addEventListener("click", function () {
  openSheet({ description: "", event: "", tool: pickedFor("tool")[0] || "", category: "",
              type: "", state: "draft", legacy: false, params: {}, review: [] });
});
document.getElementById("close-sheet").addEventListener("click", closeSheet);
document.getElementById("save-event").addEventListener("click", save);
document.getElementById("delete-event").addEventListener("click", removeEvent);
document.getElementById("lightbox").addEventListener("click", closeLightbox);
document.getElementById("lightbox-edit").addEventListener("click", function (ev) {
  ev.stopPropagation();
  var edit = LIGHTBOX_EDIT;
  closeLightbox();
  if (edit) edit();
});
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape" || document.getElementById("auth-dialog").open) return;
  if (!document.getElementById("lightbox").hidden) { closeLightbox(); return; }
  closeSheet();
});

load();
wireEditor();

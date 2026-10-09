"use strict";

// The script URL supplies the mount prefix: /, /projects/ or /tasks/.
var APP_BASE = new URL(".", document.currentScript.src).pathname;
function appUrl(path) {
  path = String(path);
  while (path.charAt(0) === "/") path = path.slice(1);
  return APP_BASE + path;
}

var AUTH_STATE = { can_edit: false, csrf: null, username: null };
var AUTH_PENDING = null;

function updateAuth(state) {
  AUTH_STATE = {
    can_edit: !!state.can_edit,
    csrf: state.csrf || null,
    username: state.username || null
  };
  document.getElementById("auth-status").textContent = AUTH_STATE.can_edit
    ? "Редактор: " + AUTH_STATE.username : "Только просмотр";
  document.getElementById("auth-login").hidden = AUTH_STATE.can_edit;
  document.getElementById("auth-logout").hidden = !AUTH_STATE.can_edit;
}

function showLogin(onSuccess, message) {
  var dialog = document.getElementById("auth-dialog");
  if (onSuccess) AUTH_PENDING = onSuccess;
  document.getElementById("auth-message").textContent = message ||
    "Недостаточно прав. Войдите в учётную запись редактора для изменения данных.";
  document.getElementById("auth-error").textContent = "";
  if (!dialog.open) dialog.showModal();
  document.getElementById("auth-username").focus();
}

function requireEdit(onSuccess) {
  if (AUTH_STATE.can_edit) return true;
  showLogin(onSuccess);
  return false;
}

function makeSheetReadOnly() {
  var body = document.getElementById("sheet-body");
  body.querySelectorAll("input, textarea, select, button").forEach(function (control) {
    if (control.hasAttribute("data-view-action")) return;
    if (control.tagName === "TEXTAREA" || (control.tagName === "INPUT" &&
        ["file", "checkbox", "radio"].indexOf(control.type) < 0)) {
      control.readOnly = true;
    } else {
      control.disabled = true;
    }
  });
  document.getElementById("save-event").hidden = true;
  document.getElementById("delete-event").hidden = true;
  document.getElementById("readonly-banner").hidden = false;
  if (typeof closeEditor === "function") closeEditor();
}

function reopenSheetAfterLogin() {
  if (typeof STATE === "undefined" || !STATE.open) return;
  var area = STATE.openArea;
  openSheet(STATE.open);
  STATE.openArea = area;
}

document.getElementById("auth-login").addEventListener("click", function () { showLogin(); });
document.getElementById("sheet-login").addEventListener("click", function () { showLogin(); });
document.getElementById("auth-cancel").addEventListener("click", function () {
  document.getElementById("auth-dialog").close();
});
document.getElementById("auth-dialog").addEventListener("close", function () {
  AUTH_PENDING = null;
  document.getElementById("auth-password").value = "";
});
document.getElementById("auth-form").addEventListener("submit", function (event) {
  event.preventDefault();
  var submit = document.getElementById("auth-submit");
  if (submit.disabled) return;
  submit.disabled = true;
  document.getElementById("auth-error").textContent = "";
  fetch(appUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: document.getElementById("auth-username").value.trim(),
      password: document.getElementById("auth-password").value
    })
  }).then(function (response) { return response.json(); }).then(function (state) {
    document.getElementById("auth-password").value = "";
    if (!state.ok) {
      document.getElementById("auth-error").textContent = state["ошибка"] || "Не удалось войти";
      return;
    }
    var pending = AUTH_PENDING;
    AUTH_PENDING = null;
    updateAuth(state);
    document.getElementById("auth-dialog").close();
    reopenSheetAfterLogin();
    if (pending) pending();
  }).catch(function () {
    document.getElementById("auth-error").textContent = "Нет связи с сервером. Повторите вход.";
  }).finally(function () { submit.disabled = false; });
});
document.getElementById("auth-logout").addEventListener("click", function () {
  apiFetch("/api/auth/logout", { method: "POST", body: "" })
    .then(function (response) { return response.json(); })
    .then(function (result) {
      if (!result.ok) return;
      updateAuth({});
      AUTH_PENDING = null;
      closeSheet();
      closeEditor();
      closeLightbox();
      return load();
    }).catch(function () { alert("Не удалось выйти: нет связи с сервером."); });
});

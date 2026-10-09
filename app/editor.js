"use strict";

// Разметка картинки красным: прямоугольник, стрелка, маркер.
// Фигуры хранятся в долях от размера картинки (0..1), поэтому переживают любой
// масштаб. Плоская копия сохраняется отдельным файлом, чтобы разметку было видно
// в таблице и в просмотре, а оригинал остаётся для повторного редактирования.

var RED = "#e5484d";
var EDITOR = { shapes: [], tool: "rect", image: null, done: null, drawing: null };

function editorCanvas() {
  return document.getElementById("editor-canvas");
}

function strokeWidth(canvas) {
  return Math.max(3, Math.round(canvas.width / 280));
}

function drawArrow(ctx, from, to, width) {
  var dx = to.x - from.x;
  var dy = to.y - from.y;
  var length = Math.sqrt(dx * dx + dy * dy) || 1;
  var head = Math.max(width * 3.2, length * 0.16);
  var angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - 0.4), to.y - head * Math.sin(angle - 0.4));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle + 0.4), to.y - head * Math.sin(angle + 0.4));
  ctx.stroke();
}

function paintShapes(canvas, shapes, image) {
  var ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (image) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  var width = strokeWidth(canvas);
  ctx.strokeStyle = RED;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  var toX = function (v) { return v * canvas.width; };
  var toY = function (v) { return v * canvas.height; };
  shapes.forEach(function (shape) {
    if (shape.t === "rect") {
      ctx.strokeRect(toX(shape.x), toY(shape.y), toX(shape.w), toY(shape.h));
    } else if (shape.t === "arrow") {
      drawArrow(ctx,
        { x: toX(shape.x1), y: toY(shape.y1) },
        { x: toX(shape.x2), y: toY(shape.y2) }, width);
    } else if (shape.t === "pen" && shape.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(toX(shape.points[0][0]), toY(shape.points[0][1]));
      shape.points.slice(1).forEach(function (point) {
        ctx.lineTo(toX(point[0]), toY(point[1]));
      });
      ctx.stroke();
    }
  });
}

function editorRedraw() {
  var shapes = EDITOR.shapes.slice();
  if (EDITOR.drawing) shapes.push(EDITOR.drawing);
  paintShapes(editorCanvas(), shapes, EDITOR.image);
}

function editorPoint(ev) {
  var box = editorCanvas().getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)),
    y: Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height))
  };
}

function setTool(name) {
  EDITOR.tool = name;
  Array.prototype.forEach.call(document.querySelectorAll(".tool"), function (btn) {
    btn.className = "tool" + (btn.getAttribute("data-tool") === name ? " on" : "");
  });
}

function openEditor(src, shapes, onDone) {
  if (!requireEdit(function () { openEditor(src, shapes, onDone); })) return;
  EDITOR.shapes = JSON.parse(JSON.stringify(shapes || []));
  EDITOR.done = onDone;
  EDITOR.drawing = null;
  var image = new Image();
  image.onload = function () {
    var canvas = editorCanvas();
    var scale = Math.min(1, 1600 / image.naturalWidth);
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    EDITOR.image = image;
    editorRedraw();
    document.getElementById("editor").hidden = false;
  };
  image.onerror = function () { alert("Картинка не загрузилась."); };
  image.src = src;
}

function closeEditor() {
  document.getElementById("editor").hidden = true;
}

function wireEditor() {
  var canvas = editorCanvas();
  var start = null;

  canvas.addEventListener("pointerdown", function (ev) {
    canvas.setPointerCapture(ev.pointerId);
    start = editorPoint(ev);
    if (EDITOR.tool === "pen") {
      EDITOR.drawing = { t: "pen", points: [[start.x, start.y]] };
    } else if (EDITOR.tool === "arrow") {
      EDITOR.drawing = { t: "arrow", x1: start.x, y1: start.y, x2: start.x, y2: start.y };
    } else {
      EDITOR.drawing = { t: "rect", x: start.x, y: start.y, w: 0, h: 0 };
    }
  });

  canvas.addEventListener("pointermove", function (ev) {
    if (!EDITOR.drawing || !start) return;
    var at = editorPoint(ev);
    if (EDITOR.drawing.t === "pen") {
      EDITOR.drawing.points.push([at.x, at.y]);
    } else if (EDITOR.drawing.t === "arrow") {
      EDITOR.drawing.x2 = at.x;
      EDITOR.drawing.y2 = at.y;
    } else {
      EDITOR.drawing.x = Math.min(start.x, at.x);
      EDITOR.drawing.y = Math.min(start.y, at.y);
      EDITOR.drawing.w = Math.abs(at.x - start.x);
      EDITOR.drawing.h = Math.abs(at.y - start.y);
    }
    editorRedraw();
  });

  function finish() {
    if (!EDITOR.drawing) return;
    var shape = EDITOR.drawing;
    EDITOR.drawing = null;
    start = null;
    var tooSmall =
      (shape.t === "rect" && shape.w < 0.01 && shape.h < 0.01) ||
      (shape.t === "pen" && shape.points.length < 2) ||
      (shape.t === "arrow" && Math.abs(shape.x2 - shape.x1) < 0.01 &&
       Math.abs(shape.y2 - shape.y1) < 0.01);
    if (!tooSmall) EDITOR.shapes.push(shape);
    editorRedraw();
  }
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);

  Array.prototype.forEach.call(document.querySelectorAll(".tool"), function (btn) {
    btn.addEventListener("click", function () { setTool(btn.getAttribute("data-tool")); });
  });
  document.getElementById("editor-undo").addEventListener("click", function () {
    EDITOR.shapes.pop();
    editorRedraw();
  });
  document.getElementById("editor-clear").addEventListener("click", function () {
    EDITOR.shapes = [];
    editorRedraw();
  });
  document.getElementById("editor-cancel").addEventListener("click", closeEditor);
  document.getElementById("editor-save").addEventListener("click", function () {
    var canvas = editorCanvas();
    paintShapes(canvas, EDITOR.shapes, EDITOR.image);
    canvas.toBlob(function (blob) {
      apiFetch("/api/upload-raw", {
        method: "POST",
        headers: { "X-Ext": "png", "Content-Type": "application/octet-stream" },
        body: blob
      }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) {
        alert(res["ошибка"] || "разметка не сохранилась");
        return;
      }
        closeEditor();
        if (EDITOR.done) EDITOR.done(res.path, EDITOR.shapes);
      });
    }, "image/png");
  });
  setTool("rect");
}

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const backgroundInput = document.getElementById("backgroundInput");
const personInput = document.getElementById("personInput");
const backgroundName = document.getElementById("backgroundName");
const personName = document.getElementById("personName");

const segmentationStatus = document.getElementById("segmentationStatus");
const cutoutPreview = document.getElementById("cutoutPreview");
const cutoutPreviewCtx = cutoutPreview.getContext("2d");
const previewEmpty = document.getElementById("previewEmpty");

const cleanupRange = document.getElementById("cleanupRange");
const cleanupValue = document.getElementById("cleanupValue");

const smallerBtn = document.getElementById("smallerBtn");
const largerBtn = document.getElementById("largerBtn");
const leftBtn = document.getElementById("leftBtn");
const rightBtn = document.getElementById("rightBtn");
const centerBtn = document.getElementById("centerBtn");
const resetBtn = document.getElementById("resetBtn");

const saveBtn = document.getElementById("saveBtn");
const downloadLink = document.getElementById("downloadLink");
const savedPreviewWrap = document.getElementById("savedPreviewWrap");
const savedPreview = document.getElementById("savedPreview");
const emptyMessage = document.getElementById("emptyMessage");
const pwaStatus = document.getElementById("pwaStatus");

const cleanupLabels = ["なし", "弱め", "標準", "強め"];

const state = {
  background: null,
  personOriginal: null,
  segmentationBase: null,
  personCutout: null,
  personX: 0,
  personY: 0,
  personScale: 0.48,
  dragging: false,
  dragOffsetX: 0,
  dragOffsetY: 0,
  lastPinchDistance: null,
  saveObjectUrl: null,
  cleanupLevel: 2
};

let selfieSegmentation = null;
let pendingSegmentation = null;

function setStatus(message, kind = "idle") {
  segmentationStatus.textContent = message;
  segmentationStatus.className = `status ${kind}`;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像の読み込みに失敗しました。"));
    };

    img.src = url;
  });
}

function createDownscaledCanvas(image, maxLongSide = 1200) {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  const scale = Math.min(1, maxLongSide / Math.max(w, h));

  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));

  const cctx = c.getContext("2d");
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = "high";
  cctx.drawImage(image, 0, 0, c.width, c.height);
  return c;
}

function initSegmenter() {
  if (selfieSegmentation) return;

  if (typeof SelfieSegmentation === "undefined") {
    throw new Error(
      "人物切り抜きライブラリを読み込めませんでした。通信状態を確認してページを再読み込みしてください。"
    );
  }

  selfieSegmentation = new SelfieSegmentation({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/${file}`
  });

  selfieSegmentation.setOptions({
    modelSelection: 0,
    selfieMode: false
  });

  selfieSegmentation.onResults((results) => {
    if (!pendingSegmentation) return;

    try {
      state.segmentationBase = buildSegmentationBase(results);
      rebuildCutout();
      pendingSegmentation.resolve(state.personCutout);
    } catch (error) {
      pendingSegmentation.reject(error);
    } finally {
      pendingSegmentation = null;
    }
  });
}

function buildSegmentationBase(results) {
  const source = results.image;
  const w = source.width || source.videoWidth || source.naturalWidth;
  const h = source.height || source.videoHeight || source.naturalHeight;

  // v0.2で安定していた切り抜き方式に戻す。
  // マスクを先に描き、source-inで元画像を重ねると、
  // 人物内部の不透明度を保ったまま輪郭だけ半透明になる。
  const cutoutCanvas = document.createElement("canvas");
  cutoutCanvas.width = w;
  cutoutCanvas.height = h;

  const cctx = cutoutCanvas.getContext("2d", { willReadFrequently: true });
  cctx.clearRect(0, 0, w, h);
  cctx.drawImage(results.segmentationMask, 0, 0, w, h);
  cctx.globalCompositeOperation = "source-in";
  cctx.drawImage(source, 0, 0, w, h);
  cctx.globalCompositeOperation = "source-over";

  const imageData = cctx.getImageData(0, 0, w, h);
  const pixels = imageData.data;
  const sourcePixels = new Uint8ClampedArray(pixels.length);
  const alpha = new Uint8ClampedArray(w * h);

  for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
    sourcePixels[i] = pixels[i];
    sourcePixels[i + 1] = pixels[i + 1];
    sourcePixels[i + 2] = pixels[i + 2];
    sourcePixels[i + 3] = 255;
    alpha[p] = pixels[i + 3];
  }

  return { width: w, height: h, sourcePixels, alpha };
}
function minFilter1D(src, width, height, radius, horizontal) {
  if (radius <= 0) return new Uint8ClampedArray(src);

  const dst = new Uint8ClampedArray(src.length);

  if (horizontal) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let min = 255;
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(width - 1, x + radius);
        for (let xx = x0; xx <= x1; xx++) {
          const v = src[row + xx];
          if (v < min) min = v;
        }
        dst[row + x] = min;
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      for (let x = 0; x < width; x++) {
        let min = 255;
        for (let yy = y0; yy <= y1; yy++) {
          const v = src[yy * width + x];
          if (v < min) min = v;
        }
        dst[y * width + x] = min;
      }
    }
  }

  return dst;
}

function erodeAlpha(alpha, width, height, radius) {
  if (radius <= 0) return new Uint8ClampedArray(alpha);
  const horizontal = minFilter1D(alpha, width, height, radius, true);
  return minFilter1D(horizontal, width, height, radius, false);
}

function remapAlpha(a, level) {
  const settings = [
    { low: 4,  high: 245 },
    { low: 10, high: 240 },
    { low: 18, high: 235 },
    { low: 28, high: 230 }
  ][level];

  if (a <= settings.low) return 0;
  if (a >= settings.high) return 255;

  let t = (a - settings.low) / (settings.high - settings.low);
  t = t * t * (3 - 2 * t);
  return Math.round(t * 255);
}

function createCleanCutout(base, level) {
  const { width: w, height: h, sourcePixels } = base;
  const radius = [0, 0, 1, 1][level];
  const eroded = erodeAlpha(base.alpha, w, h, radius);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d", { willReadFrequently: true });
  const imageData = octx.createImageData(w, h);
  const dst = imageData.data;

  for (let p = 0, i = 0; p < eroded.length; p++, i += 4) {
    const a = remapAlpha(eroded[p], level);
    dst[i] = sourcePixels[i];
    dst[i + 1] = sourcePixels[i + 1];
    dst[i + 2] = sourcePixels[i + 2];
    dst[i + 3] = a;
  }

  octx.putImageData(imageData, 0, 0);
  return cropTransparentCanvas(out);
}

function cropTransparentCanvas(sourceCanvas) {
  const sctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const data = sctx.getImageData(0, 0, w, h).data;

  let minX = w, minY = h, maxX = -1, maxY = -1;

  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha > 18) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const padX = Math.max(4, Math.round((maxX - minX + 1) * 0.025));
  const padY = Math.max(4, Math.round((maxY - minY + 1) * 0.02));

  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(w - 1, maxX + padX);
  maxY = Math.min(h - 1, maxY + padY);

  const cropped = document.createElement("canvas");
  cropped.width = maxX - minX + 1;
  cropped.height = maxY - minY + 1;

  cropped.getContext("2d").drawImage(
    sourceCanvas,
    minX, minY, cropped.width, cropped.height,
    0, 0, cropped.width, cropped.height
  );

  return cropped;
}

function rebuildCutout() {
  if (!state.segmentationBase) return;

  const cutout = createCleanCutout(state.segmentationBase, state.cleanupLevel);

  if (!cutout) {
    throw new Error("人物を検出できませんでした。別の人物写真を試してください。");
  }

  state.personCutout = cutout;
  renderCutoutPreview();
  draw();
}

async function segmentPerson(image) {
  initSegmenter();

  if (pendingSegmentation) {
    throw new Error("現在、別の人物写真を処理中です。");
  }

  const sourceCanvas = createDownscaledCanvas(image, 1200);

  return new Promise(async (resolve, reject) => {
    pendingSegmentation = { resolve, reject };
    try {
      await selfieSegmentation.send({ image: sourceCanvas });
    } catch (error) {
      pendingSegmentation = null;
      reject(error);
    }
  });
}

function renderCutoutPreview() {
  cutoutPreviewCtx.clearRect(0, 0, cutoutPreview.width, cutoutPreview.height);

  if (!state.personCutout) {
    previewEmpty.style.display = "grid";
    return;
  }

  previewEmpty.style.display = "none";

  const c = state.personCutout;
  const pad = 22;
  const scale = Math.min(
    (cutoutPreview.width - pad * 2) / c.width,
    (cutoutPreview.height - pad * 2) / c.height
  );

  const w = c.width * scale;
  const h = c.height * scale;
  const x = (cutoutPreview.width - w) / 2;
  const y = (cutoutPreview.height - h) / 2;

  cutoutPreviewCtx.imageSmoothingEnabled = true;
  cutoutPreviewCtx.imageSmoothingQuality = "high";
  cutoutPreviewCtx.drawImage(c, x, y, w, h);
}

function setCanvasToBackground() {
  if (!state.background) return;

  const maxLongSide = 1800;
  const w = state.background.naturalWidth;
  const h = state.background.naturalHeight;
  const scale = Math.min(1, maxLongSide / Math.max(w, h));

  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  resetPlacement();
}

function resetPlacement() {
  if (!state.background) return;
  state.personX = canvas.width * 0.50;
  state.personY = canvas.height * 0.60;
  state.personScale = 0.48;
}

function getPersonRect() {
  if (!state.personCutout) return null;

  const targetHeight = canvas.height * state.personScale;
  const ratio = state.personCutout.width / state.personCutout.height;
  const targetWidth = targetHeight * ratio;

  return {
    x: state.personX - targetWidth / 2,
    y: state.personY - targetHeight / 2,
    width: targetWidth,
    height: targetHeight
  };
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!state.background) {
    emptyMessage.style.display = "grid";
    saveBtn.disabled = true;
    return;
  }

  emptyMessage.style.display = "none";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(state.background, 0, 0, canvas.width, canvas.height);

  if (state.personCutout) {
    const r = getPersonRect();
    ctx.drawImage(state.personCutout, r.x, r.y, r.width, r.height);
    saveBtn.disabled = false;
  } else {
    saveBtn.disabled = true;
  }
}

function canvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();

  // canvas要素そのものの表示領域と内部ピクセルを1対1で換算する。
  // v0.3.1まではobject-fitによる余白を考慮していなかったため、
  // 縦長画像などで左右へ行くほど座標がずれる場合があった。
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function getHitPaddingInCanvasPixels() {
  const rect = canvas.getBoundingClientRect();

  // 小さくした人物でもPC/タッチ双方で掴みやすいよう、
  // 画面上およそ18px分を判定領域に追加する。
  const screenPadding = 18;
  const pxX = screenPadding * (canvas.width / rect.width);
  const pxY = screenPadding * (canvas.height / rect.height);

  return { x: pxX, y: pxY };
}

function isPointInPerson(p) {
  const r = getPersonRect();
  if (!r) return false;

  const pad = getHitPaddingInCanvasPixels();

  return (
    p.x >= r.x - pad.x &&
    p.x <= r.x + r.width + pad.x &&
    p.y >= r.y - pad.y &&
    p.y <= r.y + r.height + pad.y
  );
}
backgroundInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    state.background = await loadImageFromFile(file);
    backgroundName.textContent = file.name;
    setCanvasToBackground();
    draw();
  } catch (error) {
    alert(error.message);
  }
});

personInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  personName.textContent = file.name;
  state.personCutout = null;
  state.segmentationBase = null;
  renderCutoutPreview();
  draw();
  setStatus("人物を切り抜いています…", "working");

  try {
    state.personOriginal = await loadImageFromFile(file);
    await segmentPerson(state.personOriginal);

    if (state.background) resetPlacement();

    draw();
    setStatus(
      "切り抜きが完了しました。白い縁が気になる場合は「輪郭補正」を調整してください。",
      "success"
    );
  } catch (error) {
    console.error(error);
    state.personCutout = null;
    state.segmentationBase = null;
    renderCutoutPreview();
    draw();
    setStatus(
      `切り抜きに失敗しました：${error.message || "不明なエラー"}`,
      "error"
    );
  }
});

cleanupRange.addEventListener("input", () => {
  state.cleanupLevel = Number(cleanupRange.value);
  cleanupValue.textContent = cleanupLabels[state.cleanupLevel];

  if (state.segmentationBase) {
    try {
      rebuildCutout();
    } catch (error) {
      setStatus(`輪郭補正に失敗しました：${error.message}`, "error");
    }
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (!state.personCutout) return;

  const p = canvasPoint(event.clientX, event.clientY);

  if (isPointInPerson(p)) {
    state.dragging = true;
    state.dragOffsetX = p.x - state.personX;
    state.dragOffsetY = p.y - state.personY;
    canvas.setPointerCapture?.(event.pointerId);
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;

  const p = canvasPoint(event.clientX, event.clientY);
  state.personX = p.x - state.dragOffsetX;
  state.personY = p.y - state.dragOffsetY;
  draw();
});

function stopDrag() { state.dragging = false; }
canvas.addEventListener("pointerup", stopDrag);
canvas.addEventListener("pointercancel", stopDrag);

canvas.addEventListener("touchstart", (event) => {
  if (event.touches.length === 2 && state.personCutout) {
    const a = event.touches[0];
    const b = event.touches[1];
    state.lastPinchDistance = Math.hypot(
      a.clientX - b.clientX,
      a.clientY - b.clientY
    );
  }
}, { passive: true });

canvas.addEventListener("touchmove", (event) => {
  if (
    event.touches.length === 2 &&
    state.personCutout &&
    state.lastPinchDistance
  ) {
    event.preventDefault();

    const a = event.touches[0];
    const b = event.touches[1];
    const d = Math.hypot(
      a.clientX - b.clientX,
      a.clientY - b.clientY
    );

    const ratio = d / state.lastPinchDistance;
    state.personScale = Math.min(
      1.5,
      Math.max(0.08, state.personScale * ratio)
    );

    state.lastPinchDistance = d;
    draw();
  }
}, { passive: false });

canvas.addEventListener("touchend", () => {
  state.lastPinchDistance = null;
}, { passive: true });

smallerBtn.addEventListener("click", () => {
  state.personScale = Math.max(0.08, state.personScale * 0.90);
  draw();
});

largerBtn.addEventListener("click", () => {
  state.personScale = Math.min(1.5, state.personScale * 1.10);
  draw();
});

leftBtn.addEventListener("click", () => {
  if (!state.background) return;
  state.personX -= canvas.width * 0.04;
  draw();
});

rightBtn.addEventListener("click", () => {
  if (!state.background) return;
  state.personX += canvas.width * 0.04;
  draw();
});

centerBtn.addEventListener("click", () => {
  if (!state.background) return;
  state.personX = canvas.width * 0.50;
  draw();
});

resetBtn.addEventListener("click", () => {
  resetPlacement();
  draw();
});

saveBtn.addEventListener("click", () => {
  if (!state.background || !state.personCutout) return;

  canvas.toBlob((blob) => {
    if (!blob) {
      alert("画像の作成に失敗しました。");
      return;
    }

    if (state.saveObjectUrl) {
      URL.revokeObjectURL(state.saveObjectUrl);
    }

    state.saveObjectUrl = URL.createObjectURL(blob);
    downloadLink.href = state.saveObjectUrl;
    downloadLink.classList.remove("hidden");
    savedPreview.src = state.saveObjectUrl;
    savedPreviewWrap.classList.remove("hidden");

    try { downloadLink.click(); } catch (_) {}
  }, "image/jpeg", 0.93);
});

function updatePwaStatus() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (standalone) {
    pwaStatus.textContent = "ホーム画面アプリとして起動しています。";
    pwaStatus.className = "status success";
    return;
  }

  if (location.protocol === "https:") {
    pwaStatus.textContent =
      "PWA対応済みです。Safariの共有ボタン →「ホーム画面に追加」で登録できます。";
    pwaStatus.className = "status success";
  } else if (
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1"
  ) {
    pwaStatus.textContent =
      "PCのlocalhostではPWAをテストできます。iPhoneではGitHub Pages公開後のHTTPS利用がおすすめです。";
    pwaStatus.className = "status idle";
  } else {
    pwaStatus.textContent =
      "現在はHTTP接続です。GitHub Pagesへ公開するとHTTPSになり、PWAとして安定して利用できます。";
    pwaStatus.className = "status idle";
  }
}

async function registerServiceWorker() {
  const secureEnough =
    location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  if (!("serviceWorker" in navigator) || !secureEnough) return;

  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch (error) {
    console.warn("Service Worker registration failed:", error);
  }
}

window.addEventListener("beforeunload", () => {
  if (state.saveObjectUrl) URL.revokeObjectURL(state.saveObjectUrl);
});

cleanupValue.textContent = cleanupLabels[state.cleanupLevel];
updatePwaStatus();
registerServiceWorker();
draw();

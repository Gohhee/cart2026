const STORAGE_KEY = "cart-calculator-state-v1";

const state = {
  items: [],
  budget: null,
  discount: 0,
  checkoutAmount: null,
  editingId: null,
  pendingPhoto: "",
};

const els = {};
let cameraStream = null;
let cameraMode = "";
let barcodeDetector = null;
let scanTimer = null;
let deferredInstallPrompt = null;

document.addEventListener("DOMContentLoaded", init);

function init() {
  mapElements();
  loadState();
  bindEvents();
  registerServiceWorker();
  render();
}

function mapElements() {
  [
    "estimated-total",
    "subtotal",
    "item-count",
    "budget-amount",
    "budget-box",
    "budget-label",
    "budget-value",
    "budget-note",
    "budget-meter-fill",
    "discount",
    "checkout-amount",
    "difference-box",
    "difference-label",
    "difference-value",
    "difference-note",
    "difference-meter-fill",
    "item-form",
    "form-title",
    "item-name",
    "item-barcode",
    "item-price",
    "item-qty",
    "item-note",
    "scan-barcode",
    "capture-label",
    "clear-photo",
    "photo-preview",
    "photo-preview-img",
    "submit-item",
    "cancel-edit",
    "form-message",
    "item-list",
    "copy-list",
    "clear-cart",
    "camera-modal",
    "camera-title",
    "camera-video",
    "camera-canvas",
    "camera-status",
    "camera-capture",
    "camera-close",
    "install-button",
  ].forEach((id) => {
    els[toCamel(id)] = document.getElementById(id);
  });
}

function bindEvents() {
  els.itemForm.addEventListener("submit", handleItemSubmit);
  els.cancelEdit.addEventListener("click", resetForm);
  els.scanBarcode.addEventListener("click", () => openCamera("barcode"));
  els.captureLabel.addEventListener("click", () => openCamera("label"));
  els.clearPhoto.addEventListener("click", clearPendingPhoto);
  els.cameraClose.addEventListener("click", closeCamera);
  els.cameraCapture.addEventListener("click", captureLabelPhoto);
  els.cameraModal.addEventListener("click", (event) => {
    if (event.target === els.cameraModal) closeCamera();
  });
  els.discount.addEventListener("input", () => {
    state.discount = parseMoney(els.discount.value);
    persistAndRender();
  });
  els.budgetAmount.addEventListener("input", () => {
    const value = els.budgetAmount.value.trim();
    state.budget = value ? parseMoney(value) : null;
    persistAndRender();
  });
  els.checkoutAmount.addEventListener("input", () => {
    const value = els.checkoutAmount.value.trim();
    state.checkoutAmount = value ? parseMoney(value) : null;
    persistAndRender();
  });
  els.itemList.addEventListener("click", handleItemListClick);
  els.clearCart.addEventListener("click", clearCart);
  els.copyList.addEventListener("click", copyCartSummary);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installButton.hidden = false;
  });
  els.installButton.addEventListener("click", promptInstall);
}

function handleItemSubmit(event) {
  event.preventDefault();
  const item = readFormItem();
  if (!item) return;

  if (state.editingId) {
    state.items = state.items.map((existing) =>
      existing.id === state.editingId ? { ...existing, ...item, id: existing.id } : existing
    );
    showFormMessage("수정했습니다.");
  } else {
    state.items.unshift({ ...item, id: makeId(), createdAt: Date.now() });
    showFormMessage("담았습니다.");
  }

  resetForm({ keepMessage: true });
  persistAndRender();
}

function readFormItem() {
  const name = els.itemName.value.trim();
  const barcode = els.itemBarcode.value.trim();
  const price = parseMoney(els.itemPrice.value);
  const qty = Number(els.itemQty.value);
  const note = els.itemNote.value.trim();

  if (!Number.isFinite(price) || price < 0) {
    showFormMessage("가격을 확인해 주세요.");
    els.itemPrice.focus();
    return null;
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    showFormMessage("수량을 확인해 주세요.");
    els.itemQty.focus();
    return null;
  }

  return {
    name: name || (barcode ? `상품 ${barcode.slice(-4)}` : "이름 미정"),
    barcode,
    price,
    qty,
    note,
    photo: state.pendingPhoto,
  };
}

function handleItemListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return;

  if (action === "increase") {
    item.qty = roundQty(item.qty + 1);
  }

  if (action === "decrease") {
    item.qty = roundQty(Math.max(0.1, item.qty - 1));
  }

  if (action === "remove") {
    state.items = state.items.filter((candidate) => candidate.id !== id);
    if (state.editingId === id) resetForm();
  }

  if (action === "edit") {
    startEdit(item);
  }

  persistAndRender();
}

function startEdit(item) {
  state.editingId = item.id;
  state.pendingPhoto = item.photo || "";
  els.formTitle.textContent = "상품 수정";
  els.submitItem.textContent = "수정 저장";
  els.cancelEdit.hidden = false;
  els.itemName.value = item.name;
  els.itemBarcode.value = item.barcode;
  els.itemPrice.value = item.price;
  els.itemQty.value = item.qty;
  els.itemNote.value = item.note;
  renderPhotoPreview();
  els.itemName.focus();
}

function resetForm(options = {}) {
  state.editingId = null;
  state.pendingPhoto = "";
  els.itemForm.reset();
  els.itemQty.value = "1";
  els.formTitle.textContent = "상품 추가";
  els.submitItem.textContent = "상품 추가";
  els.cancelEdit.hidden = true;
  renderPhotoPreview();
  if (!options.keepMessage) showFormMessage("");
}

function clearPendingPhoto() {
  state.pendingPhoto = "";
  renderPhotoPreview();
}

async function openCamera(mode) {
  cameraMode = mode;
  els.cameraModal.hidden = false;
  els.cameraTitle.textContent = mode === "barcode" ? "바코드 스캔" : "라벨 사진";
  els.cameraCapture.hidden = mode === "barcode";
  setCameraStatus("카메라를 여는 중입니다.");

  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraStatus("이 브라우저에서는 카메라를 사용할 수 없습니다.");
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    els.cameraVideo.srcObject = cameraStream;
    await els.cameraVideo.play();
    if (mode === "barcode") {
      startBarcodeScan();
    } else {
      setCameraStatus("가격표가 선명하게 보이도록 맞춘 뒤 촬영하세요.");
    }
  } catch (error) {
    setCameraStatus("카메라 권한이 없거나 사용할 수 없습니다. 수기로 입력해 주세요.");
  }
}

async function startBarcodeScan() {
  if (!("BarcodeDetector" in window)) {
    setCameraStatus("자동 바코드 인식이 지원되지 않습니다. 번호를 수기로 입력해 주세요.");
    return;
  }

  try {
    if (!barcodeDetector) {
      barcodeDetector = new BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"],
      });
    }
    setCameraStatus("바코드를 화면 가운데에 맞춰 주세요.");
    scanBarcodeFrame();
  } catch (error) {
    setCameraStatus("이 브라우저에서는 바코드 인식을 시작할 수 없습니다.");
  }
}

async function scanBarcodeFrame() {
  if (cameraMode !== "barcode" || !cameraStream) return;

  try {
    const codes = await barcodeDetector.detect(els.cameraVideo);
    if (codes.length > 0) {
      const code = codes[0].rawValue || "";
      els.itemBarcode.value = code;
      setCameraStatus(`인식됨: ${code}`);
      window.setTimeout(closeCamera, 450);
      return;
    }
  } catch (error) {
    setCameraStatus("인식 중 문제가 생겼습니다. 수기로 입력해 주세요.");
    return;
  }

  scanTimer = window.setTimeout(scanBarcodeFrame, 220);
}

function captureLabelPhoto() {
  const video = els.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) {
    setCameraStatus("카메라 화면을 불러오는 중입니다.");
    return;
  }

  const canvas = els.cameraCanvas;
  const maxWidth = 720;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  state.pendingPhoto = canvas.toDataURL("image/jpeg", 0.74);
  renderPhotoPreview();
  closeCamera();
}

function closeCamera() {
  window.clearTimeout(scanTimer);
  scanTimer = null;
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  els.cameraVideo.srcObject = null;
  els.cameraModal.hidden = true;
  cameraMode = "";
}

function clearCart() {
  if (state.items.length === 0) return;
  const confirmed = window.confirm("담은 상품을 모두 지울까요?");
  if (!confirmed) return;
  state.items = [];
  resetForm();
  persistAndRender();
}

async function copyCartSummary() {
  if (state.items.length === 0) {
    showFormMessage("복사할 상품이 없습니다.");
    return;
  }

  const lines = state.items.map(
    (item) => `${item.name} / ${formatQty(item.qty)}개 / ${formatWon(item.price)} / ${formatWon(item.price * item.qty)}`
  );
  const summary = [
    "장바구니 계산기",
    ...lines,
    state.budget ? `예산: ${formatWon(state.budget)}` : null,
    `상품 합계: ${formatWon(getSubtotal())}`,
    `할인/쿠폰: ${formatWon(state.discount)}`,
    `예상 결제액: ${formatWon(getEstimatedTotal())}`,
  ].filter(Boolean).join("\n");

  try {
    await navigator.clipboard.writeText(summary);
    showFormMessage("목록을 복사했습니다.");
  } catch (error) {
    showFormMessage("브라우저에서 복사를 허용하지 않았습니다.");
  }
}

async function promptInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installButton.hidden = true;
}

function render() {
  els.budgetAmount.value = state.budget ?? "";
  els.discount.value = state.discount || "";
  els.checkoutAmount.value = state.checkoutAmount ?? "";
  renderSummary();
  renderBudget();
  renderDifference();
  renderItems();
  renderPhotoPreview();
}

function renderSummary() {
  const subtotal = getSubtotal();
  const estimated = getEstimatedTotal();
  const count = state.items.reduce((total, item) => total + item.qty, 0);
  els.subtotal.textContent = formatWon(subtotal);
  els.estimatedTotal.textContent = formatWon(estimated);
  els.itemCount.textContent = `${formatQty(count)}개`;
}

function renderDifference() {
  const estimated = getEstimatedTotal();
  const actual = state.checkoutAmount;
  const box = els.differenceBox;
  if (actual === null) {
    box.dataset.state = "neutral";
    els.differenceLabel.textContent = "차이";
    els.differenceValue.textContent = "0원";
    els.differenceNote.textContent = "계산대 금액을 입력하면 비교됩니다.";
    els.differenceMeterFill.style.width = "0%";
    return;
  }

  const diff = actual - estimated;
  const absDiff = Math.abs(diff);
  const tolerance = Math.max(100, estimated * 0.002);
  const percent = estimated > 0 ? (absDiff / estimated) * 100 : 0;
  const meterWidth = Math.min(100, Math.max(8, percent * 8));

  els.differenceValue.textContent = formatWon(absDiff);
  els.differenceMeterFill.style.width = `${meterWidth}%`;

  if (absDiff <= tolerance) {
    box.dataset.state = "match";
    els.differenceLabel.textContent = "거의 일치";
    els.differenceNote.textContent = `오차율 ${formatPercent(percent)}입니다.`;
    return;
  }

  if (diff > 0) {
    box.dataset.state = "over";
    els.differenceLabel.textContent = "계산대가 더 높음";
    els.differenceNote.textContent = `예상보다 ${formatWon(absDiff)} 높고, 오차율은 ${formatPercent(percent)}입니다.`;
    return;
  }

  box.dataset.state = "under";
  els.differenceLabel.textContent = "계산대가 더 낮음";
  els.differenceNote.textContent = `예상보다 ${formatWon(absDiff)} 낮고, 오차율은 ${formatPercent(percent)}입니다.`;
}

function renderBudget() {
  const budget = state.budget;
  const estimated = getEstimatedTotal();
  const box = els.budgetBox;

  if (!budget) {
    box.dataset.state = "neutral";
    els.budgetLabel.textContent = "예산 비교";
    els.budgetValue.textContent = "0원";
    els.budgetNote.textContent = "예산을 입력하면 지금 담은 금액과 비교됩니다.";
    els.budgetMeterFill.style.width = "0%";
    return;
  }

  const remaining = budget - estimated;
  const absRemaining = Math.abs(remaining);
  const percent = budget > 0 ? (estimated / budget) * 100 : 0;
  els.budgetMeterFill.style.width = `${Math.min(100, percent)}%`;

  if (remaining < 0) {
    box.dataset.state = "over";
    els.budgetLabel.textContent = "예산 초과";
    els.budgetValue.textContent = formatWon(absRemaining);
    els.budgetNote.textContent = `예산 ${formatWon(budget)}보다 ${formatWon(absRemaining)} 높습니다. 사용률은 ${formatPercent(percent)}입니다.`;
    return;
  }

  if (remaining === 0) {
    box.dataset.state = "match";
    els.budgetLabel.textContent = "예산 딱 맞음";
    els.budgetValue.textContent = "0원";
    els.budgetNote.textContent = `예산 ${formatWon(budget)}을 모두 사용했습니다.`;
    return;
  }

  box.dataset.state = "under";
  els.budgetLabel.textContent = "남은 예산";
  els.budgetValue.textContent = formatWon(remaining);
  els.budgetNote.textContent = `예산 ${formatWon(budget)} 중 ${formatPercent(percent)}를 담았습니다.`;
}

function renderItems() {
  if (state.items.length === 0) {
    els.itemList.innerHTML = `
      <div class="empty-state">
        <p><strong>아직 담은 상품이 없습니다.</strong>가격을 입력하면 합계가 바로 계산됩니다.</p>
      </div>
    `;
    return;
  }

  els.itemList.innerHTML = state.items.map(renderItemCard).join("");
}

function renderItemCard(item) {
  const barcode = item.barcode ? `<span>${escapeHtml(item.barcode)}</span>` : "";
  const note = item.note ? `<p class="item-note">${escapeHtml(item.note)}</p>` : "";
  const thumb = item.photo
    ? `<img src="${escapeAttr(item.photo)}" alt="${escapeAttr(item.name)} 라벨" />`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h12l2 5v15H4V7Z"/><path d="M6 7h12"/><path d="M9 11h6"/></svg>`;

  return `
    <article class="item-card">
      <div class="item-thumb">${thumb}</div>
      <div class="item-main">
        <h3>${escapeHtml(item.name)}</h3>
        <div class="item-meta">
          <span>${formatWon(item.price)}</span>
          <span>${formatQty(item.qty)}개</span>
          ${barcode}
        </div>
        ${note}
        <div class="item-total">${formatWon(item.price * item.qty)}</div>
      </div>
      <div class="item-actions">
        ${actionButton("decrease", item.id, "수량 줄이기", "M5 12h14")}
        ${actionButton("increase", item.id, "수량 늘리기", "M12 5v14M5 12h14")}
        ${actionButton("edit", item.id, "수정", "M12 20h9|M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z")}
        ${actionButton("remove", item.id, "삭제", "M3 6h18|M8 6V4h8v2|m19 6-1 14H6L5 6|M10 11v5|M14 11v5", "danger")}
      </div>
    </article>
  `;
}

function actionButton(action, id, label, pathData, tone = "") {
  const paths = pathData
    .split("|")
    .map((path) => `<path d="${path}" />`)
    .join("");
  return `
    <button class="small-action ${tone}" type="button" data-action="${action}" data-id="${id}" aria-label="${label}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>
    </button>
  `;
}

function renderPhotoPreview() {
  const hasPhoto = Boolean(state.pendingPhoto);
  els.photoPreview.hidden = !hasPhoto;
  els.clearPhoto.hidden = !hasPhoto;
  if (hasPhoto) {
    els.photoPreviewImg.src = state.pendingPhoto;
  } else {
    els.photoPreviewImg.removeAttribute("src");
  }
}

function getSubtotal() {
  return state.items.reduce((total, item) => total + item.price * item.qty, 0);
}

function getEstimatedTotal() {
  return Math.max(0, getSubtotal() - state.discount);
}

function persistAndRender() {
  saveState();
  render();
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.items = Array.isArray(saved.items) ? saved.items : [];
    state.budget = saved.budget === null || saved.budget === undefined ? null : Number(saved.budget);
    state.discount = Number(saved.discount) || 0;
    state.checkoutAmount = saved.checkoutAmount === null || saved.checkoutAmount === undefined ? null : Number(saved.checkoutAmount);
  } catch (error) {
    state.items = [];
    state.discount = 0;
    state.checkoutAmount = null;
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      items: state.items,
      budget: state.budget,
      discount: state.discount,
      checkoutAmount: state.checkoutAmount,
    })
  );
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

function parseMoney(value) {
  const normalized = String(value ?? "").replace(/[^\d.-]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function formatWon(value) {
  const number = Math.round(Number(value) || 0);
  const sign = number < 0 ? "-" : "";
  return `${sign}${Math.abs(number).toLocaleString("ko-KR")}원`;
}

function formatQty(value) {
  return Number(value).toLocaleString("ko-KR", {
    maximumFractionDigits: 1,
  });
}

function formatPercent(value) {
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
}

function roundQty(value) {
  return Math.round(value * 10) / 10;
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setCameraStatus(message) {
  els.cameraStatus.textContent = message;
}

function showFormMessage(message) {
  els.formMessage.textContent = message;
}

function toCamel(id) {
  return id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

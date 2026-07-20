"use strict";

const firebaseConfig = {
  apiKey: "AIzaSyBLot4DRnU3X1WWu-QnlCik0iN5iScXDLw",
  authDomain: "ceritokebae.firebaseapp.com",
  databaseURL: "https://ceritokebae-default-rtdb.firebaseio.com",
  projectId: "ceritokebae",
  storageBucket: "ceritokebae.firebasestorage.app",
  appId: "1:392368051397:android:a9aaeaf33d297f0f1bccac"
};

const $ = (id) => document.getElementById(id);
const state = { reports: [], users: {}, periodRows: [], rows: [], page: 1, pageSize: 10, sort: { key: "date", direction: "desc" }, currentUser: null };
let toastTimer;

function showToast(message, type = "success") {
  const toast = $("toast"); toast.textContent = message; toast.className = `toast show ${type}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.className = "toast", 3500);
}

function setLoading(loading) {
  const button = $("loginButton"); button.disabled = loading;
  button.innerHTML = loading ? "Menghubungkan…" : "Masuk ke dashboard <span>→</span>";
}

function parseReportDate(value, time = "00.00", timestamp) {
  if (Number.isFinite(Number(timestamp)) && Number(timestamp) > 1e11) return new Date(Number(timestamp));
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!match) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; }
  const timeMatch = String(time || "").match(/(\d{1,2})[.:](\d{1,2})/);
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), timeMatch ? Number(timeMatch[1]) : 0, timeMatch ? Number(timeMatch[2]) : 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeReport(uid, reportId, data = {}) {
  const initial = Number(data.point_deteksi_awal); const final = Number(data.point_tes_akhir);
  const safeInitial = Number.isFinite(initial) ? initial : 0; const safeFinal = Number.isFinite(final) ? final : 0;
  const delta = safeFinal - safeInitial;
  return { reportId, uid: data.uid || uid, name: data.nama || state.users[uid]?.nama || "Pengguna tanpa nama", rawDate: data.tanggal || "", time: data.jam || "", date: parseReportDate(data.tanggal, data.jam, data.timestamp), initial: safeInitial, final: safeFinal, delta, status: delta < 0 ? "improved" : delta > 0 ? "worsened" : "stable", complaint: data.isi_keluhan || "Tidak ada keluhan", type: String(data.jenis || "Laporan deteksi stres").trim() };
}

async function login(email, password) {
  if (!window.firebase) throw new Error("Pustaka Firebase gagal dimuat. Periksa koneksi internet.");
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const credential = await firebase.auth().signInWithEmailAndPassword(email, password);
  const profileSnap = await firebase.database().ref(`db_users/${credential.user.uid}`).once("value");
  const profile = profileSnap.val() || {};
  if (String(profile.role || "").toLowerCase() !== "admin") {
    await firebase.auth().signOut();
    throw new Error("Akun ini tidak memiliki role admin.");
  }
  state.currentUser = { ...profile, email: credential.user.email, uid: credential.user.uid };
  await loadFirebaseData(); showApp();
}

async function loadFirebaseData() {
  setConnection("loading");
  const [usersSnap, reportsSnap] = await Promise.all([
    firebase.database().ref("db_users").once("value"), firebase.database().ref("laporan_test").once("value")
  ]);
  state.users = usersSnap.val() || {}; state.reports = [];
  const nested = reportsSnap.val() || {};
  Object.entries(nested).forEach(([uid, reports]) => Object.entries(reports || {}).forEach(([id, report]) => state.reports.push(normalizeReport(uid, id, report))));
  setConnection("online"); applyAllFilters(); updateSync();
}

function showApp() {
  $("loginView").hidden = true; $("appView").hidden = false;
  const name = state.currentUser?.nama || "Administrator";
  $("adminName").textContent = name; $("welcomeName").textContent = name.split(" ")[0]; $("adminInitial").textContent = name.charAt(0).toUpperCase();
  $("adminRole").textContent = "Administrator";
  $("todayLabel").textContent = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  applyAllFilters(); updateSync();
}

function setConnection(mode) {
  const badge = $("connectionBadge"); badge.classList.toggle("error", mode === "error");
  badge.querySelector("b").textContent = mode === "loading" ? "Memuat…" : mode === "error" ? "Terputus" : "Terhubung";
}

function updateSync() { $("lastSync").textContent = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", year: "numeric" }).format(new Date()); }

function localDateStart(value) { if (!value) return null; const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0); }
function localDateEnd(value) { const date = localDateStart(value); if (date) date.setHours(23, 59, 59, 999); return date; }

function applyAllFilters(resetPage = true) {
  const from = localDateStart($("dateFrom").value); const to = localDateEnd($("dateTo").value);
  if (from && to && from > to) { showToast("Tanggal awal tidak boleh melewati tanggal akhir.", "error"); return; }
  state.periodRows = state.reports.filter(row => (!from || (row.date && row.date >= from)) && (!to || (row.date && row.date <= to)));
  const query = $("searchInput").value.trim().toLocaleLowerCase("id"); const status = $("statusFilter").value;
  state.rows = state.periodRows.filter(row => (status === "all" || row.status === status) && (!query || `${row.name} ${row.uid} ${row.complaint} ${row.reportId}`.toLocaleLowerCase("id").includes(query)));
  sortRows(); if (resetPage) state.page = 1;
  renderSummary(); renderTable(); renderFilterLabel();
}

function sortRows() {
  const { key, direction } = state.sort; const factor = direction === "asc" ? 1 : -1;
  state.rows.sort((a, b) => {
    const av = key === "date" ? (a.date?.getTime() || 0) : key === "name" ? a.name.toLowerCase() : a[key];
    const bv = key === "date" ? (b.date?.getTime() || 0) : key === "name" ? b.name.toLowerCase() : b[key];
    return (av > bv ? 1 : av < bv ? -1 : 0) * factor;
  });
}

function renderSummary() {
  const rows = state.periodRows; const count = rows.length; const uniqueUsers = new Set(rows.map(r => r.uid)).size;
  const average = key => count ? rows.reduce((sum, r) => sum + r[key], 0) / count : 0;
  const avgInitial = average("initial"), avgFinal = average("final"), avgDelta = average("delta");
  const improved = rows.filter(r => r.status === "improved").length, worsened = rows.filter(r => r.status === "worsened").length, stable = count - improved - worsened;
  const percent = value => count ? Math.round(value / count * 100) : 0;
  $("totalReports").textContent = count.toLocaleString("id-ID"); $("totalUsers").textContent = uniqueUsers.toLocaleString("id-ID");
  $("avgInitial").textContent = avgInitial.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  $("avgChange").textContent = `${avgDelta > 0 ? "+" : ""}${avgDelta.toLocaleString("id-ID", { maximumFractionDigits: 1 })}`;
  $("reportChip").textContent = `${count} data`; $("userChip").textContent = `${uniqueUsers} akun`; $("avgFinalChip").textContent = `Akhir ${avgFinal.toLocaleString("id-ID", { maximumFractionDigits: 1 })}`;
  const changePct = avgInitial ? avgDelta / avgInitial * 100 : 0; $("changeChip").textContent = `${changePct > 0 ? "+" : ""}${changePct.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`; $("changeChip").classList.toggle("bad", avgDelta > 0);
  $("improvedRate").textContent = `${percent(improved)}%`; $("improvedCount").textContent = `${improved} laporan`; $("worsenedCount").textContent = `${worsened} laporan`; $("stableCount").textContent = `${stable} laporan`;
  $("improvedPercent").textContent = `${percent(improved)}%`; $("worsenedPercent").textContent = `${percent(worsened)}%`; $("stablePercent").textContent = `${percent(stable)}%`;
  $("outcomeDonut").style.background = `conic-gradient(var(--good) 0 ${percent(improved)}%,var(--warn) ${percent(improved)}% ${percent(improved + worsened)}%,var(--stable) ${percent(improved + worsened)}% 100%)`;
  $("navCount").textContent = count; drawTrendChart(rows);
}

function renderTable() {
  const total = state.rows.length; const pages = Math.max(1, Math.ceil(total / state.pageSize)); state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.pageSize; const visible = state.rows.slice(start, start + state.pageSize); const body = $("reportTableBody"); body.replaceChildren();
  visible.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${start + index + 1}</td><td><div class="user-cell"><span class="user-avatar">${escapeHtml(row.name.charAt(0).toUpperCase())}</span><div><b>${escapeHtml(row.name)}</b><small>${escapeHtml(maskUid(row.uid))}</small></div></div></td><td><div class="date-cell"><b>${row.date ? formatDate(row.date) : escapeHtml(row.rawDate || "—")}</b><small>${escapeHtml(row.time || "Waktu tidak tersedia")}</small></div></td><td class="score">${row.initial}</td><td class="score">${row.final}</td><td class="delta ${row.delta < 0 ? "good" : row.delta > 0 ? "bad" : ""}">${formatDelta(row.delta)}</td><td>${statusMarkup(row.status)}</td><td><button class="detail-button" data-id="${escapeHtml(row.reportId)}" data-uid="${escapeHtml(row.uid)}" type="button" aria-label="Lihat detail">›</button></td>`;
    body.appendChild(tr);
  });
  $("emptyState").hidden = total > 0; $("tableSummary").textContent = `Menampilkan ${total.toLocaleString("id-ID")} dari ${state.periodRows.length.toLocaleString("id-ID")} laporan pada periode terpilih`;
  $("pageInfo").textContent = total ? `${start + 1}–${Math.min(start + state.pageSize, total)} dari ${total}` : "0–0 dari 0";
  $("prevPage").disabled = state.page <= 1; $("nextPage").disabled = state.page >= pages; renderPageButtons(pages);
}

function renderPageButtons(pages) {
  const wrap = $("pageButtons"); wrap.replaceChildren();
  const candidates = Array.from(new Set([1, state.page - 1, state.page, state.page + 1, pages])).filter(n => n >= 1 && n <= pages).sort((a,b) => a-b);
  let previous = 0; candidates.forEach(n => { if (n - previous > 1) wrap.append("…"); const button = document.createElement("button"); button.type = "button"; button.textContent = n; button.classList.toggle("active", n === state.page); button.onclick = () => { state.page = n; renderTable(); }; wrap.appendChild(button); previous = n; });
}

function renderFilterLabel() {
  const from = $("dateFrom").value, to = $("dateTo").value, active = Boolean(from || to);
  $("activeFilter").hidden = !active; $("reportPeriod").textContent = active ? "Periode terpilih" : "Semua periode";
  if (active) $("activePeriod").textContent = `${from ? formatInputDate(from) : "Awal data"} – ${to ? formatInputDate(to) : "Hari ini"}`;
}

function drawTrendChart(rows) {
  const canvas = $("trendChart"), empty = $("chartEmpty"); empty.hidden = rows.length > 0; if (!rows.length) return;
  const dpr = window.devicePixelRatio || 1, rect = canvas.getBoundingClientRect(); canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr); const width = rect.width, height = rect.height, pad = { l: 35, r: 12, t: 18, b: 28 };
  const dated = rows.filter(r => r.date); if (!dated.length) { empty.hidden = false; return; }
  const min = new Date(Math.min(...dated.map(r => r.date))); const max = new Date(Math.max(...dated.map(r => r.date))); const span = Math.max(1, Math.ceil((max - min) / 86400000)); const bucketDays = span > 180 ? 30 : span > 60 ? 14 : span > 20 ? 7 : 1;
  const bucketCount = Math.max(1, Math.ceil((span + 1) / bucketDays)); const buckets = Array.from({ length: bucketCount }, (_, i) => ({ date: new Date(min.getFullYear(), min.getMonth(), min.getDate() + i * bucketDays), value: 0 }));
  dated.forEach(r => { const index = Math.min(bucketCount - 1, Math.floor((r.date - min) / 86400000 / bucketDays)); buckets[index].value++; });
  const maxValue = Math.max(1, ...buckets.map(b => b.value)); ctx.font = "9px DM Sans"; ctx.strokeStyle = "#e9eeed"; ctx.fillStyle = "#82908e"; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = pad.t + (height - pad.t - pad.b) * i / 4; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke(); ctx.fillText(String(Math.round(maxValue * (4 - i) / 4)), 8, y + 3); }
  const chartW = width - pad.l - pad.r, chartH = height - pad.t - pad.b, gap = Math.max(2, chartW / buckets.length * .22), barW = Math.max(3, chartW / buckets.length - gap);
  buckets.forEach((bucket, i) => { const x = pad.l + i * chartW / buckets.length + gap / 2, barH = bucket.value / maxValue * chartH, y = pad.t + chartH - barH; const gradient = ctx.createLinearGradient(0, y, 0, pad.t + chartH); gradient.addColorStop(0, "#207a72"); gradient.addColorStop(1, "#9bd4cd"); ctx.fillStyle = gradient; roundedRect(ctx, x, y, barW, Math.max(barH, 2), 3); if (buckets.length <= 12 || i % Math.ceil(buckets.length / 8) === 0) { ctx.fillStyle = "#82908e"; ctx.textAlign = "center"; ctx.fillText(new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(bucket.date), x + barW / 2, height - 9); } });
}

function roundedRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, [r, r, 0, 0]); ctx.fill(); }
function maskUid(uid) { return uid?.length > 11 ? `${uid.slice(0, 6)}•••${uid.slice(-4)}` : uid || "—"; }
function formatDate(date) { return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(date); }
function formatInputDate(value) { return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(localDateStart(value)); }
function formatDelta(value) { return value > 0 ? `+${value}` : String(value); }
function statusLabel(status) { return status === "improved" ? "Skor menurun" : status === "worsened" ? "Skor meningkat" : "Tetap"; }
function statusMarkup(status) { return `<span class="status-pill ${status}">${statusLabel(status)}</span>`; }
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = String(value ?? ""); return div.innerHTML; }

function showDetail(uid, reportId) {
  const row = state.reports.find(r => r.uid === uid && r.reportId === reportId); if (!row) return;
  $("modalName").textContent = row.name; $("modalDate").textContent = `${row.date ? formatDate(row.date) : row.rawDate || "—"} · ${row.time || "—"}`; $("modalId").textContent = row.reportId;
  $("modalInitial").textContent = row.initial; $("modalFinal").textContent = row.final; $("modalComplaint").textContent = row.complaint;
  $("modalStatus").className = `status-pill ${row.status}`; $("modalStatus").textContent = `${statusLabel(row.status)} (${formatDelta(row.delta)})`; $("detailModal").showModal();
}

function setQuickRange(range) {
  const today = new Date(); let from = null;
  if (range === "7" || range === "30") { from = new Date(today); from.setDate(today.getDate() - Number(range) + 1); }
  if (range === "month") from = new Date(today.getFullYear(), today.getMonth(), 1);
  $("dateFrom").value = from ? toInputDate(from) : ""; $("dateTo").value = range === "all" ? "" : toInputDate(today);
  document.querySelectorAll("[data-range]").forEach(b => b.classList.toggle("active", b.dataset.range === range)); applyAllFilters();
}

function toInputDate(date) { const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, "0"), d = String(date.getDate()).padStart(2, "0"); return `${y}-${m}-${d}`; }

function getExportSelection() {
  const mode = document.querySelector('input[name="exportPeriod"]:checked')?.value || "filtered";
  if (mode === "filtered") return { rows: [...state.rows], label: "Filter tabel saat ini", stamp: `${$("dateFrom").value || "awal"}_${$("dateTo").value || "akhir"}` };
  if (mode === "all") return { rows: [...state.reports], label: "Semua tanggal", stamp: "semua-tanggal" };
  if (mode === "single") {
    const value = $("exportSingleDate").value, from = localDateStart(value), to = localDateEnd(value);
    return { rows: value ? state.reports.filter(row => row.date && row.date >= from && row.date <= to) : [], label: value ? `Tanggal ${formatInputDate(value)}` : "Pilih tanggal", stamp: value || "tanggal" };
  }
  const fromValue = $("exportDateFrom").value, toValue = $("exportDateTo").value, from = localDateStart(fromValue), to = localDateEnd(toValue);
  const valid = from && to && from <= to;
  return { rows: valid ? state.reports.filter(row => row.date && row.date >= from && row.date <= to) : [], label: valid ? `${formatInputDate(fromValue)} – ${formatInputDate(toValue)}` : "Lengkapi rentang tanggal", stamp: valid ? `${fromValue}_${toValue}` : "rentang" };
}

function updateExportPreview() {
  const mode = document.querySelector('input[name="exportPeriod"]:checked')?.value || "filtered";
  $("singleDateFields").hidden = mode !== "single"; $("rangeDateFields").hidden = mode !== "range";
  const selection = getExportSelection(); $("exportCount").textContent = `${selection.rows.length.toLocaleString("id-ID")} laporan`; $("exportPeriodLabel").textContent = selection.label;
  document.querySelectorAll(".export-format [data-export]").forEach(button => button.disabled = selection.rows.length === 0);
}

function openExportModal() {
  const today = toInputDate(new Date());
  if (!$("exportSingleDate").value) $("exportSingleDate").value = today;
  if (!$("exportDateFrom").value) $("exportDateFrom").value = today;
  if (!$("exportDateTo").value) $("exportDateTo").value = today;
  updateExportPreview(); $("exportModal").showModal();
}

function exportRows(type) {
  const selection = getExportSelection(), rows = selection.rows;
  if (!rows.length) { showToast("Tidak ada data pada tanggal yang dipilih.", "error"); return; }
  if (type === "pdf") {
    downloadPdf(rows, selection); $("exportModal").close(); return;
  } else if (type === "json") {
    const payload = rows.map(exportObject); downloadBlob(JSON.stringify(payload, null, 2), `laporan-cerito-kebae_${selection.stamp}.json`, "application/json;charset=utf-8");
  } else {
    const headers = ["No", "ID Laporan", "UID", "Nama", "Tanggal", "Jam", "Skor Awal", "Skor Akhir", "Perubahan", "Status", "Keluhan"];
    const lines = rows.map((row, i) => [i + 1, row.reportId, row.uid, row.name, row.rawDate, row.time, row.initial, row.final, row.delta, statusLabel(row.status), row.complaint].map(csvCell).join(","));
    downloadBlob("\ufeff" + [headers.join(","), ...lines].join("\r\n"), `laporan-cerito-kebae_${selection.stamp}.csv`, "text/csv;charset=utf-8");
  }
  $("exportModal").close(); showToast(`${rows.length} data (${selection.label}) berhasil disiapkan.`);
}

function downloadPdf(rows, selection) {
  if (!window.jspdf?.jsPDF) { showToast("Pembuat PDF gagal dimuat. Periksa koneksi internet lalu coba lagi.", "error"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  if (typeof doc.autoTable !== "function") { showToast("Komponen tabel PDF gagal dimuat. Muat ulang halaman lalu coba lagi.", "error"); return; }
  const generatedAt = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short" }).format(new Date());
  doc.setFillColor(15, 79, 74); doc.rect(0, 0, 297, 31, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.text("CERITO KEBAE", 14, 13);
  doc.setFontSize(11); doc.text("Laporan Monitoring Pengguna", 14, 22);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(`Dibuat: ${generatedAt}`, 283, 13, { align: "right" }); doc.text(`Periode: ${selection.label}`, 283, 20, { align: "right" }); doc.text(`Total: ${rows.length} laporan`, 283, 26, { align: "right" });
  doc.setTextColor(34, 48, 46); doc.setFontSize(7.5);
  doc.autoTable({
    startY: 38,
    head: [["No.", "Nama pengguna", "Tanggal", "Jam", "Skor awal", "Skor akhir", "Perubahan", "Status", "Isi keluhan"]],
    body: rows.map((row, index) => [index + 1, row.name, row.rawDate || (row.date ? formatDate(row.date) : "-"), row.time || "-", row.initial, row.final, formatDelta(row.delta), statusLabel(row.status), row.complaint]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7, cellPadding: 2.4, lineColor: [225, 232, 230], lineWidth: .2, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [23, 111, 103], textColor: [255, 255, 255], fontStyle: "bold", halign: "left" },
    alternateRowStyles: { fillColor: [246, 249, 248] },
    columnStyles: { 0: { cellWidth: 10, halign: "center" }, 1: { cellWidth: 36 }, 2: { cellWidth: 24 }, 3: { cellWidth: 15 }, 4: { cellWidth: 18, halign: "center" }, 5: { cellWidth: 18, halign: "center" }, 6: { cellWidth: 18, halign: "center" }, 7: { cellWidth: 26 }, 8: { cellWidth: "auto" } },
    margin: { left: 14, right: 14, bottom: 15 },
    didDrawPage: data => {
      const pageNumber = doc.internal.getNumberOfPages();
      doc.setFontSize(7); doc.setTextColor(110, 125, 122);
      doc.text("Dokumen berisi data sensitif. Hanya untuk penggunaan pihak berwenang.", 14, 202);
      doc.text(`Halaman ${pageNumber}`, 283, 202, { align: "right" });
    }
  });
  doc.save(`laporan-cerito-kebae_${selection.stamp}.pdf`);
  showToast(`${rows.length} data (${selection.label}) berhasil diunduh sebagai PDF.`);
}

function exportObject(row) { return { report_id: row.reportId, uid: row.uid, nama: row.name, tanggal: row.rawDate, jam: row.time, skor_awal: row.initial, skor_akhir: row.final, perubahan: row.delta, status: statusLabel(row.status), isi_keluhan: row.complaint }; }
function csvCell(value) { const safe = String(value ?? "").replace(/"/g, '""'); return `"${safe}"`; }
function downloadBlob(content, name, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

$("loginForm").addEventListener("submit", async event => { event.preventDefault(); setLoading(true); try { await login($("email").value.trim(), $("password").value); } catch (error) { setConnection("error"); showToast(firebaseMessage(error), "error"); } finally { setLoading(false); } });
$("togglePassword").addEventListener("click", () => { const input = $("password"); input.type = input.type === "password" ? "text" : "password"; });
$("applyFilter").addEventListener("click", () => { document.querySelectorAll("[data-range]").forEach(b => b.classList.remove("active")); applyAllFilters(); });
$("resetFilter").addEventListener("click", () => setQuickRange("all")); $("clearPeriod").addEventListener("click", () => setQuickRange("all"));
document.querySelectorAll("[data-range]").forEach(button => button.addEventListener("click", () => setQuickRange(button.dataset.range)));
$("searchInput").addEventListener("input", () => applyAllFilters()); $("statusFilter").addEventListener("change", () => applyAllFilters());
$("pageSize").addEventListener("change", event => { state.pageSize = Number(event.target.value); state.page = 1; renderTable(); });
$("prevPage").addEventListener("click", () => { if (state.page > 1) { state.page--; renderTable(); } }); $("nextPage").addEventListener("click", () => { state.page++; renderTable(); });
document.querySelectorAll("[data-sort]").forEach(button => button.addEventListener("click", () => { const key = button.dataset.sort; state.sort.direction = state.sort.key === key && state.sort.direction === "asc" ? "desc" : "asc"; state.sort.key = key; applyAllFilters(false); }));
$("reportTableBody").addEventListener("click", event => { const button = event.target.closest(".detail-button"); if (button) showDetail(button.dataset.uid, button.dataset.id); });
$("closeModal").addEventListener("click", () => $("detailModal").close()); $("detailModal").addEventListener("click", event => { if (event.target === $("detailModal")) $("detailModal").close(); });
$("downloadButton").addEventListener("click", openExportModal);
$("closeExportModal").addEventListener("click", () => $("exportModal").close());
$("exportModal").addEventListener("click", event => { if (event.target === $("exportModal")) $("exportModal").close(); });
document.querySelectorAll('input[name="exportPeriod"]').forEach(input => input.addEventListener("change", updateExportPreview));
["exportSingleDate", "exportDateFrom", "exportDateTo"].forEach(id => $(id).addEventListener("change", updateExportPreview));
$("exportModal").querySelector(".export-format").addEventListener("click", event => { const button = event.target.closest("[data-export]"); if (button) exportRows(button.dataset.export); });
$("refreshButton").addEventListener("click", async () => { try { await loadFirebaseData(); showToast("Data berhasil diperbarui."); } catch (error) { setConnection("error"); showToast(firebaseMessage(error), "error"); } });
$("logoutButton").addEventListener("click", async () => { if (window.firebase?.apps?.length) await firebase.auth().signOut(); location.reload(); });
$("menuButton").addEventListener("click", () => $("sidebar").classList.toggle("open")); document.querySelectorAll(".nav-item").forEach(link => link.addEventListener("click", () => $("sidebar").classList.remove("open")));
window.addEventListener("resize", () => { clearTimeout(window.chartResize); window.chartResize = setTimeout(() => drawTrendChart(state.periodRows), 150); });

function firebaseMessage(error) {
  const code = error?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Email atau kata sandi tidak sesuai.";
  if (code.includes("too-many-requests")) return "Terlalu banyak percobaan. Silakan coba beberapa saat lagi.";
  if (code.includes("network-request-failed")) return "Koneksi ke Firebase gagal. Periksa internet Anda.";
  if (code.includes("permission-denied")) return "Akses database ditolak. Periksa Firebase Rules untuk role admin.";
  return error?.message || "Terjadi kesalahan saat memuat data.";
}

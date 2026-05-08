import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, addDoc, setDoc, collection, query, where, getDocs, serverTimestamp, increment, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let scanner = null;
let currentMode = '';
let selectedItem = null;
let audioCtx = null;
let audioUnlocked = false;

const FEEDBACK = {
  enabled: true,
  success: {
    tones: [
      { freq: 1046, durationMs: 55, type: "triangle", volume: 0.07, delayMs: 0 },
      { freq: 1318, durationMs: 75, type: "triangle", volume: 0.08, delayMs: 75 }
    ],
    vibration: [4, 5]
  },
  error: {
    tones: [
      { freq: 220, durationMs: 120, type: "square", volume: 0.08, delayMs: 0 },
      { freq: 165, durationMs: 180, type: "square", volume: 0.08, delayMs: 120 }
    ],
    vibration: [12, 20, 12, 20, 12]
  }
};

const items = [
  { id: 'coffee', name: 'コーヒー', cost: 50 },
  { id: 'print', name: 'プリント', cost: 10 },
  { id: 'nikuman', name: '肉まん', cost: 100 }
];

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function transactionTimestampMs(d) {
  if (d.timestamp && typeof d.timestamp.toMillis === "function") return d.timestamp.toMillis();
  if (d.timestamp && typeof d.timestamp.seconds === "number") return d.timestamp.seconds * 1000;
  return 0;
}

function formatTransactionDate(d) {
  try {
    let dateObj;
    if (d.timestamp && d.timestamp.toDate) dateObj = d.timestamp.toDate();
    else if (Array.isArray(d.date)) dateObj = new Date(d.date[0]);
    else if (d.date) dateObj = new Date(d.date);
    else dateObj = new Date(0);
    return dateObj.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

// --- 画面操作 ---
window.hideSections = function() {
  document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
  document.getElementById('menu').classList.remove('hidden');
  if (scanner && scanner.isScanning) {
    scanner.stop().catch(() => {});
  }
};

window.stopScanner = function() {
  window.hideSections();
};

function startProcess(mode) {
  unlockAudio();
  currentMode = mode;
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('qr-section').classList.remove('hidden');
  document.getElementById('mode-title').innerText = mode === 'attendance' ? "出席QRをスキャン" : "利用者QRをスキャン";
  initScanner();
}

function showItems() {
  const list = document.getElementById('item-list');
  list.innerHTML = items.map(i => `
    <div class="item-card" id="item-${i.id}">
      <span class="item-card-name">${i.name}</span>
      <div class="item-card-meta">
        <span class="item-card-cost-label">必要ポイント</span>
        <span class="item-card-cost">${i.cost}pt</span>
      </div>
    </div>
  `).join('');

  items.forEach(i => {
    const el = document.getElementById(`item-${i.id}`);
    if(el) el.onclick = () => {
      unlockAudio();
      selectedItem = i;
      document.getElementById('item-section').classList.add('hidden');
      startProcess('redeem');
    };
  });
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('item-section').classList.remove('hidden');
}

// --- 利用者管理機能 ---
window.viewUsers = async function() {
  const list = document.getElementById('user-list');
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('user-admin-section').classList.remove('hidden');
  list.innerHTML = "読み込み中...";

  try {
    const snap = await getDocs(collection(db, "users"));
    if (snap.empty) {
      list.innerHTML = "登録された利用者はいません";
      return;
    }

    let html = "<table style='width:100%; border-collapse: collapse; font-size: 14px;'>";
    html += "<tr style='background:#eee;'><th>ID</th><th>名前</th><th>所持ポイント</th><th>履歴</th></tr>";

    snap.forEach(doc => {
      const u = doc.data();
      const pts = Number(u.points) || 0;
      html += `<tr style='border-bottom:1px solid #ddd;'>
        <td style='padding:8px;'>${doc.id}</td>
        <td style='padding:8px;'>${u.name || '---'}</td>
        <td style='padding:8px; text-align:center;'><span class="points-badge">${pts}pt</span></td>
        <td style='padding:8px; text-align:center;'>
          <button onclick="window.viewUserHistory('${doc.id}')" style="padding:4px 8px; border:none; background:#4caf50; color:white; border-radius:4px; cursor:pointer;">表示</button>
        </td>
      </tr>`;
    });
    html += "</table>";
    list.innerHTML = html;
  } catch (e) { list.innerHTML = "読み込みエラー"; }
};

window.addUser = async function() {
  const id = document.getElementById('new-user-id').value.trim();
  const name = document.getElementById('new-user-name').value.trim();
  if(!id || !name) return addLog("入力してください");

  try {
    await setDoc(doc(db, "users", id), {
      name: name,
      points: 0,
      createdAt: serverTimestamp()
    });
    addLog("登録完了！");
    document.getElementById('new-user-id').value = "";
    document.getElementById('new-user-name').value = "";
    window.viewUsers();
  } catch (e) { addLog("登録失敗"); }
};

// --- 個別履歴表示機能 ---
window.viewUserHistory = async function(userId) {
  const list = document.getElementById('history-list');

  document.getElementById('user-admin-section').classList.add('hidden');
  document.getElementById('history-section').classList.remove('hidden');

  list.innerHTML = "読み込み中...";

  try {
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    const userName = userSnap.exists() ? (userSnap.data().name || "") : "";
    const currentBalance = userSnap.exists() ? Number(userSnap.data().points) || 0 : 0;

    const safeId = escapeHtml(userId);
    const titleHtml = userName
      ? `${escapeHtml(userName)}<span class="user-history-id">（${safeId}）</span>`
      : safeId;

    const balanceBlock = `
      <div class="user-history-balance-card">
        <span class="user-history-balance-label">現在の所持ポイント</span>
        <span class="points-badge points-badge-large">${currentBalance}pt</span>
      </div>`;

    const headerHtml = `
      <div class="user-history-header">
        <h3 class="user-history-heading">${titleHtml}</h3>
        ${balanceBlock}
      </div>`;

    const q = query(collection(db, "transactions"), where("userId", "==", userId));
    const snap = await getDocs(q);

    if (snap.empty) {
      list.innerHTML = `${headerHtml}<p class="history-empty-msg">トランザクション履歴はありません</p>`;
      return;
    }

    let historyData = [];
    snap.forEach((docSnap) => historyData.push(docSnap.data()));
    historyData.sort((a, b) => transactionTimestampMs(b) - transactionTimestampMs(a));

    const attendanceRows = historyData.filter((d) => d.type === "attendance");
    const redeemRows = historyData.filter((d) => d.type === "redeem");

    const attendanceTotal = attendanceRows.reduce((s, d) => s + (Number(d.points) || 0), 0);
    const redeemSpentTotal = redeemRows.reduce((s, d) => s + Math.abs(Number(d.points) || 0), 0);

    let attendanceBody = "";
    if (attendanceRows.length === 0) {
      attendanceBody = '<p class="history-panel-empty">まだ出席の記録がありません</p>';
    } else {
      attendanceBody = "<table class='history-table'><thead><tr><th>日時</th><th>獲得</th></tr></thead><tbody>";
      attendanceRows.forEach((d) => {
        const pts = Number(d.points) || 0;
        attendanceBody += `<tr><td>${formatTransactionDate(d)}</td><td class="history-pts-cell history-pts-plus">+${pts}pt</td></tr>`;
      });
      attendanceBody += "</tbody></table>";
    }

    let redeemBody = "";
    if (redeemRows.length === 0) {
      redeemBody = '<p class="history-panel-empty">まだ商品交換の記録がありません</p>';
    } else {
      redeemBody = "<table class='history-table'><thead><tr><th>日時</th><th>商品</th><th>使用</th></tr></thead><tbody>";
      redeemRows.forEach((d) => {
        const spent = Math.abs(Number(d.points) || 0);
        const itemLabel = escapeHtml(d.item || "交換");
        redeemBody += `<tr><td>${formatTransactionDate(d)}</td><td>${itemLabel}</td><td class="history-pts-cell history-pts-minus">-${spent}pt</td></tr>`;
      });
      redeemBody += "</tbody></table>";
    }

    const html = `${headerHtml}
      <div class="history-panels">
        <div class="history-panel history-panel-attendance">
          <h4 class="history-panel-title">出席履歴</h4>
          ${attendanceBody}
          <div class="history-panel-summary">
            <span class="history-summary-label">出席での獲得合計</span>
            <span class="history-summary-value history-summary-plus">+${attendanceTotal}pt</span>
            <span class="history-summary-count">（${attendanceRows.length}回）</span>
          </div>
        </div>
        <div class="history-panel history-panel-redeem">
          <h4 class="history-panel-title">商品交換履歴</h4>
          ${redeemBody}
          <div class="history-panel-summary">
            <span class="history-summary-label">交換で使用したポイント合計</span>
            <span class="history-summary-value history-summary-minus">-${redeemSpentTotal}pt</span>
            <span class="history-summary-count">（${redeemRows.length}回）</span>
          </div>
        </div>
      </div>`;

    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = "エラー: " + e.message;
  }
};

// --- 履歴表示（全体の履歴） ---
async function viewHistory() {
  const list = document.getElementById('history-list');
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('history-section').classList.remove('hidden');
  list.innerHTML = "読み込み中...";

  try {
    const q = query(collection(db, "transactions"), limit(20));
    const snap = await getDocs(q);
    if (snap.empty) {
      list.innerHTML = "履歴はありません";
      return;
    }

    let html = "";
    snap.forEach(doc => {
      const d = doc.data();
      html += `<div style="border-bottom:1px solid #eee; padding:10px; font-size:14px;">${d.userId}: ${d.type === 'attendance' ? '出席(+10)' : (d.item || '交換') + '(' + d.points + ')'}</div>`;
    });
    list.innerHTML = html;
  } catch (e) { list.innerHTML = "エラー: " + e.message; }
}

// --- QR処理 ---
function initScanner() {
  if (!scanner) scanner = new Html5Qrcode("reader");
  if (scanner.isScanning) return;
  
  scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => {
    window.stopScanner();
    if (currentMode === 'attendance') processAttendance(text);
    if (currentMode === 'redeem') processRedeem(text);
  }).catch(() => notify("カメラ起動失敗", "error"));
}

// --- Firebase処理 ---
async function processAttendance(userId) {
  const today = new Date().toISOString().split('T');
  const userRef = doc(db, "users", userId);

  try {
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return notify("未登録の利用者です", "error");

    const q = query(collection(db, "transactions"), where("userId", "==", userId), where("date", "==", today), where("type", "==", "attendance"));
    const history = await getDocs(q);

    if (!history.empty) return notify("本日は付与済みです", "error");

    await updateDoc(userRef, { points: increment(10) });
    await addDoc(collection(db, "transactions"), { userId, type: "attendance", points: 10, date: today, timestamp: serverTimestamp() });

    const afterSnap = await getDoc(userRef);
    const balance = afterSnap.exists() ? Number(afterSnap.data().points) || 0 : 0;
    notify(`10pt付与しました。所持ポイント ${balance}pt`, "success");
  } catch (e) { notify("通信エラー", "error"); }
}

async function processRedeem(userId) {
  const userRef = doc(db, "users", userId);

  try {
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return notify("利用者不明", "error");

    const data = userSnap.data();
    if (data.points < selectedItem.cost) {
      return notify(`ポイント不足（所持 ${data.points}pt · 必要 ${selectedItem.cost}pt）`, "error");
    }

    await updateDoc(userRef, { points: increment(-selectedItem.cost) });
    await addDoc(collection(db, "transactions"), { userId, type: "redeem", item: selectedItem.name, points: -selectedItem.cost, date: new Date().toISOString().split('T'), timestamp: serverTimestamp() });

    const afterSnap = await getDoc(userRef);
    const balance = afterSnap.exists() ? Number(afterSnap.data().points) || 0 : 0;
    notify(`${selectedItem.name}と交換しました。残り ${balance}pt`, "success");
  } catch (e) { notify("交換失敗", "error"); }
}

function addLog(msg) {
  const log = document.getElementById('log-container');
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerText = msg;
  log.prepend(div);
  setTimeout(() => div.remove(), 5000);
}

function notify(msg, type = "info") {
  addLog(msg);
  if (!FEEDBACK.enabled) return;
  if (type === "success") playSuccessFeedback();
  if (type === "error") playErrorFeedback();
}

function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

async function unlockAudio() {
  if (!FEEDBACK.enabled || audioUnlocked) return true;
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.01);
    audioUnlocked = true;
    return true;
  } catch (e) {
    return false;
  }
}

async function playTone(freq, durationMs, toneType = "sine", volume = 0.07) {
  try {
    await unlockAudio();
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = toneType;
    oscillator.frequency.value = freq;
    const now = ctx.currentTime;
    const attack = 0.01;
    const release = 0.03;
    const toneLength = Math.max(durationMs / 1000, attack + release + 0.01);
    
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + toneLength);
    
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    setTimeout(() => oscillator.stop(), toneLength * 1000);
  } catch (e) {
    // 音声出力失敗時は無音で継続
  }
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function playSuccessFeedback() {
  FEEDBACK.success.tones.forEach((tone) => {
    setTimeout(() => {
      playTone(tone.freq, tone.durationMs, tone.type, tone.volume);
    }, tone.delayMs);
  });
  vibrate(FEEDBACK.success.vibration);
}

function playErrorFeedback() {
  FEEDBACK.error.tones.forEach((tone) => {
    setTimeout(() => {
      playTone(tone.freq, tone.durationMs, tone.type, tone.volume);
    }, tone.delayMs);
  });
  vibrate(FEEDBACK.error.vibration);
}

// --- ボタン初期設定 ---
window.addEventListener('DOMContentLoaded', () => {
  ['touchstart', 'pointerdown', 'keydown'].forEach((eventName) => {
    window.addEventListener(eventName, unlockAudio, { once: true, passive: true });
  });

  document.getElementById('btn-attendance').onclick = () => startProcess('attendance');
  document.getElementById('btn-items').onclick = () => showItems();
  document.getElementById('btn-history').onclick = () => viewHistory();
  document.getElementById('btn-user-admin').onclick = () => window.viewUsers();
});
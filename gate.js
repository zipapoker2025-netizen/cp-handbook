// 通關碼閘門＋線上編輯。手冊內容存在 content.js（AES-GCM 加密），輸入通關碼才解密顯示。
(() => {
const ITER = 200000, KEY = 'zipa-cp-handbook';
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const ub64 = u => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
async function key(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function decrypt(enc, pass) {
  const k = await key(pass, b64(enc.salt));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, k, b64(enc.ct)));
}
async function encrypt(text, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await key(pass, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(text)));
  return { v: 1, salt: ub64(salt), iv: ub64(iv), ct: ub64(ct) };
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

const main = document.getElementById('doc');
const BASE = window.CP_ENC.iv; // 每次發布都會換 iv，用來辨識版本
let PASS = '', ORIG = '', editing = false, saveT;

function cleanHTML() {
  const c = main.cloneNode(true);
  c.removeAttribute('contenteditable');
  return c.innerHTML;
}
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    store.set(KEY + '-draft', JSON.stringify({ base: BASE, html: cleanHTML() }));
    setStamp('已存於此瀏覽器 ' + new Date().toTimeString().slice(0, 5));
  }, 400);
}
function setStamp(t) { document.getElementById('tbStamp').textContent = t; }
function setEdit(on) {
  editing = on;
  main.contentEditable = on ? 'true' : 'false';
  document.body.classList.toggle('is-editing', on);
  document.getElementById('tbEdit').textContent = on ? '完成編輯' : '編輯';
  document.getElementById('tbNote').hidden = !on;
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  a.download = name; document.body.append(a); a.click(); a.remove();
}

function boot(html, pass) {
  PASS = pass; ORIG = html;
  let draft = null;
  try { draft = JSON.parse(store.get(KEY + '-draft')); } catch (e) {}
  if (draft && draft.base === BASE && draft.html && draft.html !== html) {
    main.innerHTML = draft.html;
    setStamp('已載入此瀏覽器的未發布修改');
  } else {
    if (draft && draft.base !== BASE) store.set(KEY + '-backup', JSON.stringify(draft));
    store.del(KEY + '-draft');
    main.innerHTML = html;
  }
  document.getElementById('gate').remove();
  document.getElementById('toolbar').hidden = false;
  main.hidden = false;
  main.addEventListener('input', () => { if (editing) save(); });
  if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
}

document.getElementById('tbEdit').addEventListener('click', () => setEdit(!editing));
document.getElementById('tbPrint').addEventListener('click', () => { setEdit(false); setTimeout(() => print(), 50); });
document.getElementById('tbExport').addEventListener('click', async () => {
  const enc = await encrypt(cleanHTML(), PASS);
  download('content.js', '// CP 當班手冊內容（已用通關碼加密）。用網頁「匯出 content.js」產生，覆蓋 repo 中的同名檔即可更新發布版。\nwindow.CP_ENC = ' + JSON.stringify(enc) + ';\n');
});
document.getElementById('tbReset').addEventListener('click', () => {
  if (!confirm('捨棄此瀏覽器中的修改，還原為目前發布的內容？')) return;
  store.del(KEY + '-draft'); main.innerHTML = ORIG; setStamp('已還原為發布版本');
});

async function tryPass(pass, silent) {
  try {
    const html = await decrypt(window.CP_ENC, pass);
    try { sessionStorage.setItem(KEY + '-pass', pass); } catch (e) {}
    boot(html, pass); return true;
  } catch (e) { if (!silent) document.getElementById('gateMsg').textContent = '通關碼錯誤'; return false; }
}
const f = document.getElementById('gateForm');
f.addEventListener('submit', e => { e.preventDefault(); document.getElementById('gateMsg').textContent = '驗證中…'; tryPass(f.pass.value.trim()); });
let saved = null; try { saved = sessionStorage.getItem(KEY + '-pass'); } catch (e) {}
if (saved) tryPass(saved, true);
f.pass.focus();
})();

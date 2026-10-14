// ===== v2: login Google, multi-sekolah, super admin, bel otomatis (menimpa fungsi di app.js) =====
const SES = 'bellSesi', ses = () => localStorage.getItem(SES) || '';
const waitG = f => (window.google && google.accounts) ? f() : setTimeout(() => waitG(f), 300);

async function get(a, p = {}) {
  const u = new URL(GAS_URL); u.searchParams.set('action', a); u.searchParams.set('s', ses());
  Object.entries(p).forEach(([k, v]) => v && u.searchParams.set(k, v));
  const r = await (await fetch(u)).json(); if (r.auth) keluar(); return r;
}
async function post(a, data = {}) {
  const r = await (await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: a, data, s: ses() }) })).json();
  if (r.auth) keluar(); return r;
}
function keluar() { localStorage.removeItem(SES); S.all = null; S.autoReg = 0; showLogin(); }

// ---------- login & daftar ----------
function showLogin() {
  $('#login').classList.remove('hide');
  $('#login').innerHTML = `<div class="card" style="max-width:420px;margin:12vh auto;text-align:center"><h2>🔔 Badsy Bell School Pro</h2>
   <p class="muted">Masuk dengan akun Google. Sekolah baru otomatis terdaftar saat pertama masuk, dengan jadwal bel awal dari jadwal default.</p><div id="gbtn" style="display:inline-block"></div></div>`;
  waitG(() => {
    google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onCred, auto_select: true });
    google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_blue', size: 'large', text: 'continue_with', locale: 'id' });
  });
}
async function onCred(resp) {
  loading(1);
  try {
    const r = await (await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'login', data: { idToken: resp.credential } }) })).json();
    if (!r.success) return toast(r.message, 'err');
    localStorage.setItem(SES, r.session); await load();
  } catch (e) { toast('Gagal login: ' + e.message, 'err'); } finally { loading(0); }
}
function showRegister(pf) {
  $('#login').classList.remove('hide');
  $('#login').innerHTML = `<div class="card f" style="max-width:420px;margin:12vh auto"><h2>Daftarkan Sekolah</h2><p>Akun: <b>${esc(pf.email)}</b></p>
   <label>Nama sekolah</label><input id="rn" placeholder="mis. SMP Negeri 1 ..."><p class="muted">Jadwal bel awal mengikuti jadwal default dan bisa Anda ubah sendiri.</p>
   <div class="row"><button data-act="daftar">Daftar &amp; Mulai</button><button class="sec" data-act="keluar">Ganti akun</button></div></div>`;
}
Object.assign(A, {
  daftar: async () => { const n = $('#rn').value.trim(); if (!n) return toast('Isi nama sekolah', 'err'); const r = await run('daftarSekolah', { nama: n }, false); if (r.success) load(); },
  keluar: () => confirm('Keluar dari akun?') && keluar(),
  simpanP: () => run('simpanPengaturan', { namaSekolah: $('#ps').value, volume: +$('#pv').value }),
  tgS: async d => { const r = await run('setStatusSekolah', { id: d.id, status: d.st }, false); if (r.success) adminLoad(); }
});

// ---------- muat data ----------
async function load(silent) {
  const r = await get('getAll'); if (r.auth) return;
  if (r.needRegister) return showRegister(r.profil);
  if (!r.success) { $('#login').classList.add('hide'); $('#view').innerHTML = `<div class="card">${esc(r.message)}</div>`; return; }
  S.all = r.data; S.off = S.all.serverTime - Date.now();
  // perbaikan jam: terima format apa pun, ambil HH:MM:SS; jam tidak valid dikosongkan (tidak dipakai)
  S.all.jadwal.forEach(j => { const m = String(j.jam).match(/(\d{1,2}):(\d{2}):(\d{2})/); j.jam = m ? `${p2(m[1])}:${m[2]}:${m[3]}` : ''; });
  $('#login').classList.add('hide'); $('#navAdmin').classList.toggle('hide', S.all.profil.role !== 'superadmin');
  if (!P().playerId && !S.autoReg) { S.autoReg = 1; await post('setPemutar', { playerId: S.dev, nama: navigator.platform }); return load(silent); }   // perangkat pertama otomatis jadi pemutar
  if (isPlayer()) { preload(); tryAuto(); }
  silent ? (S.page === 'beranda' && render()) : render();
}
// bel otomatis: aktif sendiri bila browser mengizinkan; jika tidak, klik di mana saja sekali
function tryAuto() { if (S.on) return; ctx().resume().then(() => { if (ctx().state === 'running') { S.on = true; navigator.wakeLock && navigator.wakeLock.request('screen').then(w => S.wl = w).catch(() => { }); renderTop(); if (S.page === 'beranda') render(); } }); }
document.addEventListener('pointerdown', () => { if (S.all && isPlayer() && !S.on) A.unlock(); }, true);

// ---------- tampilan ----------
function todayList(w) { return S.all.jadwal.filter(j => j.jam && j.aktif && j.kelompok === P().modeAktif && j.hari.includes(w.getUTCDay())).sort((a, b) => a.jam.localeCompare(b.jam)); }
function live(w, t) {
  const list = todayList(w), nx = list.find(j => j.jam > t), lib = isLibur(ymd(w)), e = id => $(id);
  if (e('#hclk')) e('#hclk').textContent = t;
  if (e('#nbn')) e('#nbn').textContent = lib ? 'Libur — bel dibisukan hari ini' : nx ? nx.nama : 'Tidak ada bel lagi hari ini';
  if (e('#nbt')) e('#nbt').textContent = nx && !lib ? nx.jam + ' WIB' : 'Tidak ada jadwal berikutnya';
  if (e('#cd')) {
    if (nx && !lib) { const [h, m, s] = nx.jam.split(':').map(Number); e('#cd').textContent = fmtD(h * 3600 + m * 60 + s - (w.getUTCHours() * 3600 + w.getUTCMinutes() * 60 + w.getUTCSeconds())); }
    else e('#cd').textContent = '--:--:--';
  }
  if (e('#tdy')) e('#tdy').innerHTML = list.map(j => `<tr class="${nx && nx.id === j.id ? 'next' : ''}"><td><b>${j.jam}</b></td><td>${esc(j.nama)}</td><td>${esc(nm(j.idNada))}</td><td><span class="chip ${j.jam <= t ? 'ok' : nx && nx.id === j.id ? 'warn' : ''}">${j.jam <= t ? 'Sudah' : nx && nx.id === j.id ? 'Berikutnya' : 'Menunggu'}</span></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Tidak ada jadwal hari ini.</td></tr>';
}
function render() {
  if (!S.all) return; renderTop();
  const pl = isPlayer() && !S.on ? '<div class="banner go">🔔 Klik di mana saja pada halaman ini untuk mengaktifkan bel otomatis (cukup sekali setelah halaman dibuka).</div>' : '';
  $('#view').innerHTML = pl + ({ beranda, jadwal: () => jadwal(), ujian, nada, libur, riwayat, pengaturan, admin })[S.page]();
  tick();
}
function pengaturan() {
  return `<h2>Pengaturan</h2><div class="card f" style="max-width:520px"><p class="muted">Akun: ${esc(S.all.profil.email)}</p><label>Nama sekolah</label><input id="ps" value="${esc(P().namaSekolah)}">
  <label>Volume (${P().volume}%)</label><input type="range" id="pv" min="0" max="100" value="${P().volume}">
  <p class="row"><button data-act="simpanP">Simpan Pengaturan</button><button class="bad" data-act="keluar">Keluar</button></p></div>`;
}
function admin() { setTimeout(adminLoad, 0); return '<h2>Super Admin — Sekolah Terdaftar</h2><div id="adm" class="card">Memuat…</div>'; }
async function adminLoad() {
  const r = await get('adminSekolah'); if (!$('#adm')) return; if (!r.success) { $('#adm').textContent = r.message; return; }
  const d = r.data;
  $('#adm').innerHTML = `<div class="row" style="margin-bottom:12px"><span class="chip">${d.length} sekolah</span><span class="chip ok">${d.filter(x => x.online).length} online sekarang</span><span class="chip warn">${d.filter(x => x.status !== 'Aktif').length} ditangguhkan</span></div>
  <div class="tw"><table><thead><tr><th>Sekolah</th><th>Email</th><th>Daftar</th><th>Terakhir aktif</th><th>Jadwal</th><th>Nada</th><th>Status</th><th></th></tr></thead><tbody>${d.map(x => `<tr><td><b>${esc(x.nama)}</b></td><td>${esc(x.email)}</td><td>${esc(x.tglDaftar.slice(0, 10))}</td><td>${esc(x.terakhirAktif)}</td><td>${x.jadwal}</td><td>${x.nada}</td>
  <td><span class="chip ${x.online ? 'ok' : x.status === 'Aktif' ? '' : 'off'}">${x.online ? 'Online' : x.status}</span></td>
  <td>${x.id === 'MAIN' ? '<span class="muted">Default</span>' : `<button class="sm ${x.status === 'Aktif' ? 'bad' : 'sec'}" data-act="tgS" data-id="${x.id}" data-st="${x.status === 'Aktif' ? 'Ditangguhkan' : 'Aktif'}">${x.status === 'Aktif' ? 'Tangguhkan' : 'Aktifkan'}</button>`}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- mulai ----------
(function init() {
  $('#view').innerHTML = '<div class="card">Memuat data…</div>';
  ses() ? load().catch(e => { $('#view').innerHTML = `<div class="card">Gagal terhubung ke server: ${esc(e.message)}</div>`; }) : showLogin();
  setInterval(tick, 250);
  setInterval(() => S.all && load(true).catch(() => { }), 60000);
  setInterval(() => S.all && isPlayer() && post('ping', { playerId: S.dev }).catch(() => { }), 30000);
  document.addEventListener('visibilitychange', async () => { if (S.on && !document.hidden && navigator.wakeLock) try { S.wl = await navigator.wakeLock.request('screen'); } catch (e) { } });
})();

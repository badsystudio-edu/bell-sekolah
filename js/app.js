// ==================== UTIL ====================
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => String(n).padStart(2, '0');
const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const HARI_FULL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const S = {
  all: null, page: 'beranda', off: 0, buf: {}, ctx: null, on: false, fired: {}, q: [], lastSec: 0, pl: false, wl: null, riw: [],
  pin: sessionStorage.getItem('pin') || '',
  dev: localStorage.getItem('bellDev') || (() => { const d = 'D' + Math.random().toString(36).slice(2, 9); localStorage.setItem('bellDev', d); return d; })()
};
const wib = ms => new Date((ms ?? Date.now() + S.off) + 7 * 36e5);   // baca pakai getUTC*
const hms = w => `${p2(w.getUTCHours())}:${p2(w.getUTCMinutes())}:${p2(w.getUTCSeconds())}`;
const ymd = w => `${w.getUTCFullYear()}-${p2(w.getUTCMonth() + 1)}-${p2(w.getUTCDate())}`;
const fmtD = s => { const m = Math.max(0, Math.round(s)); return `${p2(Math.floor(m / 3600))}:${p2(Math.floor(m % 3600 / 60))}:${p2(m % 60)}`; };
const P = () => S.all.pengaturan;
const isPlayer = () => S.all && P().playerId === S.dev;
const isLibur = d => S.all.libur.find(l => d >= l.mulai && d <= l.selesai);

function toast(m, t = 'ok') { const e = $('#toast'); e.textContent = m; e.className = 'show ' + t; setTimeout(() => e.className = '', 2800); }
function loading(on) { $('#loading').classList.toggle('hide', !on); }

// ==================== API ====================
async function get(a, p = {}) {
  const u = new URL(GAS_URL); u.searchParams.set('action', a);
  Object.entries(p).forEach(([k, v]) => v && u.searchParams.set(k, v));
  return (await fetch(u)).json();
}
async function post(a, data = {}, retry = true) {
  // text/plain wajib agar tidak kena CORS preflight
  const r = await (await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: a, data, pin: S.pin }) })).json();
  if (r.pinSalah && retry) {
    const p = prompt('Masukkan PIN pengaturan:');
    if (p === null) return r;
    S.pin = p; sessionStorage.setItem('pin', p);
    return post(a, data, false);
  }
  return r;
}
async function run(a, d, reload = true) {
  try {
    loading(1);
    const r = await post(a, d);
    toast(r.message || (r.success ? 'Berhasil' : 'Gagal'), r.success ? 'ok' : 'err');
    if (r.success && reload) await load();
    return r;
  } catch (e) { toast('Gagal: ' + e.message, 'err'); return { success: false }; }
  finally { loading(0); }
}
async function load(silent) {
  const r = await get('getAll');
  if (!r.success) throw new Error(r.message);
  S.all = r.data; S.off = r.data.serverTime - Date.now();   // sinkron jam dengan server
  if (isPlayer()) preload();
  silent ? (S.page === 'beranda' && render()) : render();
}

// ==================== AUDIO ====================
function ctx() { return S.ctx || (S.ctx = new (window.AudioContext || window.webkitAudioContext)()); }
async function loadBuf(id) {
  if (S.buf[id]) return S.buf[id];
  const r = await get('getAudio', { id });
  if (!r.success) throw new Error(r.message);
  const bin = atob(r.data.base64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return S.buf[id] = await ctx().decodeAudioData(u8.buffer);
}
async function preload() {            // unduh semua nada ke memori agar bunyi tanpa menunggu Drive
  if (S.pl) return; S.pl = true;
  for (const n of S.all.nada) { try { await loadBuf(n.idNada); } catch (e) { } }
  S.pl = false; if (S.page === 'beranda') render();
}
async function play(id) {
  if (!id) return toast('Bel ini belum punya nada', 'err');
  const b = await loadBuf(id); await ctx().resume();
  const s = ctx().createBufferSource(), g = ctx().createGain();
  g.gain.value = (+P().volume || 100) / 100; s.buffer = b; s.connect(g).connect(ctx().destination); s.start();
}
function logRiwayat(item) {
  S.q.push(item);
  const items = S.q.splice(0);
  post('catatRiwayat', { items }).catch(() => S.q.unshift(...items));   // latar belakang, tidak menunda bel
}
function ring(j, sumber, nadaId, nama) {
  const nid = nadaId ?? j.idNada, n = S.all.nada.find(x => x.idNada === nid);
  play(nid).catch(e => toast('Gagal memutar: ' + e.message, 'err'));
  logRiwayat({ ts: Date.now() + S.off, namaBel: nama ?? j.nama, nada: n ? n.nama : '', sumber, perangkat: S.dev });
}

// ==================== PENJADWAL (lokal, per detik) ====================
function check() {
  if (!S.on || !isPlayer() || P().statusBel !== 'Aktif') return;
  const nowSec = Math.floor((Date.now() + S.off) / 1000);
  if (!S.lastSec) S.lastSec = nowSec - 1;
  for (let s = Math.max(S.lastSec + 1, nowSec - 3); s <= nowSec; s++) {   // kejar detik yang terlewat (tab di-throttle)
    const w = wib(s * 1000), t = hms(w), d = ymd(w);
    if (isLibur(d)) continue;
    S.all.jadwal.forEach(j => {
      if (j.aktif && j.kelompok === P().modeAktif && j.hari.includes(w.getUTCDay()) && j.jam === t && !S.fired[d + j.id]) {
        S.fired[d + j.id] = 1; ring(j, 'Otomatis');
      }
    });
  }
  S.lastSec = nowSec;
}
function todayList(w) {
  return S.all.jadwal.filter(j => j.aktif && j.kelompok === P().modeAktif && j.hari.includes(w.getUTCDay())).sort((a, b) => a.jam.localeCompare(b.jam));
}
function tick() {
  if (!S.all) return;
  const w = wib(), t = hms(w);
  $('#clk').textContent = t + ' WIB';
  check();
  if (S.page === 'beranda') live(w, t);
}
function live(w, t) {
  const list = todayList(w), nx = list.find(j => j.jam > t);
  const el = id => $(id);
  if (el('#hclk')) el('#hclk').textContent = t;
  if (el('#nbn')) el('#nbn').textContent = isLibur(ymd(w)) ? 'Libur — bel dibisukan' : nx ? nx.nama : 'Tidak ada bel lagi hari ini';
  if (el('#nbt')) el('#nbt').textContent = nx ? nx.jam + ' WIB' : '—';
  if (el('#cd')) { const [h, m, s] = nx ? nx.jam.split(':').map(Number) : [0, 0, 0]; el('#cd').textContent = nx ? fmtD(h * 3600 + m * 60 + s - (w.getUTCHours() * 3600 + w.getUTCMinutes() * 60 + w.getUTCSeconds())) : '--:--:--'; }
  const tb = el('#tdy');
  if (tb) tb.innerHTML = list.map(j => `<tr class="${nx && nx.id === j.id ? 'next' : ''}"><td><b>${j.jam}</b></td><td>${esc(j.nama)}</td><td>${esc(nm(j.idNada))}</td><td><span class="chip ${j.jam <= t ? 'ok' : nx && nx.id === j.id ? 'warn' : ''}">${j.jam <= t ? 'Sudah' : nx && nx.id === j.id ? 'Berikutnya' : 'Menunggu'}</span></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Tidak ada jadwal hari ini.</td></tr>';
}
const nm = id => (S.all.nada.find(n => n.idNada === id) || {}).nama || '—';

// ==================== RENDER ====================
function renderTop() {
  const a = S.all, ok = a && a.playerAktif;
  $('#top').innerHTML = `<h1>${esc(a ? P().namaSekolah : 'Badsy Bell')}</h1>
   ${a ? `<span class="chip ${P().modeAktif === 'Ujian' ? 'ujian' : ''}">${P().modeAktif}</span><span class="chip ${P().statusBel === 'Aktif' ? 'ok' : 'off'}">● Bel ${P().statusBel}</span>
   <span class="chip ${isPlayer() && S.on ? 'ok' : 'warn'}">${isPlayer() ? (S.on ? 'Pemutar aktif' : 'Pemutar: klik Aktifkan Bel') : ok ? 'Ada pemutar lain' : 'Panel kontrol'}</span>` : ''}
   <span class="clock" id="clk">--:--:--</span>`;
  document.querySelectorAll('#nav a').forEach(x => x.classList.toggle('on', x.dataset.p === S.page));
}
function render() {
  if (!S.all) return;
  renderTop();
  $('#view').innerHTML = ({ beranda, jadwal: () => jadwal(), ujian, nada, libur, riwayat, pengaturan })[S.page]();
  tick();
}

function beranda() {
  const w = wib(), lib = isLibur(ymd(w)), uj = P().modeAktif === 'Ujian', pl = isPlayer();
  return `${lib ? `<div class="banner">📅 Hari ini libur: ${esc(lib.keterangan)} — bel dibisukan otomatis.</div>` : ''}
  <div class="card hero ${uj ? 'ujian' : ''}"><div class="muted" style="color:#dbe4ff">${HARI_FULL[w.getUTCDay()]}, ${w.getUTCDate()} ${BULAN[w.getUTCMonth()]} ${w.getUTCFullYear()}</div>
    <div class="big" id="hclk">--:--:--</div><div class="chip" style="background:rgba(255,255,255,.2);color:#fff">Mode ${P().modeAktif}</div></div>
  <div class="grid"><div>
    <div class="card"><div class="muted">BEL BERIKUTNYA</div><h2 id="nbn" style="margin:4px 0">—</h2>
      <div class="row"><span class="chip warn" id="nbt">—</span></div><div class="cd" id="cd">--:--:--</div></div>
    <div class="card"><h3>Kontrol Audio</h3><div class="row">
      <button class="amb" data-act="unlock">${S.on ? '✅ Bel Siap' : '🔓 Aktifkan Bel'}</button>
      <select id="tn">${S.all.nada.map(n => `<option value="${n.idNada}">${esc(n.nama)}</option>`).join('')}</select>
      <button class="sec" data-act="uji">▶ Bunyikan Sekarang</button></div>
      <p class="muted">Klik "Aktifkan Bel" sekali setelah halaman dibuka (aturan autoplay browser). Nada siap: ${Object.keys(S.buf).length}/${S.all.nada.length}${pl ? '' : ' (hanya dimuat di Perangkat Pemutar)'}.</p></div>
    <div class="card"><h3>Jadwal Hari Ini — ${HARI_FULL[w.getUTCDay()]} (${P().modeAktif})</h3><div class="tw"><table><thead><tr><th>Jam</th><th>Nama Bel</th><th>Nada</th><th>Status</th></tr></thead><tbody id="tdy"></tbody></table></div></div>
  </div><div>
    <div class="card"><h3>Status Bel Otomatis</h3><button class="huge ${P().statusBel === 'Aktif' ? 'ok' : 'off'}" data-act="togBel">${P().statusBel === 'Aktif' ? '● BEL AKTIF' : '○ BEL NONAKTIF'}</button><p class="muted">Klik untuk menyalakan/mematikan seluruh bel.</p></div>
    <div class="card"><h3>Mode Jadwal</h3><span class="chip ${uj ? 'ujian' : ''}">${P().modeAktif}</span><div style="margin-top:12px"><button class="${uj ? '' : 'ujian'}" data-act="mode" data-m="${uj ? 'Reguler' : 'Ujian'}">${uj ? 'Kembali ke Mode Reguler' : 'Ganti ke Mode Ujian'}</button></div></div>
    <div class="card"><h3>Perangkat Ini</h3><p>${pl ? '<span class="chip ok">Pemutar aktif</span> Perangkat ini membunyikan bel.' : 'Perangkat ini <b>Panel Kontrol</b> (tidak membunyikan bel).'}</p>
      <button class="sec" data-act="${pl ? 'jadiPanel' : 'jadiPemutar'}">${pl ? 'Jadikan Panel Kontrol Saja' : 'Jadikan Perangkat Pemutar'}</button>
      ${S.all.playerAktif && !pl ? '<p class="muted">Pemutar lain sedang aktif.</p>' : ''}</div>
  </div></div>`;
}

function jadwal(fixKel) {
  const f = S.f || (S.f = { q: '', h: '', k: '' }); if (fixKel) f.k = fixKel;
  return `<div class="row" style="justify-content:space-between;margin-bottom:16px"><h2 style="margin:0">${fixKel ? 'Jadwal Bel Ujian' : 'Jadwal Bel Sekolah'}</h2>
   <div class="row"><button class="sec" data-act="salin">Salin Jadwal</button><button data-act="formJ" data-k="${fixKel || ''}">+ Tambah Jadwal Bel</button></div></div>
  <div class="card"><div class="row"><input id="fq" placeholder="Cari nama bel / jam…" value="${esc(f.q)}" data-f="q">
   <select data-f="h"><option value="">Semua hari</option>${HARI.map((h, i) => `<option value="${i}" ${f.h === String(i) ? 'selected' : ''}>${h}</option>`).join('')}</select>
   ${fixKel ? '' : `<select data-f="k"><option value="">Semua kelompok</option><option ${f.k === 'Reguler' ? 'selected' : ''}>Reguler</option><option ${f.k === 'Ujian' ? 'selected' : ''}>Ujian</option></select>`}</div>
   <div class="tw"><table><thead><tr><th>Hari</th><th>Jam</th><th>Nama Bel</th><th>Nada</th><th>Kelompok</th><th>Status</th><th>Aksi</th></tr></thead><tbody id="jb">${jrows()}</tbody></table></div></div>`;
}
function jrows() {
  const f = S.f;
  const rows = S.all.jadwal.filter(j => (!f.q || (j.nama + j.jam).toLowerCase().includes(f.q.toLowerCase())) && (f.h === '' || j.hari.includes(+f.h)) && (!f.k || j.kelompok === f.k)).sort((a, b) => a.jam.localeCompare(b.jam));
  return rows.map(j => `<tr><td>${j.hari.map(h => HARI[h]).join(', ')}</td><td><b>${j.jam}</b></td><td>${esc(j.nama)}</td><td>${esc(nm(j.idNada))} <button class="sm sec" data-act="tes" data-n="${j.idNada}">▶</button></td>
   <td><span class="chip ${j.kelompok === 'Ujian' ? 'ujian' : ''}">${j.kelompok}</span></td><td><span class="chip ${j.aktif ? 'ok' : 'off'}">${j.aktif ? 'Aktif' : 'Nonaktif'}</span></td>
   <td class="row"><button class="sm sec" data-act="formJ" data-id="${j.id}">Ubah</button><button class="sm sec" data-act="tgJ" data-id="${j.id}" data-a="${j.aktif ? 0 : 1}">${j.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button><button class="sm bad" data-act="delJ" data-id="${j.id}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Belum ada jadwal.</td></tr>';
}

function ujian() {
  const uj = P().modeAktif === 'Ujian';
  return `<div class="card hero ${uj ? 'ujian' : ''}" style="background:${uj ? '' : '#fff'};color:${uj ? '#fff' : 'inherit'}"><h2 style="margin:0 0 8px">Mode Ujian</h2><p>Mode aktif: <b>${P().modeAktif}</b>. Saat Mode Ujian aktif, hanya jadwal kelompok Ujian yang berbunyi.</p>
   <button class="${uj ? 'amb' : 'ujian'}" data-act="mode" data-m="${uj ? 'Reguler' : 'Ujian'}">${uj ? 'Kembali ke Mode Reguler' : 'Aktifkan Mode Ujian'}</button></div>${jadwal('Ujian')}`;
}

function nada() {
  return `<h2>Pustaka Nada</h2><div class="card f"><h3>Unggah MP3 (maks. 5 MB)</h3><label>Nama nada</label><input id="nn" placeholder="mis. Bel Masuk"><label>File MP3</label><input type="file" id="nf" accept=".mp3,audio/mpeg"><p><button data-act="upl">Unggah</button></p></div>
  <div class="card"><div class="tw"><table><thead><tr><th>Nama</th><th>Durasi</th><th>Diunggah</th><th>Aksi</th></tr></thead><tbody>${S.all.nada.map(n => `<tr><td><b>${esc(n.nama)}</b></td><td>${n.durasi}s</td><td>${esc(n.tanggalUnggah)}</td><td class="row"><button class="sm sec" data-act="tes" data-n="${n.idNada}">▶ Putar</button><button class="sm sec" data-act="renN" data-n="${n.idNada}">Ganti nama</button><button class="sm bad" data-act="delN" data-n="${n.idNada}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Belum ada nada.</td></tr>'}</tbody></table></div></div>`;
}

function libur() {
  return `<h2>Hari Libur</h2><div class="card f"><div class="row"><div><label>Mulai</label><input type="date" id="lm"></div><div><label>Selesai</label><input type="date" id="ls"></div><div style="flex:1"><label>Keterangan</label><input id="lk" placeholder="mis. Libur Semester"></div></div><p><button data-act="addL">Tambah Libur</button></p></div>
  <div class="card"><table><thead><tr><th>Mulai</th><th>Selesai</th><th>Keterangan</th><th></th></tr></thead><tbody>${S.all.libur.map(l => `<tr><td>${l.mulai}</td><td>${l.selesai}</td><td>${esc(l.keterangan)}</td><td><button class="sm bad" data-act="delL" data-id="${l.id}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Belum ada hari libur.</td></tr>'}</tbody></table></div>`;
}

function riwayat() {
  setTimeout(cariRiw, 0);
  return `<h2>Riwayat Bel</h2><div class="card"><div class="row"><input id="rq" placeholder="Cari…"><input type="date" id="rd"><input type="date" id="rs"><button data-act="cari">Cari</button></div>
  <div class="tw"><table><thead><tr><th>Waktu</th><th>Nama Bel</th><th>Nada</th><th>Sumber</th></tr></thead><tbody id="rb"><tr><td colspan="4" class="muted">Memuat…</td></tr></tbody></table></div></div>`;
}
async function cariRiw() {
  try {
    const r = await get('getRiwayat', { q: $('#rq')?.value, dari: $('#rd')?.value, sampai: $('#rs')?.value });
    if ($('#rb')) $('#rb').innerHTML = r.data.map(x => `<tr><td>${esc(x.waktu)}</td><td>${esc(x.namaBel)}</td><td>${esc(x.nada)}</td><td><span class="chip ${x.sumber === 'Otomatis' ? '' : 'warn'}">${esc(x.sumber)}</span></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Tidak ada catatan.</td></tr>';
  } catch (e) { toast('Gagal memuat riwayat', 'err'); }
}

function pengaturan() {
  return `<h2>Pengaturan</h2><div class="card f" style="max-width:520px"><label>Nama sekolah</label><input id="ps" value="${esc(P().namaSekolah)}">
  <label>Volume (${P().volume}%)</label><input type="range" id="pv" min="0" max="100" value="${P().volume}">
  <label>PIN baru (4-6 digit, kosongkan lalu simpan untuk menghapus PIN) — PIN ${P().pinAktif ? 'AKTIF' : 'belum diatur'}</label><input id="pp" inputmode="numeric" placeholder="${P().pinAktif ? 'isi untuk mengganti' : 'opsional'}">
  <p><button data-act="simpanP">Simpan Pengaturan</button></p></div>`;
}

// ==================== DRAWER FORM ====================
function drawer(html) { const d = $('#drawer'); d.innerHTML = `<div>${html}</div>`; d.classList.remove('hide'); }
const closeD = () => $('#drawer').classList.add('hide');
function formJ(id, kel) {
  const j = S.all.jadwal.find(x => x.id === id) || { nama: '', jam: '07:00:00', hari: [1, 2, 3, 4], idNada: '', kelompok: kel || 'Reguler', aktif: true };
  drawer(`<h2>${id ? 'Ubah' : 'Tambah'} Jadwal Bel</h2><div class="f"><label>Nama bel</label><input id="jn" value="${esc(j.nama)}">
   <label>Jam</label><input type="time" step="1" id="jj" value="${j.jam}"><label>Hari aktif</label><div class="days">${[1, 2, 3, 4, 5, 6, 0].map(h => `<label><input type="checkbox" class="jh" value="${h}" ${j.hari.includes(h) ? 'checked' : ''}>${HARI[h]}</label>`).join('')}</div>
   <label>Nada</label><select id="jd"><option value="">— pilih nada —</option>${S.all.nada.map(n => `<option value="${n.idNada}" ${n.idNada === j.idNada ? 'selected' : ''}>${esc(n.nama)}</option>`).join('')}</select>
   <label>Kelompok</label><select id="jk"><option ${j.kelompok === 'Reguler' ? 'selected' : ''}>Reguler</option><option ${j.kelompok === 'Ujian' ? 'selected' : ''}>Ujian</option></select>
   <label><input type="checkbox" id="ja" ${j.aktif ? 'checked' : ''} style="width:auto"> Aktif</label></div>
   <div class="row" style="margin-top:20px"><button class="sec" data-act="closeD">Batal</button><button data-act="saveJ" data-id="${id || ''}">Simpan Jadwal Bel</button></div>`);
}

// ==================== AKSI (event delegation) ====================
const A = {
  go: d => { S.page = d.p; render(); },
  closeD,
  unlock: async () => { await ctx().resume(); S.on = true; try { S.wl = await navigator.wakeLock?.request('screen'); } catch (e) { } if (S.all && !S.pl) preload(); toast('Bel siap. Jaga halaman tetap terbuka.'); render(); },
  uji: () => { if (!S.on) A.unlock(); const id = $('#tn').value; ring({}, 'Uji Manual', id, 'Uji Coba Manual'); },
  tes: d => play(d.n).catch(e => toast('Gagal: ' + e.message, 'err')),
  togBel: () => run('setStatusBel', { status: P().statusBel === 'Aktif' ? 'Nonaktif' : 'Aktif' }),
  mode: d => confirm(`Ganti ke Mode ${d.m}?`) && run('setMode', { mode: d.m }),
  jadiPemutar: () => run('setPemutar', { playerId: S.dev, nama: navigator.platform }),
  jadiPanel: () => run('setPemutar', { playerId: '' }),
  formJ: d => formJ(d.id, d.k),
  saveJ: async d => {
    const jam = $('#jj').value.length === 5 ? $('#jj').value + ':00' : $('#jj').value;
    const r = await run('simpanJadwal', { id: d.id || undefined, nama: $('#jn').value.trim(), jam, hari: [...document.querySelectorAll('.jh:checked')].map(x => +x.value), idNada: $('#jd').value, kelompok: $('#jk').value, aktif: $('#ja').checked });
    if (r.success) closeD();
  },
  tgJ: d => run('aktifkanJadwal', { ids: [d.id], aktif: d.a === '1' }),
  delJ: d => confirm('Hapus jadwal bel ini?') && run('hapusJadwal', { ids: [d.id] }),
  salin: () => drawer(`<h2>Salin Jadwal</h2><div class="f"><label>Dari hari</label><select id="sd">${HARI.map((h, i) => `<option value="${i}">${HARI_FULL[i]}</option>`).join('')}</select><label>Ke hari</label><div class="days">${[1, 2, 3, 4, 5, 6, 0].map(h => `<label><input type="checkbox" class="sk" value="${h}">${HARI[h]}</label>`).join('')}</div>
    <label>Kelompok</label><select id="sg"><option>Reguler</option><option>Ujian</option></select></div><div class="row" style="margin-top:20px"><button class="sec" data-act="closeD">Batal</button><button data-act="doSalin">Salin</button></div>`),
  doSalin: async () => { const r = await run('salinJadwal', { dari: +$('#sd').value, ke: [...document.querySelectorAll('.sk:checked')].map(x => +x.value), kelompok: $('#sg').value }); if (r.success) closeD(); },
  upl: async () => {
    const f = $('#nf').files[0], nama = $('#nn').value.trim();
    if (!f || !nama) return toast('Isi nama dan pilih file MP3', 'err');
    if (f.size > 5 * 1024 * 1024) return toast('Ukuran file melebihi 5 MB', 'err');
    const ab = await f.arrayBuffer(); let durasi = 0;
    try { durasi = Math.round((await ctx().decodeAudioData(ab.slice(0))).duration); } catch (e) { return toast('File MP3 tidak valid', 'err'); }
    const u8 = new Uint8Array(ab); let bin = ''; for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
    run('unggahNada', { nama, durasi, base64: btoa(bin) });
  },
  renN: d => { const n = prompt('Nama baru:', nm(d.n)); n && run('ubahNamaNada', { idNada: d.n, nama: n }); },
  delN: async d => { if (!confirm('Hapus nada ini?')) return; const r = await post('hapusNada', { idNada: d.n }); if (r.dipakai) { if (confirm(r.message)) run('hapusNada', { idNada: d.n, paksa: true }); } else { toast(r.message, r.success ? 'ok' : 'err'); load(); } },
  addL: () => run('tambahLibur', { mulai: $('#lm').value, selesai: $('#ls').value, keterangan: $('#lk').value }),
  delL: d => confirm('Hapus hari libur ini?') && run('hapusLibur', { id: d.id }),
  cari: cariRiw,
  simpanP: () => { const pin = $('#pp').value.trim(); const d = { namaSekolah: $('#ps').value, volume: +$('#pv').value }; if (pin || P().pinAktif && confirm('Kolom PIN kosong. Hapus PIN yang aktif?')) d.pinBaru = pin; run('simpanPengaturan', d); }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && A[b.dataset.act]) A[b.dataset.act](b.dataset); });
document.addEventListener('input', e => {
  const k = e.target.dataset.f; if (!k) return;
  S.f[k] = e.target.value; $('#jb').innerHTML = jrows();
});


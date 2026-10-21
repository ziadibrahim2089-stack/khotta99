"use strict";
// Everything lives on this phone: state in localStorage, meal photos in IndexedDB. No network calls.

const DAY = 86400000, GOAL_P = 150, WALK_GOAL = 30, LS = "k99-state";
const FOODS = [["3 بيضات",18],["زبادي يوناني",20],["فراخ 150جم",45],["تونة علبة",25],["جبنة قريش 100جم",12],["فول طبق",15],["لحمة 150جم",40],["لبن كوباية",8],["بروتين شيك",25]];
const TRIGGERS = ["ملل","تعب","سهر","زعل أو ضغط","شفت حلويات","بعد الأكل","جوع","مع ناس"];
const MILES = [1,3,7,14,21,30,45,60,90,120];
const WALK_LINES = [
  "البس الجزمة بس. لو بعد 10 دقايق عايز ترجع، ارجع.",
  "الجو ساقعة؟ البس تقيل. أول 5 دقايق بس اللي صعبة.",
  "تعبان؟ المشي بيدّي طاقة، مش بياخدها.",
  "مضايق؟ المشي من أسرع الحاجات اللي بتحسّن المزاج.",
  "30 دقيقة = حلقة مسلسل. بس وانت ماشي على الدانوب.",
  "كل يوم بتمشي فيه، الدهون الحشوية بتقل.",
  "بعد الأكل؟ 15 دقيقة مشي بتهدّي ارتفاع السكر في الدم.",
  "اسمع بودكاست أو كلّم ماما وانت ماشي."
];
const DEFAULTS = {
  name:"", momName:"ماما", momPhone:"", fine:200, startKg:0, goalKg:0,
  sugarFreeSince:"", journeyStart:"", doctorDate:"", walkTime:"18:00",
  eyeStory:"", reasons:[], plans:[], setupDone:false
};

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y,m,d] = k.split("-").map(Number); return new Date(y, m-1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate()+n); return keyOf(d); };
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / DAY);
const wdFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "long" });
const wdShort = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "short" });
const dm = k => { const d = parseKey(k); return `${d.getDate()}/${d.getMonth()+1}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));

/* ---------------- state ---------------- */
let S = load();
function blank() { return { settings: { ...DEFAULTS, sugarFreeSince: todayKey() }, days: {}, urges: [], lapses: [], weights: [], paid: {}, walkStart: null, sosStart: null }; }
function load() {
  try { const v = JSON.parse(localStorage.getItem(LS)); if (v && v.settings) { v.settings = { ...DEFAULTS, ...v.settings }; return { ...blank(), ...v }; } } catch (e) {}
  return blank();
}
function save() { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { toast("المساحة مليانة. خد نسخة احتياطية وامسح صور قديمة."); } }
function day(k = todayKey()) {
  if (!S.days[k]) S.days[k] = { protein: 0, plog: [], walk: 0, water: false, sleep: null, pledge: false, sugar: false, meals: 0 };
  return S.days[k];
}
const peekDay = k => S.days[k] || {};
function streak() { return Math.max(0, daysBetween(S.settings.sugarFreeSince || todayKey(), todayKey())); }
function walkStreak() {
  let n = 0, k = todayKey();
  if ((peekDay(k).walk || 0) < WALK_GOAL) k = addDays(k, -1);
  while ((peekDay(k).walk || 0) >= WALK_GOAL) { n++; k = addDays(k, -1); }
  return n;
}
// Fines are grouped in Saturday–Friday weeks; the key is that week's Friday.
function weekFri(k) { const d = parseKey(k); const off = (5 - d.getDay() + 7) % 7; d.setDate(d.getDate() + off); return keyOf(d); }
function finesByWeek() {
  const m = {};
  Object.entries(S.days).forEach(([k, v]) => { if (v.sugar) { const w = weekFri(k); m[w] = (m[w] || 0) + 1; } });
  return m;
}
function owedThisWeek() { return (finesByWeek()[weekFri(todayKey())] || 0) * S.settings.fine; }

/* ---------------- photos (IndexedDB) ---------------- */
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open("k99-photos", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("p", { keyPath: "id" }).createIndex("date", "date");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function putPhoto(rec) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("p", "readwrite"); t.objectStore("p").put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function photosOn(date) { const db = await idb(); return new Promise(res => { const q = db.transaction("p").objectStore("p").index("date").getAll(date); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); }
async function allPhotos() { const db = await idb(); return new Promise(res => { const q = db.transaction("p").objectStore("p").getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); }
function shrink(file) {
  return new Promise(res => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280, s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => res(b || file), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(file); };
    img.src = url;
  });
}

/* ---------------- ui helpers ---------------- */
function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
let openSheetId = null;
function openSheet(id) { closeSheet(); openSheetId = id; $(id).hidden = false; $("sheetBg").hidden = false; }
function closeSheet() { if (openSheetId) $(openSheetId).hidden = true; openSheetId = null; $("sheetBg").hidden = true; }
$("sheetBg").onclick = closeSheet;
document.querySelectorAll("[data-close]").forEach(b => b.onclick = closeSheet);
function go(tab) {
  ["today", "progress", "settings"].forEach(t => $("tab-" + t).hidden = t !== tab);
  document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("on", b.dataset.go === tab));
  window.scrollTo(0, 0); render();
}
document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("اتنسخ"); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("اتنسخ"); }
}
const rand = a => a[Math.floor(Math.random() * a.length)];

/* ---------------- render: today ---------------- */
function renderToday() {
  const s = S.settings, t = peekDay(todayKey()), st = streak(), h = new Date().getHours();
  $("hello").textContent = (h < 12 ? "صباح الخير" : h < 18 ? "أهلاً" : "مساء الخير") + (s.name ? " يا " + s.name : "");
  $("streak").textContent = st;
  const target = st < 14 ? 14 : st < 30 ? 30 : st < 90 ? 90 : Math.ceil((st + 1) / 30) * 30;
  $("ringArc").style.strokeDashoffset = (326.7 * (1 - Math.min(1, st / target))).toFixed(1);
  $("streakNote").textContent = st < 14 ? `فاضل ${14 - st} يوم وتعدّي أصعب فترة.` : `الهدف الجاي: ${target} يوم.`;
  $("setupNote").hidden = !!s.setupDone;

  // pledge: until done today
  $("pledgeCard").hidden = !!t.pledge;
  document.querySelectorAll("[data-sleep]").forEach(b => b.setAttribute("aria-pressed", String(t.sleep === (b.dataset.sleep === "1"))));
  $("riskNote").hidden = t.sleep !== false;

  // tiles
  const w = t.walk || 0, live = !!S.walkStart, ws = walkStreak();
  $("walkSub").textContent = live ? "ماشي دلوقتي…" : w >= WALK_GOAL ? `${w} دقيقة` : `${w} من ${WALK_GOAL} دقيقة`;
  $("walkFlame").hidden = ws < 1; $("walkFlame").textContent = `🔥 ${ws}`;
  tile("itWalk", w > 0 || live, w >= WALK_GOAL);
  const p = t.protein || 0;
  $("protSub").textContent = `${p} من ${GOAL_P} جم`;
  tile("itProt", p > 0, p >= GOAL_P);
  const last = (t.plog || []).slice(-1)[0];
  $("pLast").textContent = last ? `آخر حاجة: ${last[0]} (+${last[1]})` : "";
  $("pUndo").hidden = !last;
  $("waterSub").textContent = t.water ? "خلّصتها" : "اضغط لما تخلص";
  tile("itWater", !!t.water, !!t.water);

  // sugar link
  $("ateSugar").textContent = t.sugar ? "اتسجّل إنك كلت سكر النهارده" : "كلت سكر النهارده";
  $("ateSugar").disabled = !!t.sugar;
  renderMeals();
}
async function renderMeals() {
  let ps = [];
  try { ps = await photosOn(todayKey()); } catch (e) {}
  $("mealSub").textContent = ps.length ? `${ps.length} أكلة النهارده` : "ولا أكلة لسه";
  tile("itMeal", ps.length > 0, ps.length >= 3);
  const box = $("meals"); box.innerHTML = "";
  ps.sort((a, b) => a.ts - b.ts).forEach(r => {
    const b = document.createElement("button"); b.type = "button"; b.className = "mthumb";
    const img = document.createElement("img"); img.alt = "أكلة"; img.src = URL.createObjectURL(r.blob);
    const tm = document.createElement("span"); const d = new Date(r.ts); tm.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    b.append(img, tm); b.onclick = () => sharePhoto(r); box.appendChild(b);
  });
  if (day().meals !== ps.length) { day().meals = ps.length; save(); }
}

function tile(id, on, done) { const el = $(id); el.classList.toggle("on", on); el.classList.toggle("done", done); }

/* ---------------- render: progress ---------------- */
function renderProgress() {
  const s = S.settings, tk = todayKey();
  // week
  const wk = $("week"); wk.innerHTML = "";
  for (let i = 6; i >= 0; i--) {
    const k = addDays(tk, -i), r = peekDay(k);
    const clean = k >= (s.journeyStart || s.sugarFreeSince || tk) && k <= tk && !r.sugar;
    const c = document.createElement("div");
    c.innerHTML = `<div class="d">${wdShort.format(parseKey(k))}</div>`;
    const dot = document.createElement("div");
    dot.className = "dot" + (r.sugar ? " bad" : clean ? " ok" : "") + (k === tk ? " today" : "") + ((r.walk || 0) >= WALK_GOAL ? " walked" : "");
    dot.textContent = parseKey(k).getDate(); c.appendChild(dot); wk.appendChild(c);
  }
  renderWeights();
  // fines
  const fw = finesByWeek(), cur = weekFri(tk), weeks = Object.keys(fw).sort().reverse();
  const fBox = $("fines");
  if (!weeks.length) fBox.innerHTML = `<p class="muted small" style="margin:0">ما فيش غرامات. كمّل كده 💪</p>`;
  else {
    fBox.innerHTML = "";
    weeks.slice(0, 8).forEach(wkey => {
      const amt = fw[wkey] * s.fine, paid = !!S.paid[wkey], isCur = wkey === cur;
      const row = document.createElement("div"); row.className = "fine-row";
      row.innerHTML = `<span>أسبوع ${dm(addDays(wkey, -6))}–${dm(wkey)}<br><span class="muted small">${fw[wkey]} يوم سكر</span></span><b>${amt} جنيه</b>`;
      const pill = document.createElement("button"); pill.type = "button";
      pill.className = "pill " + (paid ? "paid" : isCur ? "" : "owe");
      pill.textContent = paid ? "اتدفع ✓" : isCur ? "بيتجمّع" : "علّم اتدفع";
      pill.onclick = () => { S.paid[wkey] = !paid; save(); render(); };
      row.appendChild(pill); fBox.appendChild(row);
    });
    const p = document.createElement("p"); p.className = "muted small"; p.style.margin = "0";
    p.textContent = "كل جمعة: اتبرع بالمبلغ لبنك الطعام المصري وابعت الإيصال لماما."; fBox.appendChild(p);
  }
  // milestones
  const st = streak();
  $("miles").innerHTML = MILES.map(m => `<div class="mile${st >= m ? " got" : ""}"><b>${m}</b>${m === 1 ? "يوم" : "يوم"}</div>`).join("");
  // danger hours (3-hour buckets)
  const b = new Array(8).fill(0); S.urges.forEach(u => b[Math.floor(new Date(u.t).getHours() / 3)]++);
  const mx = Math.max(1, ...b);
  $("hours").innerHTML = b.map((n, i) => `<div><i style="height:${Math.round(n / mx * 70)}px"></i><span>${i * 3}</span></div>`).join("");
  const tc = {}; S.urges.concat(S.lapses).forEach(u => (u.trig || []).forEach(x => tc[x] = (tc[x] || 0) + 1));
  const top = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const won = S.urges.filter(u => u.won).length;
  const drops = S.urges.filter(u => u.won && u.after != null).map(u => u.before - u.after);
  $("trigStats").textContent = S.urges.length
    ? `عدّيت ${won} من ${S.urges.length} رغبة.${drops.length ? ` الرغبة بتنزل في المتوسط ${(drops.reduce((a, c) => a + c, 0) / drops.length).toFixed(1)} درجة بعد 15 دقيقة.` : ""}${top.length ? " أكتر حاجة بتحرّكك: " + top.map(x => x[0]).join("، ") + "." : ""}`
    : "لسه ما استخدمتش زرار الطوارئ. لما تستخدمه هتشوف هنا إمتى الرغبة بتجيلك.";
  // doctor
  if (s.doctorDate) { const n = daysBetween(tk, s.doctorDate); $("docLine").textContent = n > 0 ? `دكتور العيون بعد ${n} يوم (${dm(s.doctorDate)})` : n === 0 ? "دكتور العيون النهارده" : "عدّل ميعاد دكتور العيون الجاي من الإعدادات"; }
  else $("docLine").textContent = "حط ميعاد دكتور العيون من الإعدادات";
}
function renderWeights() {
  const s = S.settings, ws = S.weights;
  const start = s.startKg || (ws[0] || {}).kg || 0;
  if (!start) { $("wstats").innerHTML = ""; $("chart").innerHTML = `<text x="170" y="85" font-size="12" fill="var(--muted)" text-anchor="middle">سجّل أول وزن</text>`; return; }
  const lastW = ws.length ? ws[ws.length - 1] : { kg: start };
  const goal = s.goalKg || lastW.kg, lost = start - lastW.kg, toGo = Math.max(0, lastW.kg - goal);
  const vis = [...ws].reverse().find(w => w.vis != null);
  $("wstats").innerHTML = `<div><b>${lastW.kg}</b><span>كجم دلوقتي</span></div><div><b>${lost > 0 ? "−" + lost.toFixed(1) : "0"}</b><span>نزلت</span></div><div><b>${toGo.toFixed(1)}</b><span>فاضل لـ${goal}</span></div>` + (vis ? "" : "");
  const svg = $("chart"), W = 340, H = 170, L = 34, R = 10, T = 12, B = 24;
  const pts = ws.length ? ws : [{ date: todayKey(), kg: start }];
  const t0 = parseKey(pts[0].date).getTime(), tEnd = Math.max(parseKey(pts[pts.length - 1].date).getTime(), t0 + 120 * DAY);
  const kgs = pts.map(p => p.kg).concat([goal]);
  const lo = Math.floor(Math.min(...kgs) - 1), hi = Math.ceil(Math.max(...kgs) + 1);
  const X = t => W - R - (t - t0) / (tEnd - t0) * (W - L - R);
  const Y = k => T + (hi - k) / (hi - lo) * (H - T - B);
  const step = hi - lo > 8 ? 4 : 2;
  let g = "";
  for (let k = Math.ceil(lo / step) * step; k <= hi; k += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(k)}" y2="${Y(k)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(k) + 4}" font-size="10" fill="var(--muted)" text-anchor="end">${k}</text>`;
  g += `<line x1="${L}" x2="${W - R}" y1="${Y(goal)}" y2="${Y(goal)}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W - R}" y="${Y(goal) - 6}" font-size="10" fill="var(--accent)" text-anchor="end">الهدف ${goal}</text>`;
  const mf = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { month: "short" }); const m = new Date(t0); m.setDate(1); m.setMonth(m.getMonth() + 1);
  while (m.getTime() <= tEnd) { g += `<text x="${X(m.getTime())}" y="${H - 6}" font-size="10" fill="var(--muted)" text-anchor="middle">${mf.format(m)}</text>`; m.setMonth(m.getMonth() + 1); }
  if (ws.length > 1) g += `<path d="${ws.map((w, i) => `${i ? "L" : "M"}${X(parseKey(w.date).getTime()).toFixed(1)} ${Y(w.kg).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--fg)" stroke-width="2" stroke-linejoin="round"/>`;
  pts.forEach((w, i) => { const l = i === pts.length - 1; g += `<circle cx="${X(parseKey(w.date).getTime())}" cy="${Y(w.kg)}" r="${l ? 5 : 3}" fill="${l ? "var(--amber)" : "var(--fg)"}"/>`; });
  svg.innerHTML = g;
}

/* ---------------- render: settings ---------------- */
function renderSettings() {
  const s = S.settings;
  ["name", "momPhone", "fine", "startKg", "goalKg", "sugarFreeSince", "doctorDate", "eyeStory"].forEach(k => { const el = $("s_" + k); if (document.activeElement !== el) el.value = s[k] ?? ""; });
  if (document.activeElement !== $("s_reasons")) $("s_reasons").value = (s.reasons || []).join("\n");
  if (document.activeElement !== $("s_plans")) $("s_plans").value = (s.plans || []).join("\n");
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { $("storageInfo").textContent = `مستخدم ${(e.usage / 1048576).toFixed(1)} ميجا.`; }).catch(() => {});
}
function render() {
  if (!$("tab-today").hidden) renderToday();
  if (!$("tab-progress").hidden) renderProgress();
  if (!$("tab-settings").hidden) renderSettings();
}

/* ---------------- actions: today ---------------- */
document.querySelectorAll("[data-sleep]").forEach(b => b.onclick = () => { day().sleep = b.dataset.sleep === "1"; save(); render(); });
$("pledgeBtn").onclick = () => { day().pledge = true; save(); render(); toast("اتعهدت. يوم حلو 💪"); };

// protein sheet
FOODS.forEach(([n, g]) => {
  const b = document.createElement("button"); b.type = "button"; b.className = "pbtn";
  b.innerHTML = `<b>+${g}</b><span></span>`; b.querySelector("span").textContent = n;
  b.onclick = () => { const t = day(); t.protein += g; t.plog.push([n, g]); t.plog = t.plog.slice(-40); save(); render(); };
  $("pgrid").appendChild(b);
});
$("itProt").onclick = () => openSheet("protSheet");
$("pUndo").onclick = () => { const t = day(), r = t.plog.pop(); if (r) t.protein = Math.max(0, t.protein - r[1]); save(); render(); };

// water
$("itWater").onclick = () => { const t = day(); t.water = !t.water; save(); render(); };

// walk
let walkTick = null;
function walkView() {
  const live = !!S.walkStart;
  $("walkIdle").hidden = live; $("walkLive").hidden = !live;
  $("walkTitle").textContent = live ? "ماشي 👏" : (day().walk || 0) >= WALK_GOAL ? "زوّد شوية؟" : "يلا ننزل";
  $("walkLine").textContent = live ? "كمّل. أول 30 دقيقة هي الهدف، و45 أحسن." : rand(WALK_LINES);
  clearInterval(walkTick);
  if (live) {
    const kg = (S.weights.slice(-1)[0] || {}).kg || S.settings.startKg || 80;
    const up = () => {
      const m = (Date.now() - S.walkStart) / 60000;
      $("walkElapsed").textContent = `${pad(Math.floor(m))}:${pad(Math.floor((m % 1) * 60))}`;
      $("walkKcal").textContent = `حوالي ${Math.round(4 * kg * m / 60)} سعر لحد دلوقتي` + (m >= 30 ? " · وصلت 30 ✓" : ` · فاضل ${Math.ceil(30 - m)} دقيقة على الهدف`);
    };
    up(); walkTick = setInterval(up, 1000);
  }
}
$("itWalk").onclick = () => { walkView(); openSheet("walkSheet"); };
$("walkStart").onclick = () => { S.walkStart = Date.now(); save(); walkView(); render(); };
$("walkStop").onclick = () => {
  const m = Math.round((Date.now() - S.walkStart) / 60000); S.walkStart = null;
  if (m > 0) day().walk = (day().walk || 0) + Math.min(m, 240);
  save(); clearInterval(walkTick); closeSheet(); render();
  toast(day().walk >= WALK_GOAL ? `${day().walk} دقيقة النهارده. برافو 🎉` : `اتسجّل ${m} دقيقة`);
};
document.querySelectorAll("[data-walk]").forEach(b => b.onclick = () => { const t = day(); t.walk = (t.walk || 0) + Number(b.dataset.walk); save(); closeSheet(); render(); toast(`${t.walk} دقيقة النهارده`); });

// meal photos
$("mealInput").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
  const blob = await shrink(f), ts = Date.now();
  const rec = { id: "m" + ts, date: todayKey(), ts, blob };
  try { await putPhoto(rec); } catch (err) { toast("الصورة ما اتحفظتش"); return; }
  await renderMeals(); sharePhoto(rec);
});
async function sharePhoto(r) {
  const d = new Date(r.ts), name = `meal-${r.date}-${pad(d.getHours())}${pad(d.getMinutes())}.jpg`;
  const file = new File([r.blob], name, { type: "image/jpeg" });
  const text = `أكلتي الساعة ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); } catch (e) {}
  } else toast("الصورة اتحفظت. افتح الأبلكيشن من الآيفون عشان تبعتها.");
}

// report
function momReport() {
  const s = S.settings, t = peekDay(todayKey()), st = streak(), yn = b => b ? "✅" : "❌";
  const lastW = S.weights.slice(-1)[0];
  const won = S.urges.filter(u => u.won && keyOf(new Date(u.t)) === todayKey()).length;
  return [
    `${s.momName || "ماما"}، ده تقرير ${s.name || "النهارده"} – ${wdFmt.format(new Date())} ${dm(todayKey())}`,
    "",
    t.sugar ? "❌ كلت سكر النهارده" : `✅ من غير سكر – ${st} يوم ورا بعض`,
    `🚶 مشيت ${t.walk || 0} دقيقة ${(t.walk || 0) >= WALK_GOAL ? "✅" : "(الهدف 30)"}`,
    `📸 صورت ${t.meals || 0} أكلة`,
    `🥚 بروتين ${t.protein || 0} من ${GOAL_P} جم`,
    `😴 نمت قبل 12:30: ${t.sleep == null ? "ما سجلتش" : yn(t.sleep)}`,
    `💧 مية: ${yn(t.water)}`,
    won ? `💪 عدّيت ${won} مرة اشتهيت فيها حلويات` : "",
    `💸 غرامات الأسبوع ده: ${owedThisWeek()} جنيه`,
    lastW ? `⚖️ آخر وزن: ${lastW.kg} كجم${s.goalKg ? ` (الهدف ${s.goalKg})` : ""}` : ""
  ].filter(x => x !== "").join("\n");
}
$("sendMom").onclick = () => {
  const phone = (S.settings.momPhone || "").replace(/[^\d]/g, "");
  if (!phone) { toast("حط رقم ماما في الإعدادات الأول"); go("settings"); return; }
  location.href = `https://wa.me/${phone}?text=${encodeURIComponent(momReport())}`;
};

// sugar + lapse review
let lapseTrig = new Set();
function chips(box, selected, list) {
  box.innerHTML = "";
  list.forEach(x => { const b = document.createElement("button"); b.type = "button"; b.textContent = x; b.setAttribute("aria-pressed", String(selected.has(x)));
    b.onclick = () => { selected.has(x) ? selected.delete(x) : selected.add(x); b.setAttribute("aria-pressed", String(selected.has(x))); }; box.appendChild(b); });
}
function startLapse(fromSos) {
  $("fineNow").textContent = S.settings.fine;
  $("sugarAsk").hidden = !!fromSos; $("sugarReview").hidden = !fromSos;
  if (fromSos) logSugar();
  lapseTrig = new Set(fromSos ? sosTrig : []); chips($("lapseTrigs"), lapseTrig, TRIGGERS); $("lapsePlan").value = "";
  openSheet("sugarSheet");
}
function logSugar() {
  const t = day(); if (t.sugar) return;
  t.sugar = true; S.settings.sugarFreeSince = addDays(todayKey(), 1); save(); render();
}
$("ateSugar").onclick = () => startLapse(false);
$("sugarYes").onclick = () => { logSugar(); $("sugarAsk").hidden = true; $("sugarReview").hidden = false; };
$("lapseSave").onclick = () => {
  const plan = $("lapsePlan").value.trim();
  S.lapses.push({ date: todayKey(), t: Date.now(), trig: [...lapseTrig], plan });
  if (plan) S.settings.plans = [plan, ...(S.settings.plans || [])].slice(0, 12);
  save(); closeSheet(); render(); toast("اتحفظت. الوجبة الجاية بروتين");
};

/* ---------------- SOS ---------------- */
let sosTrig = new Set(), sosTick = null, factIdx = -1;
function showFact() {
  const F = window.FACTS || []; if (!F.length) return;
  let i; do { i = Math.floor(Math.random() * F.length); } while (F.length > 1 && i === factIdx); factIdx = i;
  const [c, t, b, s] = F[i]; $("factCat").textContent = c; $("factTitle").textContent = t; $("factBody").textContent = b; $("factSrc").textContent = s;
}
function openSos() {
  const s = S.settings;
  $("eyeStory").textContent = s.eyeStory || "افتكر ليه بدأت. السكر بيأذي الأوعية الدموية الرفيعة في العين والكلى والمخ.";
  $("eyeStory").hidden = false;
  showFact();
  sosTrig = new Set(); chips($("trigs"), sosTrig, TRIGGERS);
  $("before").value = 7; $("beforeVal").textContent = 7;
  const running = S.sosStart && Date.now() - S.sosStart < 15 * 60000;
  $("sosStep1").hidden = running; $("sosStep2").hidden = !running;
  if (running) startTimer();
  $("sos").hidden = false; $("sosBtn").hidden = true; document.body.style.overflow = "hidden";
}
function closeSos() { $("sos").hidden = true; $("sosBtn").hidden = false; document.body.style.overflow = ""; clearInterval(sosTick); }
function startTimer() {
  const s = S.settings, st = streak();
  $("stakes").innerHTML = `<div><b>${s.fine}</b>جنيه غرامة</div><div><b>${st}</b>يوم هيضيعوا</div>`;
  const plans = (s.plans || []).slice(0, 4), reasons = (s.reasons || []).slice(0, 3);
  $("planList").innerHTML = plans.concat(reasons).map(x => `<li>${esc(x)}</li>`).join("");
  $("after").value = $("before").value; $("afterVal").textContent = $("after").value;
  clearInterval(sosTick);
  const up = () => { const left = Math.max(0, 15 * 60000 - (Date.now() - S.sosStart));
    $("timer").textContent = left ? `${pad(Math.floor(left / 60000))}:${pad(Math.floor(left % 60000 / 1000))}` : "عدّت ✓"; if (!left) clearInterval(sosTick); };
  up(); sosTick = setInterval(up, 1000);
}
$("sosBtn").onclick = openSos;
$("sosClose").onclick = closeSos;
$("nextFact").onclick = showFact;
$("before").oninput = e => $("beforeVal").textContent = e.target.value;
$("after").oninput = e => $("afterVal").textContent = e.target.value;
$("sosGo").onclick = () => { S.sosStart = Date.now(); S.sosBefore = Number($("before").value); S.sosTrig = [...sosTrig]; save(); $("sosStep1").hidden = true; $("sosStep2").hidden = false; startTimer(); window.scrollTo(0, 0); };
function endSos(won) {
  S.urges.push({ t: S.sosStart || Date.now(), trig: S.sosTrig || [...sosTrig], before: S.sosBefore ?? Number($("before").value), after: Number($("after").value), won });
  S.urges = S.urges.slice(-500); S.sosStart = null; save(); closeSos(); render();
}
$("sosWin").onclick = () => { endSos(true); toast("برافو. كل مرة بتعدّيها بتبقى أسهل 💪"); };
$("sosLose").onclick = () => { sosTrig = new Set(S.sosTrig || []); endSos(false); startLapse(true); };

/* ---------------- progress actions ---------------- */
$("addWeight").onclick = () => openSheet("weightSheet");
$("wform").addEventListener("submit", e => {
  e.preventDefault();
  const kg = parseFloat($("wKg").value); if (!(kg > 30 && kg < 300)) { toast("اكتب الوزن بالكيلو، مثلاً 109.4"); return; }
  const w = { date: todayKey(), kg: Math.round(kg * 10) / 10 }; const f = parseFloat($("wFat").value), v = parseFloat($("wVis").value);
  if (f > 0) w.fat = f; if (v > 0) w.vis = v;
  S.weights = S.weights.filter(x => x.date !== w.date).concat([w]).sort((a, b) => a.date < b.date ? -1 : 1);
  save(); $("wform").reset(); closeSheet(); render(); toast("الوزن اتسجّل");
});
$("copyWeek").onclick = () => {
  const tk = todayKey(), ks = Array.from({ length: 7 }, (_, i) => addDays(tk, i - 6));
  const rows = ks.map(k => { const d = peekDay(k); return `${k} ${wdShort.format(parseKey(k))}: سكر ${d.sugar ? "أيوه" : "لأ"} | مشي ${d.walk || 0}د | بروتين ${d.protein || 0}جم | صور ${d.meals || 0} | نوم بدري ${d.sleep == null ? "-" : d.sleep ? "أيوه" : "لأ"} | تعهد ${d.pledge ? "أيوه" : "لأ"}`; });
  const urg = S.urges.filter(u => u.t >= parseKey(ks[0]).getTime());
  const txt = [`ملخص أسبوع خطة 99 (${ks[0]} لـ ${tk})`, `أيام من غير سكر دلوقتي: ${streak()} | سلسلة المشي: ${walkStreak()}`, ...rows,
    `رغبات الأسبوع: ${urg.length}، عدّيت ${urg.filter(u => u.won).length}. أوقاتها: ${urg.map(u => new Date(u.t).getHours() + ":00").join("، ") || "-"}. الأسباب: ${[...new Set(urg.flatMap(u => u.trig || []))].join("، ") || "-"}`,
    `الأوزان: ${S.weights.slice(-4).map(w => `${w.date} ${w.kg}${w.vis ? " حشوية " + w.vis : ""}`).join(" | ") || "-"}`,
    `غرامات الأسبوع: ${owedThisWeek()} جنيه`].join("\n");
  copy(txt);
};

/* ---------------- settings actions ---------------- */
$("importBtn").onclick = () => {
  let v; try { v = JSON.parse($("importCode").value.trim()); } catch (e) { toast("الكود مش كامل. انسخه تاني كله من أوله لآخره."); return; }
  if (!v || typeof v !== "object") { toast("الكود مش صح"); return; }
  const keep = Object.keys(DEFAULTS); keep.forEach(k => { if (v[k] !== undefined) S.settings[k] = v[k]; });
  if (Array.isArray(v.weights)) v.weights.forEach(w => { if (!S.weights.some(x => x.date === w.date)) S.weights.push(w); });
  S.weights.sort((a, b) => a.date < b.date ? -1 : 1);
  if (!S.settings.journeyStart) S.settings.journeyStart = S.settings.sugarFreeSince;
  S.settings.setupDone = true; save(); $("importCode").value = ""; toast("اتحفظ ✓"); go("today");
};
$("saveSettings").onclick = () => {
  const s = S.settings;
  s.name = $("s_name").value.trim(); s.momPhone = $("s_momPhone").value.trim();
  s.fine = Math.max(0, Number($("s_fine").value) || 0);
  s.startKg = Number($("s_startKg").value) || s.startKg; s.goalKg = Number($("s_goalKg").value) || s.goalKg;
  s.sugarFreeSince = $("s_sugarFreeSince").value || s.sugarFreeSince; s.doctorDate = $("s_doctorDate").value;
  s.eyeStory = $("s_eyeStory").value.trim();
  s.reasons = $("s_reasons").value.split("\n").map(x => x.trim()).filter(Boolean);
  s.plans = $("s_plans").value.split("\n").map(x => x.trim()).filter(Boolean);
  s.setupDone = true; save(); toast("اتحفظ ✓"); render();
};
const toDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
$("exportBtn").onclick = async () => {
  toast("بجهّز النسخة…");
  const ph = await allPhotos(), photos = [];
  for (const p of ph) photos.push({ id: p.id, date: p.date, ts: p.ts, data: await toDataURL(p.blob) });
  const file = new File([JSON.stringify({ v: 1, exported: new Date().toISOString(), state: S, photos })], `khotta99-backup-${todayKey()}.json`, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch (e) {} }
  else { const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); }
};
$("restoreInput").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const v = JSON.parse(await f.text()); if (!v.state || !v.state.settings) throw 0;
    S = { ...blank(), ...v.state, settings: { ...DEFAULTS, ...v.state.settings } }; save();
    for (const p of v.photos || []) { const blob = await (await fetch(p.data)).blob(); await putPhoto({ id: p.id, date: p.date, ts: p.ts, blob }); }
    toast("رجعت كل حاجة ✓"); go("today");
  } catch (err) { toast("الملف ده مش نسخة من خطة 99"); }
});

/* ---------------- boot ---------------- */
if (S.walkStart && Date.now() - S.walkStart > 4 * 3600000) S.walkStart = null; // forgotten timer
render.k = todayKey();
render();
setInterval(() => { if (render.k !== todayKey()) { render.k = todayKey(); render(); } }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
if (S.sosStart && Date.now() - S.sosStart < 15 * 60000) openSos();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

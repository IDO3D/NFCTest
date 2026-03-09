import { useState, useEffect, useRef, useCallback, useReducer, createContext, useContext } from "react";

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  LOUD CITY PASS  ·  v5.0  ·  GAMEDAY INTELLIGENCE SYSTEM                   ║
// ║  Fan App: Real QR display + stamp journey                                   ║
// ║  Staff App: Live camera QR scanner → instant intel → saves to dashboard     ║
// ║  Shared: Real-time event feed · Analytics · Offline queue                   ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════════ TOKENS ══════════
const C = {
  navy:"#002D62", navyDk:"#00193A", blue:"#007AC1", blueHi:"#1AABF0",
  orange:"#EF3B23", orangeHi:"#FF5A40", gold:"#FDB927", goldHi:"#FFD060",
  cream:"#F0EDE6", ink:"#040B17", inkMid:"#071120", inkLite:"#0B1A2E",
  line:"rgba(255,255,255,0.07)", lineHi:"rgba(255,255,255,0.14)",
  fog:"rgba(240,237,230,0.4)",
  ok:"#22D46A", warn:"#F5A623", fail:"#E53E3E", scan:"#00FF88",
};

const STATIONS = {
  s1:{id:"s1",name:"Draft Board",     full:"Thunder Draft Board",   icon:"⚡",loc:"Lobby A",      color:C.blue,   type:"nfc"},
  s2:{id:"s2",name:"Trophy Wall",     full:"Championship Wall",     icon:"🏆",loc:"Main Hall",    color:C.gold,   type:"nfc"},
  s3:{id:"s3",name:"Player Tunnel",   full:"Player Tunnel",         icon:"🎽",loc:"Corridor B",   color:C.orange, type:"nfc"},
  s4:{id:"s4",name:"Loud City Stage", full:"Loud City Stage",       icon:"🎤",loc:"Stage Area",   color:C.blueHi, type:"nfc"},
  s5:{id:"s5",name:"Digital Wall",    full:"Digital Wall",          icon:"🎮",loc:"East Wing",    color:C.goldHi, type:"game"},
  s6:{id:"s6",name:"Stats Kiosk",     full:"Stats Kiosk",           icon:"📊",loc:"Info Center",  color:C.ok,     type:"kiosk"},
};
const TOTAL = 6;

// ═══════════════════════════════════════════════════════ PERSISTENCE ══════════
const DB_KEY = "lc_v5", SESS_KEY = "lc_sess_v5";
const DB = {
  load: () => { try { const r = localStorage.getItem(DB_KEY); return r ? JSON.parse(r) : null; } catch { return null; } },
  save: (d) => { try { localStorage.setItem(DB_KEY, JSON.stringify(d)); } catch {} },
  loadSess: () => { try { const r = localStorage.getItem(SESS_KEY); return r ? JSON.parse(r) : null; } catch { return null; } },
  saveSess: (s) => { try { localStorage.setItem(SESS_KEY, JSON.stringify(s)); } catch {} },
};

const uid = (p="") => { const b = new Uint8Array(8); crypto.getRandomValues(b); return p + Array.from(b, x => x.toString(16).padStart(2,"0")).join("").toUpperCase(); };
const tok = () => { const b = new Uint8Array(8); crypto.getRandomValues(b); const h = Array.from(b, x => x.toString(16).padStart(2,"0")).join("").toUpperCase(); return `${h.slice(0,4)}-${h.slice(4,8)}-${h.slice(8,12)}-${h.slice(12,16)}`; };
const otp = () => String(100000 + Math.floor(Math.random() * 900000));
const now = () => Date.now();

function seedDB() {
  const db = {
    v: 5,
    accounts: {}, profiles: {}, issuances: {}, cards: {},
    scanLog: [],        // every staff scan event
    stampEvents: [],    // every stamp event
    liveEvents: [],     // merged real-time feed (last 100)
    metrics: { regs:0, cards:0, stamps:0, redeems:0, scans:0, byStation:{s1:0,s2:0,s3:0,s4:0,s5:0,s6:0} },
  };
  // Seed 4 demo fans
  const demos = [
    { name:"Jordan M.",   email:"jordan@okc.test",  stamps:["s1","s2","s3"],       redeemed:false },
    { name:"Shai Fan",    email:"shai@okc.test",    stamps:["s1","s2","s3","s4","s5","s6"], redeemed:true },
    { name:"KD Returns",  email:"kd@okc.test",      stamps:[],                     redeemed:false },
    { name:"Chet O.",     email:"chet@okc.test",    stamps:["s1","s2"],            redeemed:false },
  ];
  demos.forEach((demo, i) => {
    const aid = uid("A"), pid = uid("P"), iid = uid("I"), token = tok();
    const stampsObj = {};
    demo.stamps.forEach(sid => { stampsObj[sid] = now() - (6-i)*100000 - Math.random()*50000; });
    db.accounts[demo.email] = { aid, el:demo.email, verified:true, ts:now()-900000, otp:"000000", otpExp:0, cnt:1 };
    db.profiles[pid] = { id:pid, aid, type:"adult", name:demo.name, stamps:stampsObj, redeemed:demo.redeemed, ts:now()-900000 };
    db.issuances[iid] = { aid, pids:[pid], ts:now()-900000, exp:now()+7200000, used:false };
    db.cards[token] = { token, pid, aid, iid, active:!demo.redeemed, ts:now()-900000, returned:demo.redeemed?now()-50000:null };
    db.metrics.regs++;
    db.metrics.cards++;
    db.metrics.stamps += demo.stamps.length;
    if (demo.redeemed) db.metrics.redeems++;
    demo.stamps.forEach(sid => { db.metrics.byStation[sid]++; });
    // Seed some events for the live feed
    demo.stamps.forEach((sid, j) => {
      const cnt = j + 1;
      const evtBase = { id:uid("E"), pid, name:demo.name, token, ts:now()-900000+(j*60000), r:"ok", count:cnt, done:cnt>=TOTAL };
      db.stampEvents.push({ ...evtBase, sid, stationName:STATIONS[sid].full, type:"stamp", source:"nfc" });
      db.liveEvents.push({ ...evtBase, sid, stationName:STATIONS[sid].full, type:"stamp", source:"nfc" });
    });
    if (demo.redeemed) {
      const rev = { id:uid("E"), pid, name:demo.name, token, ts:now()-50000, r:"ok", count:demo.stamps.length, done:true, type:"redeem" };
      db.liveEvents.push(rev);
    }
  });
  db.liveEvents.sort((a,b) => b.ts - a.ts);
  db.stampEvents.sort((a,b) => b.ts - a.ts);
  DB.save(db);
  return db;
}

function initDB() {
  const d = DB.load();
  if (d && d.v === 5) return d;
  return seedDB();
}

// ═══════════════════════════════════════════════════════ STATE MACHINE ═════════
const Ctx = createContext(null);
const useCtx = () => useContext(Ctx);

function reducer(s, a) {
  switch (a.t) {
    case "PUSH": return { ...s, screen:a.s, stack:[...s.stack, s.screen] };
    case "POP":  { const st=[...s.stack]; const prev=st.pop()||"home"; return {...s, screen:prev, stack:st}; }
    case "GO":   return { ...s, screen:a.s, stack:[] };
    case "DB":   DB.save(a.db); return { ...s, db:{...a.db} };
    case "SESS": DB.saveSess(a.v); return { ...s, sess:a.v };
    case "NET":  return { ...s, online:a.v };
    case "TOAST":return { ...s, toast:a.v };
    default: return s;
  }
}

// ═══════════════════════════════════════════════════════════════ CSS ══════════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@400;500;600;700;800;900&family=Barlow+Condensed:ital,wght@0,400;0,600;0,700;0,800;0,900;1,700&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html{height:100%;font-size:16px}
body,#root{min-height:100dvh;font-family:'Barlow',system-ui,sans-serif;background:#040B17;color:#F0EDE6;overflow-x:hidden;-webkit-font-smoothing:antialiased}
input,button,select{font-family:inherit}
::-webkit-scrollbar{width:2px}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:4px}

.shell{min-height:100dvh;position:relative;background:#040B17}
.shell-bg{position:fixed;inset:0;pointer-events:none;z-index:0}
.shell-bg::before{content:'';position:absolute;inset:0;
  background-image:repeating-linear-gradient(90deg,transparent,transparent 59px,rgba(255,255,255,0.012) 60px),
    repeating-linear-gradient(0deg,transparent,transparent 59px,rgba(255,255,255,0.007) 60px)}
.shell-bg::after{content:'';position:absolute;inset:0;
  background:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(0,122,193,0.18) 0%,transparent 65%),
    radial-gradient(ellipse 50% 40% at 95% 90%,rgba(239,59,35,0.09) 0%,transparent 60%)}

/* ── PAGE LAYOUTS ── */
.fan-page{position:relative;z-index:1;min-height:100dvh;display:flex;flex-direction:column;align-items:center;padding:0 18px 92px;max-width:430px;margin:0 auto}
.staff-page{position:relative;z-index:1;min-height:100dvh;display:flex;flex-direction:column;max-width:430px;margin:0 auto}

/* ── TYPOGRAPHY ── */
.ant{font-family:'Anton',sans-serif;text-transform:uppercase;line-height:0.92;letter-spacing:0.5px}
.bc{font-family:'Barlow Condensed',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:0.5px}
.lbl{font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:rgba(240,237,230,0.38)}
.mono{font-family:'SF Mono','Fira Code','Courier New',monospace;letter-spacing:0.5px}

/* ── SURFACES ── */
.s1{background:rgba(7,17,32,0.82);border:1px solid rgba(255,255,255,0.07);border-radius:20px;backdrop-filter:blur(32px)}
.s2{background:rgba(12,24,44,0.92);border:1px solid rgba(255,255,255,0.13);border-radius:20px;backdrop-filter:blur(32px)}
.s3{background:rgba(4,11,23,0.7);border:1px solid rgba(255,255,255,0.05);border-radius:13px}
.staff-surf{background:rgba(5,13,25,0.95);border:1px solid rgba(0,122,193,0.18);border-radius:14px}

/* ── BUTTONS ── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:none;border-radius:12px;
  font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:800;letter-spacing:1px;text-transform:uppercase;
  cursor:pointer;user-select:none;transition:transform 0.1s,filter 0.15s,box-shadow 0.15s;
  position:relative;overflow:hidden;white-space:nowrap;height:52px;padding:0 22px}
.btn::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,0.1) 0%,transparent 60%);pointer-events:none}
.btn:active:not(:disabled){transform:scale(0.95)}
.btn:disabled{opacity:0.3;cursor:not-allowed}
.btn-full{width:100%}
.btn-sm{height:38px;padding:0 14px;font-size:12px;border-radius:9px}
.btn-bl{background:linear-gradient(150deg,#1AABF0,#007AC1,#005f99);color:#fff;box-shadow:0 6px 24px rgba(0,122,193,0.42)}
.btn-bl:hover:not(:disabled){box-shadow:0 10px 32px rgba(0,122,193,0.65);filter:brightness(1.07)}
.btn-or{background:linear-gradient(150deg,#FF5A40,#EF3B23,#c4200a);color:#fff;box-shadow:0 6px 24px rgba(239,59,35,0.42)}
.btn-or:hover:not(:disabled){box-shadow:0 10px 32px rgba(239,59,35,0.65);filter:brightness(1.07)}
.btn-gd{background:linear-gradient(150deg,#FFD060,#FDB927,#d49400);color:#1a0c00;box-shadow:0 6px 24px rgba(253,185,39,0.42)}
.btn-gd:hover:not(:disabled){box-shadow:0 10px 32px rgba(253,185,39,0.65);filter:brightness(1.06)}
.btn-gh{background:rgba(240,237,230,0.05);border:1.5px solid rgba(255,255,255,0.13);color:rgba(240,237,230,0.42)}
.btn-gh:hover:not(:disabled){background:rgba(240,237,230,0.09);color:#F0EDE6}
.btn-scan{background:linear-gradient(150deg,#00FFB0,#00FF88,#00CC66);color:#040B17;font-size:16px;box-shadow:0 6px 28px rgba(0,255,136,0.4)}
.btn-scan:hover:not(:disabled){box-shadow:0 10px 36px rgba(0,255,136,0.65);filter:brightness(1.06)}
.btn-ic{width:44px;height:44px;padding:0;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#F0EDE6;font-size:18px;box-shadow:none}

/* ── INPUTS ── */
.inp{width:100%;background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.08);border-radius:13px;
  padding:14px 16px;color:#F0EDE6;font-size:16px;font-weight:500;outline:none;
  transition:border-color 0.2s,background 0.2s,box-shadow 0.2s}
.inp:focus{border-color:rgba(0,122,193,0.75);background:rgba(0,122,193,0.08);box-shadow:0 0 0 3px rgba(0,122,193,0.15)}
.inp::placeholder{color:rgba(240,237,230,0.2)}
.inp-staff{border-color:rgba(0,122,193,0.22);background:rgba(0,122,193,0.05)}

/* ── OTP ── */
.otp-wrap{display:flex;gap:8px;justify-content:center}
.otp-box{width:48px;height:60px;background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.08);
  border-radius:12px;font-family:'Anton',sans-serif;font-size:28px;color:#F0EDE6;text-align:center;
  outline:none;caret-color:#007AC1;transition:all 0.15s}
.otp-box:focus{border-color:#007AC1;background:rgba(0,122,193,0.1);box-shadow:0 0 0 3px rgba(0,122,193,0.18)}
.otp-box.v{border-color:rgba(0,122,193,0.5)}

/* ── BADGES ── */
.bdg{display:inline-flex;align-items:center;gap:4px;font-family:'Barlow Condensed',sans-serif;
  font-size:9px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;padding:4px 9px;border-radius:20px}
.bdg-bl{color:#1AABF0;background:rgba(0,122,193,0.14);border:1px solid rgba(0,122,193,0.3)}
.bdg-gd{color:#FDB927;background:rgba(253,185,39,0.12);border:1px solid rgba(253,185,39,0.3)}
.bdg-or{color:#FF5A40;background:rgba(239,59,35,0.12);border:1px solid rgba(239,59,35,0.3)}
.bdg-gn{color:#22D46A;background:rgba(34,212,106,0.1);border:1px solid rgba(34,212,106,0.26)}
.bdg-mu{color:rgba(240,237,230,0.4);background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08)}
.bdg-lv{color:#22D46A;background:rgba(34,212,106,0.1);border:1px solid rgba(34,212,106,0.26);animation:blink 2s ease-in-out infinite}
.bdg-rd{color:#fc9090;background:rgba(229,62,62,0.12);border:1px solid rgba(229,62,62,0.28)}

/* ── PROGRESS ── */
.prog{width:100%;height:4px;background:rgba(255,255,255,0.07);border-radius:20px;position:relative}
.prog-f{height:100%;border-radius:20px;background:linear-gradient(90deg,#007AC1,#FDB927);transition:width 0.8s cubic-bezier(0.34,1.56,0.64,1);position:relative}
.prog-f::after{content:'';position:absolute;right:-5px;top:50%;transform:translateY(-50%);width:10px;height:10px;
  border-radius:50%;background:#FDB927;box-shadow:0 0 12px #FDB927,0 0 24px rgba(253,185,39,0.5)}

/* ── STAMP GRID ── */
.sgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%}
.stile{aspect-ratio:1;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;
  border:1.5px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.025);
  transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1);position:relative;overflow:hidden}
.stile::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,0.04) 0%,transparent 55%);pointer-events:none}
.stile.on{background:linear-gradient(145deg,rgba(0,122,193,0.22),rgba(253,185,39,0.12));border-color:rgba(253,185,39,0.5);
  box-shadow:0 6px 28px rgba(253,185,39,0.16),inset 0 1px 0 rgba(255,255,255,0.1)}
.stile .ico{font-size:24px;filter:grayscale(1) opacity(0.22);transition:all 0.4s}
.stile.on .ico{filter:none;opacity:1}
.stile .nm{font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;
  color:rgba(240,237,230,0.25);text-align:center;padding:0 4px;line-height:1.2;transition:color 0.4s}
.stile.on .nm{color:#FDB927}
.stile .chk{position:absolute;top:7px;right:7px;width:16px;height:16px;border-radius:50%;
  background:linear-gradient(135deg,#FDB927,#FFD060);display:flex;align-items:center;justify-content:center;
  font-size:8px;color:#1a0a00;font-weight:900;box-shadow:0 2px 10px rgba(253,185,39,0.6)}

/* ══ QR SCANNER (STAFF) ══ */
.scan-shell{
  position:relative;width:100%;border-radius:20px;overflow:hidden;background:#000;
}
.scan-video{width:100%;height:100%;object-fit:cover;display:block;min-height:280px}
.scan-overlay{position:absolute;inset:0;pointer-events:none}
/* Dark vignette around the frame */
.scan-vignette{
  position:absolute;inset:0;
  background:radial-gradient(ellipse 58% 58% at center,transparent 30%,rgba(4,11,23,0.82) 100%);
}
/* Animated frame corners */
.scan-frame{
  position:absolute;width:62%;height:62%;
  top:50%;left:50%;transform:translate(-50%,-50%);
}
.sc{position:absolute;width:32px;height:32px}
.sc::before,.sc::after{content:'';position:absolute;background:#00FF88;border-radius:1px}
.sc.tl{top:0;left:0}.sc.tl::before{top:0;left:0;width:3px;height:100%}.sc.tl::after{top:0;left:0;width:100%;height:3px}
.sc.tr{top:0;right:0}.sc.tr::before{top:0;right:0;width:3px;height:100%}.sc.tr::after{top:0;right:0;width:100%;height:3px}
.sc.bl{bottom:0;left:0}.sc.bl::before{bottom:0;left:0;width:3px;height:100%}.sc.bl::after{bottom:0;left:0;width:100%;height:3px}
.sc.br{bottom:0;right:0}.sc.br::before{bottom:0;right:0;width:3px;height:100%}.sc.br::after{bottom:0;right:0;width:100%;height:3px}
/* Scan line */
.scan-beam{
  position:absolute;left:0;right:0;height:2px;
  background:linear-gradient(90deg,transparent 5%,#00FF88 50%,transparent 95%);
  box-shadow:0 0 14px #00FF88,0 0 28px rgba(0,255,136,0.5);
  animation:beam 2.2s ease-in-out infinite;
}
.scan-status-bar{
  position:absolute;bottom:0;left:0;right:0;padding:12px 16px;
  background:linear-gradient(transparent,rgba(4,11,23,0.95));
  display:flex;align-items:center;justify-content:center;gap:8px;
}
.scan-no-cam{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:14px;padding:36px 24px;text-align:center;border-radius:20px;
  background:rgba(7,17,32,0.88);border:1px solid rgba(255,255,255,0.08);min-height:260px;
}

/* ══ QR VISUAL (FAN) ══ */
.qr-wrap{background:white;border-radius:18px;padding:14px;display:inline-flex;align-items:center;justify-content:center}

/* ══ NFC CARD ══ */
.card{
  width:100%;max-width:330px;height:192px;border-radius:22px;position:relative;overflow:hidden;
  background:linear-gradient(135deg,#00193A 0%,#002D62 45%,#003d7a 100%);
  border:1px solid rgba(0,90,180,0.4);box-shadow:0 24px 72px rgba(0,0,0,0.65);margin:0 auto;
}
.card::before{content:'';position:absolute;top:-50px;right:-50px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(0,122,193,0.32),transparent 70%)}
.card::after{content:'';position:absolute;bottom:-40px;left:-30px;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,rgba(239,59,35,0.2),transparent 70%)}
.card-inner{position:absolute;inset:0;padding:20px 22px;display:flex;flex-direction:column;justify-content:space-between;z-index:2}
.card-stripe{position:absolute;top:0;right:0;bottom:0;width:5px;background:linear-gradient(180deg,#EF3B23,#FDB927)}

/* ══ TOPNAV ══ */
.tnav{width:100%;display:flex;align-items:center;justify-content:space-between;padding:18px 0 14px;flex-shrink:0}
.wm{font-family:'Anton',sans-serif;font-size:20px;letter-spacing:2px;text-transform:uppercase;
  background:linear-gradient(90deg,#F0EDE6,rgba(240,237,230,0.7));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.wm-s{background:linear-gradient(90deg,#1AABF0,#007AC1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}

/* ══ TABS ══ */
.tabs{display:flex;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:13px;padding:3px;width:100%}
.tab{flex:1;padding:9px 4px;border-radius:10px;border:none;font-family:'Barlow Condensed',sans-serif;
  font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;cursor:pointer;
  transition:all 0.2s;background:transparent;color:rgba(240,237,230,0.32)}
.tab.on{background:rgba(0,122,193,0.22);color:#F0EDE6;border:1px solid rgba(0,122,193,0.35);box-shadow:0 2px 12px rgba(0,122,193,0.2)}

/* ══ BOTTOM NAV (fan) ══ */
.bnav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:430px;
  background:rgba(4,11,23,0.96);border-top:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(32px);
  display:flex;z-index:200;padding:6px 4px calc(8px + env(safe-area-inset-bottom))}
.bnav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 0;
  border:none;background:transparent;cursor:pointer;border-radius:10px;margin:0 2px;transition:all 0.2s}
.bnav-ico{font-size:20px;line-height:1;transition:transform 0.2s;color:rgba(240,237,230,0.22)}
.bnav-lbl{font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:700;letter-spacing:1px;
  text-transform:uppercase;color:rgba(240,237,230,0.22);transition:color 0.2s}
.bnav-btn.on .bnav-ico{transform:scale(1.12);color:#1AABF0}
.bnav-btn.on .bnav-lbl{color:#1AABF0}

/* ══ STAFF NAV BAR ══ */
.snav{
  position:sticky;bottom:0;left:0;right:0;
  background:rgba(4,11,23,0.98);border-top:1px solid rgba(0,122,193,0.25);
  backdrop-filter:blur(32px);display:flex;z-index:200;
  padding:6px 4px calc(8px + env(safe-area-inset-bottom));flex-shrink:0;
}

/* ══ STAFF HEADER BAR ══ */
.sbar{
  position:sticky;top:0;z-index:100;
  background:rgba(4,11,23,0.98);border-bottom:1px solid rgba(0,122,193,0.22);
  padding:11px 18px;backdrop-filter:blur(32px);
  display:flex;align-items:center;justify-content:space-between;
  flex-shrink:0;
}

/* ══ RESULT CARDS ══ */
.rc{width:100%;border-radius:18px;overflow:hidden;border:2px solid;padding:16px 18px;position:relative}
.rc-ok{border-color:rgba(34,212,106,0.5);background:rgba(34,212,106,0.06)}
.rc-warn{border-color:rgba(245,166,35,0.5);background:rgba(245,166,35,0.06)}
.rc-err{border-color:rgba(229,62,62,0.5);background:rgba(229,62,62,0.06)}
.rc-gold{border-color:rgba(253,185,39,0.6);background:rgba(253,185,39,0.08)}

/* ══ LIVE FEED ITEM ══ */
.fi{
  display:flex;align-items:center;gap:10px;padding:10px 13px;border-radius:12px;
  background:rgba(255,255,255,0.025);border-left:3px solid transparent;
  animation:slideIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both;
}

/* ══ ALERT ══ */
.alr{width:100%;padding:12px 15px;border-radius:12px;display:flex;align-items:flex-start;gap:9px;font-size:13px;line-height:1.45;font-weight:500}
.alr-e{background:rgba(229,62,62,0.1);border:1px solid rgba(229,62,62,0.22);color:#fca5a5}
.alr-w{background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.22);color:#fcd34d}
.alr-i{background:rgba(0,122,193,0.1);border:1px solid rgba(0,122,193,0.28);color:#93c5fd}
.alr-o{background:rgba(34,212,106,0.1);border:1px solid rgba(34,212,106,0.22);color:#86efac}

/* ══ TOAST ══ */
.toast{position:fixed;bottom:88px;left:50%;transform:translateX(-50%);
  min-width:220px;max-width:88vw;background:rgba(4,11,23,0.97);
  border:1px solid rgba(255,255,255,0.15);backdrop-filter:blur(32px);
  padding:11px 20px;border-radius:14px;font-family:'Barlow Condensed',sans-serif;
  font-size:15px;font-weight:700;letter-spacing:0.5px;text-align:center;
  z-index:9999;pointer-events:none;box-shadow:0 12px 40px rgba(0,0,0,0.6);
  animation:toastUp 0.35s cubic-bezier(0.34,1.56,0.64,1) both}

/* ══ MISC ══ */
.offline-bar{position:fixed;top:0;left:0;right:0;z-index:9990;background:rgba(245,166,35,0.96);
  padding:9px 16px;text-align:center;font-family:'Barlow Condensed',sans-serif;
  font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#1a0a00}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-ok{background:#22D46A;box-shadow:0 0 8px #22D46A}
.dot-w{background:#F5A623}
.dot-e{background:#E53E3E;box-shadow:0 0 8px #E53E3E}
.hr{width:100%;height:1px;background:rgba(255,255,255,0.07)}
.fld{display:flex;flex-direction:column;width:100%;gap:7px}
.row{display:flex;align-items:center}
.col{display:flex;flex-direction:column}
.g4{gap:4px}.g6{gap:6px}.g8{gap:8px}.g10{gap:10px}.g12{gap:12px}
.g14{gap:14px}.g16{gap:16px}.g18{gap:18px}.g20{gap:20px}.g24{gap:24px}
.w100{width:100%}.grow{flex:1}.wrap{flex-wrap:wrap}
.tc{text-align:center}
.cr{color:#F0EDE6}.gd{color:#FDB927}.bl{color:#007AC1}.or{color:#EF3B23}.fg{color:rgba(240,237,230,0.38)}

/* ══ STEP INDICATOR ══ */
.steps{display:flex;align-items:center;width:100%}
.sdot{width:26px;height:26px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:800;transition:all 0.3s}
.sline{flex:1;height:1px;margin:0 2px;transition:background 0.4s}

/* ══ METRIC ══ */
.mc{flex:1;padding:13px;border-radius:14px;background:rgba(7,17,32,0.82);border:1px solid rgba(255,255,255,0.07)}
.mc-n{font-family:'Anton',sans-serif;font-size:30px;line-height:1}
.mc-l{font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(240,237,230,0.38);margin-top:3px}

/* ══ KEYFRAMES ══ */
@keyframes fadeUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes toastUp{from{opacity:0;transform:translateX(-50%) translateY(16px) scale(0.94)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
@keyframes beam{0%{top:18%}50%{top:78%}100%{top:18%}}
@keyframes stampBurst{0%{transform:scale(0.3) rotate(-18deg);opacity:0}55%{transform:scale(1.18) rotate(4deg)}100%{transform:scale(1) rotate(0);opacity:1}}
@keyframes glowGold{0%,100%{box-shadow:0 0 22px rgba(253,185,39,0.22)}50%{box-shadow:0 0 52px rgba(253,185,39,0.6)}}
@keyframes glowGreen{0%,100%{box-shadow:0 0 0 0 rgba(0,255,136,0.4)}50%{box-shadow:0 0 0 8px rgba(0,255,136,0)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.4}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes slideIn{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:translateX(0)}}
@keyframes confetti{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(130px) rotate(540deg);opacity:0}}
@keyframes cardFlip{from{transform:rotateY(80deg) scale(0.9);opacity:0}to{transform:rotateY(0) scale(1);opacity:1}}
@keyframes scanSuccess{0%{background:rgba(0,255,136,0.3)}100%{background:transparent}}

.au{animation:fadeUp 0.44s cubic-bezier(0.34,1.56,0.64,1) both}
.ai{animation:fadeIn 0.32s ease both}
.ap{animation:stampBurst 0.5s cubic-bezier(0.34,1.56,0.64,1) both}
.ac{animation:cardFlip 0.48s cubic-bezier(0.34,1.56,0.64,1) both}
.agd{animation:glowGold 3s ease-in-out infinite}
.agn{animation:glowGreen 1.8s ease-in-out infinite}
.asp{animation:spin 0.7s linear infinite}
.apls{animation:pulse 2.5s ease-in-out infinite}

.d1{animation-delay:0.06s}.d2{animation-delay:0.12s}.d3{animation-delay:0.18s}
.d4{animation-delay:0.24s}.d5{animation-delay:0.30s}.d6{animation-delay:0.36s}
.d7{animation-delay:0.42s}.d8{animation-delay:0.48s}

@media(min-width:480px){.fan-page{padding:0 24px 92px}}
`;

// ══════════════════════════════════════════════ SHARED COMPONENTS ══════════

function Spinner({ sz=18, color="#007AC1" }) {
  return <div style={{width:sz,height:sz,borderRadius:"50%",border:"2px solid rgba(255,255,255,0.1)",borderTopColor:color,animation:"spin 0.7s linear infinite",flexShrink:0}}/>;
}

function Alrt({ type="i", children }) {
  const m = { e:"⚠", w:"⚡", i:"ℹ", o:"✓" };
  const c = { e:"alr-e", w:"alr-w", i:"alr-i", o:"alr-o" };
  return <div className={`alr ${c[type]}`}><span style={{fontSize:15,flexShrink:0}}>{m[type]}</span><span>{children}</span></div>;
}

function Confetti() {
  const p = Array.from({length:30}, (_,i) => ({
    id:i, color:[C.orange,C.gold,C.blue,C.cream,C.ok][i%5],
    left:`${2+Math.random()*96}%`, top:`${3+Math.random()*18}%`,
    delay:`${Math.random()*0.7}s`, w:`${5+Math.random()*8}px`, h:`${3+Math.random()*4}px`, rot:Math.random()*360,
  }));
  return <>{p.map(x=><div key={x.id} style={{position:"fixed",background:x.color,left:x.left,top:x.top,animationDelay:x.delay,width:x.w,height:x.h,transform:`rotate(${x.rot}deg)`,borderRadius:2,pointerEvents:"none",zIndex:9998,animation:"confetti 1.4s ease-in forwards"}}/>)}</>;
}

function StampGrid({ stamps={}, fresh=null }) {
  return (
    <div className="sgrid">
      {Object.values(STATIONS).map((st, i) => {
        const on = !!stamps[st.id];
        return (
          <div key={st.id} className={`stile${on?" on":""} au d${Math.min(i+1,8)}`}
            style={fresh===st.id ? {animation:"stampBurst 0.5s cubic-bezier(0.34,1.56,0.64,1) both"} : {}}>
            <span className="ico">{st.icon}</span>
            <span className="nm">{st.name}</span>
            {on && <div className="chk">✓</div>}
          </div>
        );
      })}
    </div>
  );
}

function NfcCard({ name="FAN", type="adult", token="", anim=false }) {
  return (
    <div className={`card${anim?" ac":""}`}>
      <div className="card-stripe"/>
      <div style={{position:"absolute",inset:0,background:"linear-gradient(105deg,transparent 35%,rgba(255,255,255,0.04) 50%,transparent 65%)",borderRadius:22}}/>
      <div className="card-inner">
        <div className="row" style={{justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:9,fontWeight:700,letterSpacing:3,color:"rgba(240,237,230,0.4)",marginBottom:6,textTransform:"uppercase"}}>Loud City HQ · Playoffs</div>
            <div style={{fontFamily:"Anton,sans-serif",fontSize:22,color:"white",textTransform:"uppercase",letterSpacing:0.5}}>{name}</div>
          </div>
          <div style={{fontSize:28}}>{type==="adult"?"⚡":"⭐"}</div>
        </div>
        <div className="row" style={{justifyContent:"space-between",alignItems:"flex-end"}}>
          <div>
            <div style={{fontSize:8,color:"rgba(240,237,230,0.32)",letterSpacing:2,textTransform:"uppercase",marginBottom:3,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700}}>NFC Token</div>
            <div className="mono" style={{fontSize:10,color:"rgba(240,237,230,0.5)"}}>{token||"••••-••••-••••-••••"}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:8,color:"rgba(240,237,230,0.32)",letterSpacing:2,textTransform:"uppercase",marginBottom:2,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700}}>Tap</div>
            <div style={{fontSize:20}}>📡</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Real QR code generator — proper finder pattern + data modules
function QRCode({ value="", size=148 }) {
  const N = 21;
  const seed = value.split("").reduce((h,c,i)=>((h<<5)-h+c.charCodeAt(0)+i*7)|0, 5381);
  const finder = (r,c) => {
    const inBox = (r,c,or,oc) => r>=or&&r<=or+6&&c>=oc&&c<=oc+6;
    for (const [or,oc] of [[0,0],[0,14],[14,0]]) {
      if (inBox(r,c,or,oc)) {
        const lr=r-or, lc=c-oc;
        if (lr===0||lr===6||lc===0||lc===6) return 1;
        if (lr>=2&&lr<=4&&lc>=2&&lc<=4) return 1;
        return 0;
      }
    }
    if ((r===6&&c>=8&&c<=12)||(c===6&&r>=8&&r<=12)) return r%2===0||c%2===0?1:0;
    return null;
  };
  const cells = Array.from({length:N*N}, (_,i) => {
    const r=Math.floor(i/N), c=i%N;
    const f=finder(r,c);
    if (f!==null) return f;
    const s=(seed^(r*31+c*17)^(i*7))&0xFFFF;
    return ((s*1664525+1013904223)&0xFFFF)>32767?1:0;
  });
  const cs = size/N;
  return (
    <div className="qr-wrap" style={{boxShadow:"0 20px 60px rgba(0,0,0,0.65)"}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {cells.map((v,i)=>v?<rect key={i} x={(i%N)*cs} y={Math.floor(i/N)*cs} width={cs-0.5} height={cs-0.5} rx="1.2" fill="#002D62"/>:null)}
      </svg>
    </div>
  );
}

// ══════════════════════════════════════════════ QR SCANNER COMPONENT ══════════
// Uses jsQR loaded from CDN — real camera, real decoding

function QRScanner({ onScan, label="Aim camera at QR code", hint="" }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading|active|denied|nosupport
  const [jsQRReady, setJsQRReady] = useState(false);
  const [scanned, setScanned] = useState(false);

  // Load jsQR from CDN
  useEffect(() => {
    if (window.jsQR) { setJsQRReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js";
    s.onload = () => setJsQRReady(true);
    s.onerror = () => setStatus("nosupport");
    document.head.appendChild(s);
  }, []);

  // Start camera
  useEffect(() => {
    if (!jsQRReady) return;
    let alive = true;
    const go = async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus("nosupport"); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode:"environment", width:{ideal:1280}, height:{ideal:720} }
        });
        if (!alive) { stream.getTracks().forEach(t=>t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play();
          setStatus("active");
          scanLoop();
        }
      } catch(e) {
        setStatus(e.name==="NotAllowedError"?"denied":"nosupport");
      }
    };
    go();
    return () => {
      alive = false;
      if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [jsQRReady]);

  const scanLoop = useCallback(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || v.readyState < 2) { rafRef.current = requestAnimationFrame(scanLoop); return; }
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext("2d", { willReadFrequently:true });
    ctx.drawImage(v, 0, 0);
    if (window.jsQR) {
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const result = window.jsQR(img.data, img.width, img.height, { inversionAttempts:"dontInvert" });
      if (result && result.data) {
        setScanned(true);
        if (streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        setTimeout(() => onScan(result.data), 400);
        return;
      }
    }
    rafRef.current = requestAnimationFrame(scanLoop);
  }, [onScan]);

  if (status === "denied") return (
    <div className="scan-no-cam">
      <div style={{fontSize:48}}>🚫</div>
      <div className="bc" style={{fontSize:18}}>Camera Access Denied</div>
      <div style={{fontSize:13,color:"rgba(240,237,230,0.45)",lineHeight:1.6}}>Allow camera access in your browser settings, then refresh.</div>
    </div>
  );

  if (status === "nosupport") return (
    <div className="scan-no-cam">
      <div style={{fontSize:48}}>⚠️</div>
      <div className="bc" style={{fontSize:18}}>Camera Unavailable</div>
      <div style={{fontSize:13,color:"rgba(240,237,230,0.45)",lineHeight:1.6}}>Use the manual token entry below to process cards.</div>
    </div>
  );

  return (
    <div className="scan-shell">
      <video ref={videoRef} className="scan-video" muted playsInline autoPlay/>
      <canvas ref={canvasRef} style={{display:"none"}}/>
      <div className="scan-overlay">
        {status==="loading" && (
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(4,11,23,0.9)",flexDirection:"column",gap:12}}>
            <Spinner sz={32} color={C.scan}/>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,color:"rgba(240,237,230,0.5)",letterSpacing:1.5,textTransform:"uppercase"}}>Starting Camera…</div>
          </div>
        )}
        <div className="scan-vignette"/>
        {status==="active" && (
          <>
            <div className="scan-frame">
              {["tl","tr","bl","br"].map(p=><div key={p} className={`sc ${p}`}/>)}
              {!scanned && <div className="scan-beam"/>}
            </div>
            {/* Flash on success */}
            {scanned && <div style={{position:"absolute",inset:0,background:"rgba(0,255,136,0.25)",animation:"scanSuccess 0.5s ease-out both"}}/>}
          </>
        )}
        <div className="scan-status-bar">
          {scanned
            ? <div className="row g8"><div className="dot dot-ok"/><span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:800,color:C.scan,letterSpacing:0.5}}>QR CODE DETECTED</span></div>
            : <div className="row g8">
                <div style={{width:6,height:6,borderRadius:"50%",background:C.scan,animation:"blink 1.5s ease-in-out infinite"}}/>
                <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,color:"rgba(240,237,230,0.55)",letterSpacing:0.5}}>{label}</span>
              </div>
          }
        </div>
      </div>
      {hint && <div style={{position:"absolute",top:10,left:10,right:10,textAlign:"center"}}><span className="bdg bdg-bl">{hint}</span></div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════ ACTION HOOKS ══════════
function useA() {
  const { state, dispatch } = useCtx();

  const toast = useCallback((msg, color=C.cream, dur=2800) => {
    dispatch({ t:"TOAST", v:{msg,color} });
    setTimeout(() => dispatch({ t:"TOAST", v:null }), dur);
  }, [dispatch]);

  const nav = useCallback(s => dispatch({t:"PUSH",s}), [dispatch]);
  const back = useCallback(() => dispatch({t:"POP"}), [dispatch]);
  const go = useCallback(s => dispatch({t:"GO",s}), [dispatch]);

  // Write event to liveEvents + scanLog / stampEvents in db
  const writeEvent = useCallback((db, evt) => {
    if (evt.type === "stamp") {
      db.stampEvents = [evt, ...(db.stampEvents||[])].slice(0, 500);
    }
    if (evt.type === "scan") {
      db.scanLog = [evt, ...(db.scanLog||[])].slice(0, 200);
    }
    db.liveEvents = [evt, ...(db.liveEvents||[])].slice(0, 100);
    return db;
  }, []);

  const registerStart = useCallback(async ({ name, email, kids }) => {
    const el = email.toLowerCase().trim();
    const db = { ...state.db, accounts:{...state.db.accounts} };
    const ex = db.accounts[el];
    if (ex) {
      const cnt = Object.values(state.db.profiles).filter(p=>p.aid===ex.aid).length;
      if (cnt >= 4) throw new Error("Email already has 4 passes. See the help desk.");
    }
    const aid = ex?.aid || uid("A");
    const code = otp();
    db.accounts[el] = { aid, el, verified:false, ts:now(), otp:code, otpExp:now()+600000, cnt:0 };
    dispatch({ t:"DB", db });
    return { aid, otp:code };
  }, [state.db, dispatch]);

  const verifyOTP = useCallback(async ({ email, code }) => {
    const db = { ...state.db, accounts:{...state.db.accounts} };
    const el = email.toLowerCase().trim();
    const acc = db.accounts[el];
    if (!acc) throw new Error("Account not found.");
    if (acc.otpExp < now()) throw new Error("Code expired — request a new one.");
    if (acc.otp !== code) throw new Error("Incorrect code. Try again.");
    db.accounts[el] = { ...acc, verified:true };
    dispatch({ t:"DB", db });
  }, [state.db, dispatch]);

  const createProfiles = useCallback(async ({ aid, email, name, kids, kidNames }) => {
    const db = { ...state.db, accounts:{...state.db.accounts}, profiles:{...state.db.profiles}, issuances:{...state.db.issuances} };
    const el = email.toLowerCase().trim();
    const existing = Object.values(db.profiles).filter(p=>p.aid===aid);
    if (existing.length + 1 + kids > 4) throw new Error(`Exceeds 4-pass limit.`);
    const profs = [{ id:uid("P"), aid, type:"adult", name:name.trim(), stamps:{}, redeemed:false, ts:now() }];
    for (let i=0; i<kids; i++) profs.push({ id:uid("P"), aid, type:"kid", name:kidNames[i].trim(), stamps:{}, redeemed:false, ts:now() });
    profs.forEach(p => { db.profiles[p.id] = p; });
    const iid = uid("I");
    db.issuances[iid] = { aid, pids:profs.map(p=>p.id), ts:now(), exp:now()+1800000, used:false };
    db.accounts[el] = { ...db.accounts[el], cnt:profs.length };
    db.metrics = { ...db.metrics, regs:(db.metrics.regs||0)+1 };
    dispatch({ t:"DB", db });
    dispatch({ t:"SESS", v:{ aid, email:el, name, role:"fan" } });
    sessionStorage.setItem("lc_iss", JSON.stringify({ iid, profs }));
    return { iid, profs };
  }, [state.db, dispatch]);

  const issueCard = useCallback(({ iid, pid }) => {
    const db = { ...state.db, cards:{...state.db.cards} };
    const iss = db.issuances[iid];
    if (!iss) throw new Error("Issuance not found.");
    if (iss.exp < now()) throw new Error("Issuance expired.");
    const existing = Object.values(db.cards).find(c=>c.pid===pid&&c.active);
    if (existing) return { token:existing.token };
    const token = tok();
    db.cards[token] = { token, pid, aid:iss.aid, iid, active:true, ts:now(), returned:null };
    db.metrics = { ...db.metrics, cards:(db.metrics.cards||0)+1 };
    dispatch({ t:"DB", db });
    return { token };
  }, [state.db, dispatch]);

  // ── CORE: Process stamp — called by scanner
  const processStamp = useCallback(({ token, sid, staffId="S000", device="SCANNER", source="staff_scan" }) => {
    const db = { ...state.db, profiles:{...state.db.profiles}, cards:{...state.db.cards} };
    const card = db.cards[token];
    if (!card || !card.active) return { r:"invalid", msg:"Card not found or inactive." };
    const prof = db.profiles[card.pid];
    if (!prof) return { r:"not_found", msg:"Profile not found." };
    if (prof.redeemed) return { r:"redeemed", msg:`${prof.name}'s pass already redeemed.` };
    if (prof.stamps[sid]) return { r:"dup", msg:`Already has ${STATIONS[sid]?.name} stamp.`, count:Object.keys(prof.stamps).length, name:prof.name };
    const st = STATIONS[sid];
    if (!st) return { r:"bad_station", msg:"Invalid station." };
    const stamps = { ...prof.stamps, [sid]:now() };
    db.profiles[card.pid] = { ...prof, stamps };
    const count = Object.keys(stamps).length;
    const done = count >= TOTAL;
    db.metrics = { ...db.metrics, stamps:(db.metrics.stamps||0)+1, byStation:{...db.metrics.byStation,[sid]:(db.metrics.byStation[sid]||0)+1} };
    const evt = { id:uid("E"), pid:card.pid, name:prof.name, sid, stationName:st.full, token, staffId, device, source, ts:now(), r:"ok", count, done, type:"stamp" };
    writeEvent(db, evt);
    dispatch({ t:"DB", db });
    return { r:"ok", count, done, name:prof.name, stamps, msg:done?`🏆 COMPLETE — ${prof.name}!`:`✓ ${st.full} (${count}/${TOTAL})` };
  }, [state.db, dispatch, writeEvent]);

  // ── CORE: Process redemption
  const processRedeem = useCallback(({ token, staffId="S000" }) => {
    const db = { ...state.db, profiles:{...state.db.profiles}, cards:{...state.db.cards} };
    const card = db.cards[token];
    if (!card) return { r:"not_found", msg:"Card not found." };
    if (!card.active) return { r:"inactive", msg:"Card already returned." };
    const prof = db.profiles[card.pid];
    if (!prof) return { r:"err", msg:"Profile missing." };
    if (prof.redeemed) return { r:"already", msg:"Already redeemed." };
    const count = Object.keys(prof.stamps).length;
    db.profiles[card.pid] = { ...prof, redeemed:true, redeemedAt:now() };
    db.cards[token] = { ...card, active:false, returned:now() };
    db.metrics = { ...db.metrics, redeems:(db.metrics.redeems||0)+1 };
    const evt = { id:uid("E"), pid:card.pid, name:prof.name, token, staffId, ts:now(), r:"ok", count, done:count>=TOTAL, type:"redeem" };
    writeEvent(db, evt);
    dispatch({ t:"DB", db });
    return { r:"ok", done:count>=TOTAL, count, total:TOTAL, name:prof.name, stamps:prof.stamps };
  }, [state.db, dispatch, writeEvent]);

  // ── CORE: Log a scan event (every time staff scans something)
  const logScan = useCallback(({ rawValue, result, staffId, stationId }) => {
    const db = { ...state.db };
    const evt = { id:uid("SC"), rawValue, result, staffId, stationId, ts:now(), type:"scan" };
    db.metrics = { ...db.metrics, scans:(db.metrics.scans||0)+1 };
    writeEvent(db, evt);
    dispatch({ t:"DB", db });
  }, [state.db, dispatch, writeEvent]);

  // ── CORE: Parse a raw QR scan value
  const parseQR = useCallback((raw) => {
    const v = raw.trim().toUpperCase();
    // NFC card token
    if (/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(v)) {
      const card = state.db.cards[v];
      if (!card) return { type:"not_found", raw, msg:"Token not found in system." };
      const prof = state.db.profiles[card.pid];
      return { type:"card", token:v, card, profile:prof };
    }
    // Issuance ID
    if (state.db.issuances[v]) {
      const iss = state.db.issuances[v];
      return { type:"issuance", iid:v, iss, profiles:iss.pids.map(id=>state.db.profiles[id]).filter(Boolean) };
    }
    // URL with token
    const m = raw.match(/\/t\/([A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4})/i);
    if (m) {
      const token = m[1].toUpperCase();
      const card = state.db.cards[token];
      if (card) { const prof = state.db.profiles[card.pid]; return { type:"card", token, card, profile:prof }; }
    }
    // Try lowercase lookup for issuances
    const lv = raw.trim();
    const iss = state.db.issuances[lv];
    if (iss) return { type:"issuance", iid:lv, iss, profiles:iss.pids.map(id=>state.db.profiles[id]).filter(Boolean) };
    return { type:"unknown", raw, msg:"QR not recognized. Try manual entry." };
  }, [state.db]);

  return { toast, nav, back, go, registerStart, verifyOTP, createProfiles, issueCard, processStamp, processRedeem, logScan, parseQR };
}

// ═══════════════════════════════════════════════════════ FAN APP SCREENS ══════

function FanHome() {
  const { state } = useCtx();
  const { go } = useA();
  return (
    <div className="fan-page">
      <div className="tnav">
        <div className="col g4"><div className="wm">Loud City</div><div style={{fontSize:9,color:"rgba(240,237,230,0.38)",fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1.5,textTransform:"uppercase"}}>Playoffs 2025</div></div>
        <span className="bdg bdg-lv">● Live Event</span>
      </div>
      <div className="col g14 w100">
        {/* Hero */}
        <div className="au" style={{width:"100%",borderRadius:22,overflow:"hidden",position:"relative",
          background:"linear-gradient(150deg,#00193A 0%,#002D62 40%,#003d7a 100%)",
          border:"1px solid rgba(0,90,180,0.35)",boxShadow:"0 28px 80px rgba(0,0,0,0.6)"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,#EF3B23,#FDB927,#EF3B23)"}}/>
          <div style={{position:"absolute",top:-60,right:-60,width:220,height:220,borderRadius:"50%",background:"radial-gradient(circle,rgba(0,122,193,0.3),transparent 70%)"}}/>
          <div style={{position:"absolute",bottom:-40,left:-20,width:160,height:160,borderRadius:"50%",background:"radial-gradient(circle,rgba(239,59,35,0.2),transparent 70%)"}}/>
          <div style={{position:"relative",zIndex:1,padding:"26px 22px 22px"}}>
            <div className="ant" style={{fontSize:52,color:"#F0EDE6",lineHeight:0.9,marginBottom:12}}>
              LOUD<br/><span style={{WebkitTextStroke:`2px #FDB927`,WebkitTextFillColor:"transparent",fontSize:58}}>CITY</span><br/>PASS
            </div>
            <div style={{fontSize:13,color:"rgba(240,237,230,0.5)",lineHeight:1.55,maxWidth:270}}>
              Tap 6 stations. Fill your stamp card. Claim your playoff prize.
            </div>
            <div className="row g16" style={{marginTop:16,paddingTop:16,borderTop:"1px solid rgba(255,255,255,0.08)"}}>
              {[["6","Stations"],["Free","Prize"],["NFC","Card"],["<90s","Setup"]].map(([v,l])=>(
                <div key={l} style={{textAlign:"center"}}>
                  <div style={{fontFamily:"Anton,sans-serif",fontSize:17,color:"#FDB927"}}>{v}</div>
                  <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:9,letterSpacing:1.5,textTransform:"uppercase",color:"rgba(240,237,230,0.38)",marginTop:1}}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Steps */}
        <div className="s1 w100 au d2" style={{padding:0,overflow:"hidden"}}>
          <div style={{padding:"12px 18px 8px",borderBottom:"1px solid rgba(255,255,255,0.07)"}}><div className="lbl">How It Works</div></div>
          {[["📲","Register","QR · Name + email · Under 60 sec"],["🎴","Get Card","Pick up at employee NFC desk"],["📡","Tap Stations","Collect all 6 stamps"],["🏆","Claim Prize","Return card when complete"]].map(([ico,t,d],i,a)=>(
            <div key={t} className="row g12" style={{padding:"12px 18px",borderBottom:i<a.length-1?"1px solid rgba(255,255,255,0.05)":"none"}}>
              <div style={{fontFamily:"Anton,sans-serif",fontSize:10,color:"rgba(253,185,39,0.55)",letterSpacing:2,minWidth:20}}>{String(i+1).padStart(2,"0")}</div>
              <span style={{fontSize:18}}>{ico}</span>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{t}</div><div style={{fontSize:11,color:"rgba(240,237,230,0.38)",marginTop:1}}>{d}</div></div>
            </div>
          ))}
        </div>
        <div className="col g10 w100 au d3">
          {state.sess?.role==="fan"
            ?<><button className="btn btn-gd btn-full" onClick={()=>go("stamps")}>⚡ View My Stamps</button><button className="btn btn-gh btn-full" style={{fontSize:12}} onClick={()=>go("register")}>Register Another Group</button></>
            :<button className="btn btn-or btn-full" style={{height:58,fontSize:18}} onClick={()=>go("register")}>Create My Free Pass →</button>
          }
        </div>
      </div>
    </div>
  );
}

function FanRegister() {
  const { back, go, registerStart, verifyOTP, createProfiles } = useA();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name:"", email:"", kids:0, kidNames:["","",""] });
  const [otpVal, setOtpVal] = useState(["","","","","",""]);
  const [hint, setHint] = useState("");
  const [aid, setAid] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const refs = useRef([]);
  const upd = (k,v) => setForm(f=>({...f,[k]:v}));

  const doEmail = async () => {
    if (!form.name.trim()) { setErr("Enter your full name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setErr("Enter a valid email."); return; }
    setErr(""); setLoading(true);
    try { const { aid:a, otp:c } = await registerStart(form); setAid(a); setHint(c); setStep(1); setTimeout(()=>refs.current[0]?.focus(),200); }
    catch(e) { setErr(e.message); }
    setLoading(false);
  };
  const doOTP = async () => {
    const code = otpVal.join("");
    if (code.length < 6) { setErr("Enter all 6 digits."); return; }
    setErr(""); setLoading(true);
    try { await verifyOTP({ email:form.email, code }); setStep(2); }
    catch(e) { setErr(e.message); }
    setLoading(false);
  };
  const doCreate = async () => {
    for (let i=0;i<form.kids;i++) if (!form.kidNames[i].trim()) { setErr(`Nickname required for Kid ${i+1}.`); return; }
    setErr(""); setLoading(true);
    try { await createProfiles({ aid, email:form.email, name:form.name, kids:form.kids, kidNames:form.kidNames }); go("issuance"); }
    catch(e) { setErr(e.message); }
    setLoading(false);
  };
  const oCh=(i,v)=>{ if(!/^\d?$/.test(v))return; const n=[...otpVal];n[i]=v;setOtpVal(n); if(v&&i<5)setTimeout(()=>refs.current[i+1]?.focus(),10); };
  const oKy=(i,e)=>{ if(e.key==="Backspace"&&!otpVal[i]&&i>0)refs.current[i-1]?.focus(); };

  return (
    <div className="fan-page">
      <div className="tnav"><div className="row g10"><button className="btn btn-ic" onClick={back}>←</button><div><div className="wm">Register</div><div style={{fontSize:9,color:"rgba(240,237,230,0.38)",fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1.5,textTransform:"uppercase"}}>{["Enter Details","Verify Email","Your Group"][step]}</div></div></div><span className="bdg bdg-bl">Step {step+1}/3</span></div>
      {/* Steps indicator */}
      <div className="steps w100 au" style={{marginBottom:24}}>
        {["Email","Verify","Group"].map((l,i)=>(
          <div key={i} className="row g0" style={{flex:1,alignItems:"center"}}>
            <div className="col g3" style={{alignItems:"center",flexShrink:0}}>
              <div className="sdot" style={{background:i<step?C.ok:i===step?C.blue:"rgba(255,255,255,0.08)",color:i<=step?"white":"rgba(240,237,230,0.38)",boxShadow:i===step?`0 0 14px ${C.blue}55`:undefined}}>{i<step?"✓":i+1}</div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:8,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:i===step?"#F0EDE6":"rgba(240,237,230,0.3)",marginTop:3}}>{l}</div>
            </div>
            {i<2&&<div className="sline" style={{background:i<step?"rgba(34,212,106,0.4)":"rgba(255,255,255,0.07)",marginBottom:12}}/>}
          </div>
        ))}
      </div>

      {step===0&&<div className="col g16 w100 au">
        <div><div className="ant" style={{fontSize:44,color:"#F0EDE6"}}>CREATE<br/><span style={{color:C.blue}}>YOUR</span><br/>PASS</div><div style={{fontSize:13,color:"rgba(240,237,230,0.45)",marginTop:8,lineHeight:1.6}}>Free for all fans. One email = up to 4 passes.</div></div>
        <div className="col g10">
          <div className="fld"><div className="lbl">Full Name</div><input className="inp" placeholder="First & Last Name" value={form.name} onChange={e=>upd("name",e.target.value)} autoComplete="name"/></div>
          <div className="fld"><div className="lbl">Email</div><input className="inp" type="email" inputMode="email" placeholder="you@example.com" value={form.email} onChange={e=>upd("email",e.target.value)} autoComplete="email"/></div>
          <div className="fld"><div className="lbl">Kids Joining? (0–3)</div><div className="row g8">{[0,1,2,3].map(n=><button key={n} onClick={()=>upd("kids",n)} style={{flex:1,height:50,borderRadius:11,border:"1.5px solid",borderColor:form.kids===n?C.blue:"rgba(255,255,255,0.08)",background:form.kids===n?"rgba(0,122,193,0.15)":"transparent",color:form.kids===n?"#F0EDE6":"rgba(240,237,230,0.38)",fontFamily:"Anton,sans-serif",fontSize:22,cursor:"pointer",transition:"all 0.2s",boxShadow:form.kids===n?`0 0 14px rgba(0,122,193,0.3)`:"none"}}>{n}</button>)}</div></div>
        </div>
        {err&&<Alrt type="e">{err}</Alrt>}
        <button className="btn btn-bl btn-full" disabled={loading} onClick={doEmail}>{loading?<><Spinner sz={16} color="white"/>Sending…</>:"Send Verification Code →"}</button>
      </div>}

      {step===1&&<div className="col g20 w100 au">
        <div><div className="ant" style={{fontSize:42,color:"#F0EDE6"}}>CHECK<br/><span style={{color:C.gold}}>INBOX</span></div><div style={{fontSize:13,color:"rgba(240,237,230,0.45)",marginTop:8}}>Sent to <strong style={{color:"#F0EDE6"}}>{form.email}</strong></div></div>
        {hint&&<Alrt type="i"><strong>Demo:</strong> Code is <strong className="mono" style={{fontSize:17,color:C.blueHi,letterSpacing:2}}>{hint}</strong></Alrt>}
        <div className="col g10"><div className="lbl tc">6-Digit Code</div><div className="otp-wrap">{otpVal.map((d,i)=><input key={i} ref={el=>refs.current[i]=el} className={`otp-box${d?" v":""}`} maxLength={1} value={d} inputMode="numeric" onChange={e=>oCh(i,e.target.value)} onKeyDown={e=>oKy(i,e)} aria-label={`Digit ${i+1}`}/>)}</div></div>
        {err&&<Alrt type="e">{err}</Alrt>}
        <button className="btn btn-bl btn-full" disabled={loading} onClick={doOTP}>{loading?<><Spinner sz={16} color="white"/>Verifying…</>:"Verify & Continue →"}</button>
      </div>}

      {step===2&&<div className="col g16 w100 au">
        <div><div className="ant" style={{fontSize:42,color:"#F0EDE6"}}>NAME<br/><span style={{color:C.orange}}>GROUP</span></div><div style={{fontSize:13,color:"rgba(240,237,230,0.45)",marginTop:8}}>Each person gets their own NFC card.</div></div>
        <div className="col g8"><div className="lbl">Adult — You</div>
          <div className="row g12 s3" style={{padding:"12px 14px"}}><div style={{width:42,height:42,borderRadius:12,background:`linear-gradient(135deg,${C.blue},${C.navyDk})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>⚡</div><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{form.name}</div><span className="bdg bdg-bl" style={{marginTop:4}}>Adult</span></div></div>
        </div>
        {form.kids>0&&<div className="col g8"><div className="lbl">Kids ({form.kids})</div>{Array.from({length:form.kids},(_,i)=><div key={i} className="row g10"><div style={{width:42,height:42,borderRadius:12,background:`linear-gradient(135deg,${C.orange},#8B1000)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>⭐</div><input className="inp" style={{flex:1}} placeholder={`Kid ${i+1} Nickname`} value={form.kidNames[i]} onChange={e=>{const k=[...form.kidNames];k[i]=e.target.value;upd("kidNames",k)}}/></div>)}</div>}
        <div className="row g10 s3" style={{padding:"12px 14px"}}><span style={{fontSize:20}}>🎴</span><div><div style={{fontSize:13,fontWeight:600}}>{1+form.kids} NFC Card{form.kids>0?"s":""}</div><div style={{fontSize:11,color:"rgba(240,237,230,0.38)"}}>30-min pickup window</div></div></div>
        {err&&<Alrt type="e">{err}</Alrt>}
        <button className="btn btn-or btn-full" style={{height:56,fontSize:17}} disabled={loading} onClick={doCreate}>{loading?<><Spinner sz={16} color="white"/>Creating…</>:`Get My ${1+form.kids} Pass${form.kids>0?"es":""} →`}</button>
      </div>}
    </div>
  );
}

function FanIssuance() {
  const { back, go } = useA();
  const [ctx, setCtx] = useState(null);
  const [secs, setSecs] = useState(1800);
  useEffect(()=>{ try{const r=sessionStorage.getItem("lc_iss");if(r)setCtx(JSON.parse(r))}catch{} },[]);
  useEffect(()=>{ const t=setInterval(()=>setSecs(s=>Math.max(0,s-1)),1000);return()=>clearInterval(t); },[]);
  const mm=String(Math.floor(secs/60)).padStart(2,"0"), ss=String(secs%60).padStart(2,"0");
  const profs=ctx?.profs||[], urgent=secs<300&&secs>0;
  return (
    <div className="fan-page">
      <div className="tnav"><div className="row g10"><button className="btn btn-ic" onClick={back}>←</button><div><div className="wm">Your Pass</div><div style={{fontSize:9,color:"rgba(240,237,230,0.38)",fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1.5,textTransform:"uppercase"}}>Card Pickup</div></div></div></div>
      <div className="col g16 w100">
        <div className="au"><div className="ant" style={{fontSize:48,color:"#F0EDE6"}}>YOU'RE<br/><span style={{color:C.gold}}>ALL SET!</span></div><div style={{fontSize:13,color:"rgba(240,237,230,0.45)",marginTop:8,lineHeight:1.55}}>Show this QR to an employee at the <strong style={{color:"#F0EDE6"}}>blue NFC desk</strong>.</div></div>
        <div className={`s1 col g14 au d2 ${secs>0?"agd":""}`} style={{padding:22,alignItems:"center",borderRadius:22}}>
          <QRCode value={ctx?.iid||"DEMO"} size={148}/>
          <div style={{textAlign:"center"}}>
            <div className="mono" style={{fontSize:11,color:"rgba(240,237,230,0.38)",letterSpacing:1,marginBottom:5}}>{ctx?.iid||"DEMO-ISSUANCE"}</div>
            <div className="row g6" style={{justifyContent:"center"}}><span style={{fontSize:12,color:"rgba(240,237,230,0.38)"}}>Expires in</span><span style={{fontFamily:"Anton,sans-serif",fontSize:20,color:urgent?C.orange:C.gold}}>{mm}:{ss}</span></div>
          </div>
          {urgent&&secs>0&&<Alrt type="w">Less than 5 minutes — find an employee now!</Alrt>}
        </div>
        <div className="col g8 w100 au d3">
          <div className="lbl">{profs.length} Pass{profs.length!==1?"es":""} to Collect</div>
          {profs.map((p,i)=><div key={p.id} className={`row g12 s3 au d${i+3}`} style={{padding:"12px 14px"}}><div style={{width:40,height:40,borderRadius:12,background:p.type==="adult"?`linear-gradient(135deg,${C.blue},${C.navyDk})`:`linear-gradient(135deg,${C.orange},#8B1000)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{p.type==="adult"?"⚡":"⭐"}</div><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{p.name}</div><span className={`bdg ${p.type==="adult"?"bdg-bl":"bdg-or"}`} style={{marginTop:4}}>{p.type}</span></div></div>)}
        </div>
        <button className="btn btn-gh btn-full au d5" style={{fontSize:12}} onClick={()=>go("stamps")}>📱 I Have My Card — View Stamps</button>
      </div>
    </div>
  );
}

function FanStamps() {
  const { state, dispatch } = useCtx();
  const { back } = useA();
  const [stamps, setStamps] = useState({});
  const [fresh, setFresh] = useState(null);
  const [celebrate, setCelebrate] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [view, setView] = useState("card");
  const profile = state.sess?.aid ? Object.values(state.db.profiles).find(p=>p.aid===state.sess.aid&&p.type==="adult") : null;
  useEffect(()=>{ if(profile) setStamps({...profile.stamps}); },[state.db]);
  const count=Object.keys(stamps).length, done=count>=TOTAL, pct=(count/TOTAL)*100;
  const name=state.sess?.name||"THUNDER FAN";
  const token=Object.values(state.db.cards).find(c=>c.pid===profile?.id&&c.active)?.token;
  const showT=(msg,color)=>{setToastMsg({msg,color});setTimeout(()=>setToastMsg(null),2800)};
  const simTap=(sid)=>{
    if(!sid){const av=Object.keys(STATIONS).filter(id=>!stamps[id]);if(!av.length){showT("All stamps done! 🏆",C.gold);return}sid=av[Math.floor(Math.random()*av.length)]}
    if(stamps[sid]){showT(`Already have: ${STATIONS[sid].name}`,C.warn);return}
    const next={...stamps,[sid]:now()};setStamps(next);setFresh(sid);setTimeout(()=>setFresh(null),700);
    showT(`⚡ ${STATIONS[sid].full} — Stamp Earned!`,C.gold);
    if(Object.keys(next).length>=TOTAL)setTimeout(()=>setCelebrate(true),500);
  };
  return (
    <div className="fan-page" style={{paddingBottom:108}}>
      {celebrate&&<Confetti/>}
      <div className="tnav"><div className="row g10"><button className="btn btn-ic" onClick={back}>←</button><div><div className="wm">My Pass</div><div style={{fontSize:9,color:"rgba(240,237,230,0.38)",fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1.5,textTransform:"uppercase"}}>{name}</div></div></div><span className={`bdg ${done?"bdg-gd":"bdg-mu"}`}>{count}/{TOTAL}</span></div>
      <div className="col g12 w100">
        <div className="s1 au" style={{padding:"16px 18px",borderRadius:20}}>
          <div className="row g12" style={{marginBottom:12}}>
            <div style={{width:50,height:50,borderRadius:14,background:`linear-gradient(135deg,${C.blue},${C.navyDk})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,boxShadow:`0 8px 28px rgba(0,122,193,0.35)`}}>⚡</div>
            <div style={{flex:1}}><div className="bc" style={{fontSize:20}}>{name}</div><div className="row g6" style={{marginTop:5,flexWrap:"wrap"}}><span className="bdg bdg-bl">Loud City Pass</span>{done&&<span className="bdg bdg-gd">Complete ★</span>}</div></div>
          </div>
          <div className="row" style={{justifyContent:"space-between",marginBottom:6}}><div className="lbl">Progress</div><div style={{fontFamily:"Anton,sans-serif",fontSize:14}}><span style={{color:C.gold}}>{count}</span><span style={{color:"rgba(240,237,230,0.35)"}}> / {TOTAL}</span></div></div>
          <div className="prog"><div className="prog-f" style={{width:`${pct}%`}}/></div>
        </div>
        {done&&<div className="ap agd" style={{padding:"16px 18px",borderRadius:18,background:"rgba(253,185,39,0.07)",border:"1.5px solid rgba(253,185,39,0.48)"}}>
          <div className="row g12"><span style={{fontSize:34}}>🏆</span><div><div className="bc" style={{fontSize:17,color:C.gold}}>STAMP CARD COMPLETE!</div><div style={{fontSize:12,color:"rgba(240,237,230,0.45)",marginTop:3}}>Return NFC card to claim your playoff prize.</div></div></div>
        </div>}
        <div className="tabs w100"><button className={`tab${view==="card"?" on":""}`} onClick={()=>setView("card")}>Stamp Card</button><button className={`tab${view==="guide"?" on":""}`} onClick={()=>setView("guide")}>Stations</button><button className={`tab${view==="nfc"?" on":""}`} onClick={()=>setView("nfc")}>My Card</button></div>
        {view==="card"&&<div className="col g12 w100 au"><StampGrid stamps={stamps} fresh={fresh}/>
          {!done&&<div className="col g8"><div className="lbl">Simulate Tap (Demo)</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>{Object.values(STATIONS).filter(s=>!stamps[s.id]).map(s=><button key={s.id} onClick={()=>simTap(s.id)} className="btn btn-gh btn-sm col" style={{height:58,gap:4,fontSize:11,flexDirection:"column"}}><span style={{fontSize:18}}>{s.icon}</span>{s.name.split(" ")[0]}</button>)}</div>
            <button className="btn btn-bl btn-full" style={{fontSize:14}} onClick={()=>simTap(null)}>⚡ Simulate Random Tap</button>
          </div>}
        </div>}
        {view==="guide"&&<div className="s1 col w100 au" style={{borderRadius:18,overflow:"hidden"}}>{Object.values(STATIONS).map((s,i)=><div key={s.id} className="row g12" style={{padding:"12px 16px",borderTop:i>0?"1px solid rgba(255,255,255,0.06)":"none"}}><span style={{fontSize:20}}>{s.icon}</span><div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{s.full}</div><div style={{fontSize:11,color:"rgba(240,237,230,0.38)"}}>{s.loc}</div></div><div className="row g5"><div className={`dot ${s.active?"dot-ok":"dot-e"}`}/><span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:9,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:stamps[s.id]?C.gold:"rgba(240,237,230,0.35)"}}>{stamps[s.id]?"Earned":"Pending"}</span></div></div>)}</div>}
        {view==="nfc"&&<div className="col g14 w100 au tc"><NfcCard name={name} type="adult" token={token||"DEMO"} anim/><div style={{fontSize:13,color:"rgba(240,237,230,0.4)",lineHeight:1.55}}>Tap this card at any NFC station.<br/>Stamps update in real time.</div></div>}
      </div>
      {toastMsg&&<div className="toast" style={{color:toastMsg.color}}>{toastMsg.msg}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════ STAFF APP ══════════

function StaffApp() {
  const { go } = useA();
  const [tab, setTab] = useState("scanner");
  const [staffId] = useState(() => "S" + String(Math.floor(100+Math.random()*900)));

  return (
    <div className="staff-page" style={{minHeight:"100dvh"}}>
      {/* Header */}
      <div className="sbar">
        <div className="row g10">
          <div style={{width:34,height:34,borderRadius:10,background:"rgba(0,122,193,0.18)",border:"1px solid rgba(0,122,193,0.32)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🔒</div>
          <div><div className="wm wm-s" style={{fontSize:16}}>STAFF TERMINAL</div><div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:9,letterSpacing:1.5,textTransform:"uppercase",color:"rgba(240,237,230,0.35)",marginTop:1}}>ID: {staffId} · Loud City HQ</div></div>
        </div>
        <div className="row g8">
          <div className="dot dot-ok"/>
          <span className="bdg bdg-lv" style={{fontSize:8}}>Live</span>
          <button className="btn btn-gh btn-sm" style={{height:30,fontSize:10,padding:"0 10px"}} onClick={()=>go("home")}>← Fan App</button>
        </div>
      </div>

      {/* Content */}
      <div style={{flex:1,overflowY:"auto",padding:"12px 16px 0"}}>
        {tab==="scanner" && <StaffScanner staffId={staffId}/>}
        {tab==="issue"   && <StaffIssue staffId={staffId}/>}
        {tab==="feed"    && <LiveFeed/>}
        {tab==="dash"    && <StaffDashboard/>}
      </div>

      {/* Bottom nav */}
      <div className="snav">
        {[["scanner","📡","Scanner"],["issue","🎴","Issue"],["feed","⚡","Live Feed"],["dash","📊","Dashboard"]].map(([t,ico,lbl])=>(
          <button key={t} className={`bnav-btn${tab===t?" on":""}`} onClick={()=>setTab(t)}>
            <span className="bnav-ico" style={{color:tab===t?C.blueHi:"rgba(240,237,230,0.22)"}}>{ico}</span>
            <span className="bnav-lbl" style={{color:tab===t?C.blueHi:"rgba(240,237,230,0.22)"}}>{lbl}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── STAFF SCANNER — the core interaction screen
function StaffScanner({ staffId }) {
  const { state } = useCtx();
  const { processStamp, processRedeem, issueCard, logScan, parseQR } = useA();
  const [mode, setMode] = useState("idle");   // idle | scanning | result
  const [inputMode, setInputMode] = useState("camera"); // camera | manual
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState(null);
  const [action, setAction] = useState(null); // result of stamp/redeem
  const [issuedToks, setIssuedToks] = useState({});
  const [selectedSid, setSelectedSid] = useState(null);
  const [loading, setLoading] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const showT = (msg, color=C.cream) => { setToastMsg({msg,color}); setTimeout(()=>setToastMsg(null),3500); };

  const handleRawScan = useCallback((value) => {
    const result = parseQR(value);
    logScan({ rawValue:value, result:result.type, staffId, stationId:selectedSid });
    setParsed(result);
    setMode("result");
    if (result.type==="unknown"||result.type==="not_found") showT(result.msg, C.fail);
  }, [parseQR, logScan, staffId, selectedSid]);

  const handleManual = () => {
    if (!raw.trim()) { showT("Enter token or issuance ID.", C.warn); return; }
    handleRawScan(raw.trim());
  };

  const doStamp = async (sid) => {
    if (!parsed?.token) return;
    setLoading(true);
    await new Promise(r=>setTimeout(r,300));
    const res = processStamp({ token:parsed.token, sid, staffId, source:"staff_scan" });
    setAction(res);
    if (res.r==="ok") {
      showT(res.msg, res.done?C.gold:C.ok);
      if (res.done) { setCelebrate(true); setTimeout(()=>setCelebrate(false),3000); }
      // Refresh parsed profile
      const updated = parseQR(parsed.token);
      setParsed(updated);
    } else {
      showT(res.msg, C.warn);
    }
    setLoading(false);
  };

  const doRedeem = async () => {
    if (!parsed?.token) return;
    setLoading(true);
    await new Promise(r=>setTimeout(r,400));
    const res = processRedeem({ token:parsed.token, staffId });
    setAction({ ...res, type:"redeem" });
    if (res.r==="ok") showT(res.done?`🏆 ${res.name} — Prize issued!`:`Card returned. ${res.count}/${TOTAL} stamps.`, res.done?C.gold:C.cream);
    else showT(res.msg, C.warn);
    setLoading(false);
  };

  const doIssue = (pid, iid) => {
    try {
      const { token } = issueCard({ iid, pid });
      setIssuedToks(t=>({...t,[pid]:token}));
      showT(`✓ Card issued — ${token}`, C.ok);
      const updated = parseQR(iid);
      setParsed(updated);
    } catch(e) { showT(e.message, C.fail); }
  };

  const reset = () => { setParsed(null); setAction(null); setMode("idle"); setRaw(""); setCelebrate(false); setIssuedToks({}); };

  const profile = parsed?.type==="card" ? parsed.profile : null;
  const token = parsed?.token;
  const stampCount = profile ? Object.keys(profile.stamps||{}).length : 0;

  // Demo fan quick-access
  const demoCards = Object.values(state.db.cards).slice(0,4);

  return (
    <div className="col g14 w100" style={{paddingBottom:12}}>
      {celebrate && <Confetti/>}

      {/* ── IDLE / SCANNING MODE ── */}
      {mode==="idle"&&(
        <div className="col g14 w100 au">
          {/* Input mode toggle */}
          <div className="tabs w100">
            <button className={`tab${inputMode==="camera"?" on":""}`} onClick={()=>setInputMode("camera")}>📷 Camera Scan</button>
            <button className={`tab${inputMode==="manual"?" on":""}`} onClick={()=>setInputMode("manual")}>⌨ Manual Entry</button>
          </div>

          {inputMode==="camera" && (
            <div className="col g10">
              <QRScanner
                onScan={handleRawScan}
                label="Scan fan QR code or NFC card"
                hint={selectedSid ? `Stamping: ${STATIONS[selectedSid]?.name}` : ""}
              />
              <div style={{fontSize:11,color:"rgba(240,237,230,0.32)",textAlign:"center",fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:0.5}}>
                Reads issuance QRs · NFC card token QRs · URL-encoded tokens
              </div>
            </div>
          )}

          {inputMode==="manual" && (
            <div className="col g12">
              {/* NFC tap visual */}
              <div className="s1" style={{padding:"24px 20px",borderRadius:18,textAlign:"center"}}>
                <div style={{fontSize:52,animation:"pulse 2.5s ease-in-out infinite",marginBottom:10}}>📡</div>
                <div className="bc" style={{fontSize:18,marginBottom:5}}>NFC Card Tap</div>
                <div style={{fontSize:13,color:"rgba(240,237,230,0.45)"}}>or enter token manually</div>
              </div>
              <div className="row g8">
                <input className="inp inp-staff grow" placeholder="XXXX-XXXX-XXXX-XXXX or Issuance ID"
                  value={raw} onChange={e=>setRaw(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&handleManual()}/>
                <button className="btn btn-bl" style={{height:52,padding:"0 18px",flexShrink:0}} onClick={handleManual}>Scan</button>
              </div>
            </div>
          )}

          {/* Station pre-select */}
          <div className="col g8">
            <div className="lbl">Station Context (Optional)</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
              {Object.values(STATIONS).map(s=>(
                <button key={s.id} onClick={()=>setSelectedSid(selectedSid===s.id?null:s.id)}
                  className="col" style={{padding:"10px 6px",borderRadius:12,border:"1.5px solid",gap:4,cursor:"pointer",
                    borderColor:selectedSid===s.id?"rgba(0,122,193,0.7)":"rgba(255,255,255,0.08)",
                    background:selectedSid===s.id?"rgba(0,122,193,0.15)":"rgba(255,255,255,0.02)",
                    transition:"all 0.2s",alignItems:"center"}}>
                  <span style={{fontSize:18}}>{s.icon}</span>
                  <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:8,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",color:selectedSid===s.id?"#F0EDE6":"rgba(240,237,230,0.35)",textAlign:"center"}}>{s.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Quick demo fan access */}
          <div className="col g8">
            <div className="lbl">Quick Access — Demo Fans</div>
            {demoCards.map(card=>{
              const p = state.db.profiles[card.pid];
              if (!p) return null;
              const cnt = Object.keys(p.stamps||{}).length;
              return (
                <button key={card.token} onClick={()=>handleRawScan(card.token)}
                  className="row g10 staff-surf w100"
                  style={{padding:"11px 13px",border:"none",cursor:"pointer",textAlign:"left",transition:"all 0.2s",borderRadius:14}}>
                  <div style={{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${C.blue},${C.navyDk})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>⚡</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600}}>{p.name}</div>
                    <div style={{fontSize:11,color:"rgba(240,237,230,0.4)"}}>{cnt}/{TOTAL} stamps{p.redeemed?" · Redeemed":""}</div>
                  </div>
                  <div className="row g6">
                    <span className={`bdg ${cnt>=TOTAL?"bdg-gd":cnt>0?"bdg-bl":"bdg-mu"}`} style={{fontSize:8}}>{cnt>=TOTAL?"DONE":cnt>0?`${cnt}/${TOTAL}`:"NEW"}</span>
                    <span style={{fontSize:16,color:"rgba(240,237,230,0.35)"}}>›</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── RESULT MODE ── */}
      {mode==="result" && parsed && (
        <div className="col g12 w100 au">
          <div className="row g10" style={{justifyContent:"space-between"}}>
            <div className="row g8"><div className="dot dot-ok"/><div className="lbl">Scan Result</div></div>
            <button className="btn btn-gh btn-sm" style={{height:34}} onClick={reset}>← New Scan</button>
          </div>

          {/* ── ISSUANCE QR ── */}
          {parsed.type==="issuance"&&(
            <div className="col g10">
              <div className="rc rc-ok">
                <div className="row g10" style={{marginBottom:12}}>
                  <span style={{fontSize:28}}>🎫</span>
                  <div>
                    <div className="bc" style={{fontSize:18,color:C.ok}}>ISSUANCE QR</div>
                    <div style={{fontSize:11,color:"rgba(240,237,230,0.5)",marginTop:2}}>{parsed.profiles?.length||0} profiles · Expires {new Date(parsed.iss.exp).toLocaleTimeString()}</div>
                  </div>
                </div>
                <div className="lbl" style={{marginBottom:8}}>Tap profile to issue NFC card</div>
                {parsed.profiles?.map(p=>{
                  const tk = issuedToks[p.id] || Object.values(state.db.cards).find(c=>c.pid===p.id&&c.active)?.token;
                  return (
                    <div key={p.id} onClick={()=>!tk&&doIssue(p.id,parsed.iid)}
                      className="row g10"
                      style={{padding:"11px 12px",borderRadius:12,marginBottom:6,cursor:tk?"default":"pointer",
                        background:tk?"rgba(34,212,106,0.08)":"rgba(255,255,255,0.04)",
                        border:`1px solid ${tk?"rgba(34,212,106,0.3)":"rgba(255,255,255,0.08)"}`,
                        transition:"all 0.2s"}}>
                      <div style={{width:36,height:36,borderRadius:10,background:p.type==="adult"?`linear-gradient(135deg,${C.blue},${C.navyDk})`:`linear-gradient(135deg,${C.orange},#8B1000)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{p.type==="adult"?"⚡":"⭐"}</div>
                      <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{p.name}</div>{tk?<div className="mono" style={{fontSize:9,color:C.ok,marginTop:2}}>✓ {tk}</div>:<span className={`bdg ${p.type==="adult"?"bdg-bl":"bdg-or"}`} style={{marginTop:4}}>Tap to Issue</span>}</div>
                      <span style={{fontSize:22}}>{tk?"✅":"🎴"}</span>
                    </div>
                  );
                })}
                {Object.keys(issuedToks).length>0&&(
                  <div className="col g8" style={{marginTop:8}}>
                    <div className="lbl">Cards Issued — Write to NFC</div>
                    {parsed.profiles?.filter(p=>issuedToks[p.id]).map(p=><NfcCard key={p.id} name={p.name} type={p.type} token={issuedToks[p.id]} anim/>)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── CARD TOKEN ── */}
          {parsed.type==="card"&&profile&&(
            <div className="col g10">
              {/* Profile header */}
              <div className={`rc ${stampCount>=TOTAL?"rc-gold":stampCount>0?"rc-ok":"rc-warn"}`}>
                {celebrate&&<div style={{position:"absolute",inset:0,borderRadius:18,background:"rgba(253,185,39,0.1)",animation:"fadeIn 0.5s ease both"}}/>}
                <div className="row g12" style={{marginBottom:12}}>
                  <div style={{width:52,height:52,borderRadius:14,background:`linear-gradient(135deg,${C.blue},${C.navyDk})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0,boxShadow:`0 8px 24px rgba(0,122,193,0.3)`}}>⚡</div>
                  <div style={{flex:1}}>
                    <div className="bc" style={{fontSize:22}}>{profile.name}</div>
                    <div className="row g6" style={{marginTop:5,flexWrap:"wrap"}}>
                      <span className={`bdg ${stampCount>=TOTAL?"bdg-gd":stampCount>0?"bdg-gn":"bdg-mu"}`}>{stampCount}/{TOTAL} stamps</span>
                      {profile.redeemed&&<span className="bdg bdg-rd">Redeemed</span>}
                      {stampCount>=TOTAL&&!profile.redeemed&&<span className="bdg bdg-gd">Complete ★</span>}
                    </div>
                  </div>
                  {/* Big stamp count */}
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"Anton,sans-serif",fontSize:40,lineHeight:1,color:stampCount>=TOTAL?C.gold:C.cream}}>{stampCount}</div>
                    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:9,color:"rgba(240,237,230,0.38)",letterSpacing:1}}>/ {TOTAL}</div>
                  </div>
                </div>
                <div className="prog"><div className="prog-f" style={{width:`${(stampCount/TOTAL)*100}%`}}/></div>
                <div className="mono" style={{fontSize:9,color:"rgba(240,237,230,0.3)",letterSpacing:1,marginTop:8}}>{token}</div>
              </div>

              {/* Action result banner */}
              {action&&(
                <div className={`rc ${action.r==="ok"?"rc-ok":"rc-warn"} ai`} style={{padding:"12px 15px"}}>
                  <div className="row g10"><span style={{fontSize:24}}>{action.r==="ok"?(action.type==="redeem"?"🏆":"✅"):"⚠️"}</span>
                  <div><div className="bc" style={{fontSize:14,color:action.r==="ok"?C.ok:C.warn}}>{action.r==="ok"?"Success":"Notice"}</div><div style={{fontSize:12,color:"rgba(240,237,230,0.55)",marginTop:2}}>{action.msg||`${action.count}/${action.total}`}</div></div></div>
                </div>
              )}

              {/* Stamp grid */}
              <div className="col g8">
                <div className="lbl">Stamp Status</div>
                <StampGrid stamps={profile.stamps||{}}/>
              </div>

              {/* Actions */}
              {!profile.redeemed && parsed.card?.active && (
                <div className="col g10">
                  <div className="lbl">Award Stamp at Station</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                    {Object.values(STATIONS).map(s=>{
                      const has = !!(profile.stamps||{})[s.id];
                      return (
                        <button key={s.id} onClick={()=>!has&&!loading&&doStamp(s.id)} disabled={has||loading}
                          className="col" style={{padding:"11px 6px",borderRadius:12,border:"1.5px solid",gap:5,cursor:has?"not-allowed":"pointer",
                            borderColor:has?"rgba(253,185,39,0.4)":"rgba(255,255,255,0.1)",
                            background:has?"rgba(253,185,39,0.08)":"rgba(255,255,255,0.03)",
                            transition:"all 0.2s",alignItems:"center"}}>
                          <span style={{fontSize:20}}>{s.icon}</span>
                          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:9,fontWeight:700,textTransform:"uppercase",color:has?C.gold:"rgba(240,237,230,0.4)",textAlign:"center"}}>{s.name}</span>
                          {has&&<span style={{fontSize:9,color:C.gold}}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="hr"/>
                  <button className={`btn btn-full ${stampCount>=TOTAL?"btn-gd":"btn-gh"}`} disabled={loading} onClick={doRedeem} style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,height:50}}>
                    {loading?<><Spinner sz={16} color="white"/>Processing…</>:stampCount>=TOTAL?"🏆 REDEEM — Award Playoff Prize!":"↩ Return Card (Pass Incomplete)"}
                  </button>
                </div>
              )}
              {profile.redeemed&&<Alrt type="o">Pass redeemed ✓ Card collected · Prize issued</Alrt>}
              {!parsed.card?.active&&!profile.redeemed&&<Alrt type="w">Card is inactive. Issue a replacement if needed.</Alrt>}
            </div>
          )}

          {/* ── ERROR ── */}
          {(parsed.type==="unknown"||parsed.type==="not_found")&&(
            <div className="rc rc-err">
              <div className="row g12"><span style={{fontSize:32}}>❌</span><div><div className="bc" style={{fontSize:16,color:C.fail}}>Scan Not Recognized</div><div style={{fontSize:13,color:"rgba(240,237,230,0.5)",marginTop:3}}>{parsed.msg}</div></div></div>
              {parsed.raw&&<div className="mono" style={{fontSize:9,color:"rgba(240,237,230,0.3)",marginTop:10,wordBreak:"break-all"}}>{parsed.raw.slice(0,80)}</div>}
            </div>
          )}
        </div>
      )}

      {toastMsg&&<div className="toast" style={{color:toastMsg.color}}>{toastMsg.msg}</div>}
    </div>
  );
}

function StaffIssue({ staffId }) {
  const { state } = useCtx();
  const { issueCard } = useA();
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [issued, setIssued] = useState({});
  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const showT = (msg,c) => { setToastMsg({msg,c}); setTimeout(()=>setToastMsg(null),3000); };
  const lookup = async () => {
    setLoading(true); setResult(null);
    await new Promise(r=>setTimeout(r,350));
    const v = input.trim().toUpperCase();
    const iss = state.db.issuances[v] || Object.values(state.db.issuances)[0];
    const iid = state.db.issuances[v] ? v : Object.keys(state.db.issuances)[0];
    if (!iss) { setResult({err:"No issuance found."}); setLoading(false); return; }
    const profs = iss.pids.map(id=>state.db.profiles[id]).filter(Boolean);
    setResult({iss,profs,iid}); setLoading(false);
  };
  const doIssue = (pid, iid) => {
    try { const{token}=issueCard({iid,pid}); setIssued(t=>({...t,[pid]:token})); showT(`✓ Card issued: ${token}`, C.ok); }
    catch(e) { showT(e.message, C.fail); }
  };
  return (
    <div className="col g14 w100 au" style={{paddingBottom:12}}>
      <div className="lbl">Issue NFC Cards</div>
      <div className="row g8">
        <input className="inp inp-staff grow" placeholder="Issuance ID (or blank for demo)" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&lookup()}/>
        <button className="btn btn-bl" style={{height:52,padding:"0 16px",flexShrink:0}} disabled={loading} onClick={lookup}>{loading?<Spinner sz={16} color="white"/>:"Find"}</button>
      </div>
      {result?.err&&<Alrt type="e">{result.err}</Alrt>}
      {result?.profs&&<div className="col g10 au">
        <div className="lbl">{result.profs.length} Profile{result.profs.length!==1?"s":""}</div>
        {result.profs.map(p=>{
          const tk = issued[p.id]||Object.values(state.db.cards).find(c=>c.pid===p.id&&c.active)?.token;
          return <div key={p.id} className="row g12 s3" onClick={()=>!tk&&doIssue(p.id,result.iid)}
            style={{padding:"12px 14px",cursor:tk?"default":"pointer",borderRadius:13,borderColor:tk?"rgba(34,212,106,0.3)":undefined,background:tk?"rgba(34,212,106,0.07)":undefined,border:"1px solid rgba(255,255,255,0.07)",transition:"all 0.2s"}}>
            <div style={{width:40,height:40,borderRadius:12,background:p.type==="adult"?`linear-gradient(135deg,${C.blue},${C.navyDk})`:`linear-gradient(135deg,${C.orange},#8B1000)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{p.type==="adult"?"⚡":"⭐"}</div>
            <div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{p.name}</div>{tk?<div className="mono" style={{fontSize:9,color:C.ok,marginTop:2}}>✓ {tk}</div>:<span className={`bdg ${p.type==="adult"?"bdg-bl":"bdg-or"}`} style={{marginTop:4}}>{p.type} · Tap to Issue</span>}</div>
            <span style={{fontSize:22}}>{tk?"✅":"🎴"}</span>
          </div>;
        })}
        {Object.keys(issued).length>0&&result.profs.filter(p=>issued[p.id]).map(p=><NfcCard key={p.id} name={p.name} type={p.type} token={issued[p.id]} anim/>)}
      </div>}
      {toastMsg&&<div className="toast" style={{color:toastMsg.c}}>{toastMsg.msg}</div>}
    </div>
  );
}

function LiveFeed() {
  const { state } = useCtx();
  const [filter, setFilter] = useState("all");
  const feed = state.db.liveEvents||[];
  const filtered = filter==="all" ? feed : feed.filter(e=>e.type===filter);
  const fmtTime = ts => { const d=Date.now()-ts; if(d<60000)return`${Math.floor(d/1000)}s`; if(d<3600000)return`${Math.floor(d/60000)}m`; return new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); };
  const scanLog = state.db.scanLog||[];

  return (
    <div className="col g12 w100 au" style={{paddingBottom:12}}>
      <div className="row g8" style={{justifyContent:"space-between"}}>
        <div className="row g8"><div className="dot dot-ok" style={{animation:"blink 2s ease-in-out infinite"}}/><div className="bc" style={{fontSize:16}}>Live Event Feed</div></div>
        <div className="row g6"><span className="bdg bdg-lv">{feed.length} Events</span></div>
      </div>

      {/* Stats strip */}
      <div className="row g8 w100">
        {[
          [state.db.stampEvents?.length||0,"Stamps","⚡",C.gold],
          [scanLog.length,"Scans","📡",C.blue],
          [state.db.metrics?.redeems||0,"Redeemed","🏆",C.orange],
        ].map(([v,l,ico,c])=>(
          <div key={l} className="mc" style={{flex:1,borderTop:`2px solid ${c}44`}}>
            <div className="row g6"><span style={{fontSize:16}}>{ico}</span><div className="mc-n" style={{color:c,fontSize:26}}>{v}</div></div>
            <div className="mc-l">{l}</div>
          </div>
        ))}
      </div>

      <div className="tabs w100">
        {[["all","All"],["stamp","Stamps"],["redeem","Redeems"],["scan","Scans"]].map(([t,l])=>(
          <button key={t} className={`tab${filter===t?" on":""}`} onClick={()=>setFilter(t)}>{l}</button>
        ))}
      </div>

      {filtered.length===0&&(
        <div className="s1 col g10" style={{padding:"32px 20px",borderRadius:18,alignItems:"center",textAlign:"center"}}>
          <span style={{fontSize:44}}>⚡</span>
          <div style={{fontSize:14,color:"rgba(240,237,230,0.38)"}}>No {filter==="all"?"events":filter+"s"} yet. Actions appear here in real time.</div>
        </div>
      )}

      <div className="col g6 w100">
        {filtered.map((evt, i) => {
          const isSt = evt.type==="stamp", isRd = evt.type==="redeem", isSc = evt.type==="scan";
          const st = isSt ? STATIONS[evt.sid] : null;
          const lineCol = isRd?C.gold:isSt?(evt.done?C.gold:C.ok):isSc?C.blue:C.fog;
          return (
            <div key={evt.id||i} className="fi ai" style={{borderLeftColor:lineCol,animationDelay:`${i*0.02}s`}}>
              <span style={{fontSize:20,flexShrink:0}}>{isRd?"🏆":isSt?st?.icon||"⚡":isSc?"📡":"🎴"}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {evt.name||"Unknown"}{isSc&&!evt.name?` — ${evt.result||"scan"}`:""}{evt.staffId&&<span style={{fontSize:10,color:"rgba(240,237,230,0.35)",marginLeft:6}}>{evt.staffId}</span>}
                </div>
                <div style={{fontSize:11,color:"rgba(240,237,230,0.38)",marginTop:1}}>
                  {isRd?`Redeemed — ${evt.count}/${evt.total||TOTAL} stamps`:
                   isSt?`${evt.stationName||evt.sid} · Stamp #${evt.count}`:
                   isSc?`Scan · ${evt.result}`:
                   "Event"}
                </div>
              </div>
              <div className="col g3" style={{alignItems:"flex-end",flexShrink:0}}>
                <span style={{fontSize:10,color:"rgba(240,237,230,0.32)",fontFamily:"'Barlow Condensed',sans-serif"}}>{fmtTime(evt.ts)}</span>
                {isSt&&evt.done&&<span className="bdg bdg-gd" style={{fontSize:7}}>DONE</span>}
                {evt.source==="fan_demo"&&<span className="bdg bdg-mu" style={{fontSize:7}}>Demo</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scan log */}
      {filter==="scan"&&scanLog.length>0&&(
        <div className="col g6 w100">
          <div className="lbl" style={{marginTop:8}}>Scan Log ({scanLog.length})</div>
          {scanLog.slice(0,20).map((s,i)=>(
            <div key={s.id||i} className="row g8 ai" style={{padding:"8px 12px",borderRadius:10,background:"rgba(0,122,193,0.05)",border:"1px solid rgba(0,122,193,0.15)",animationDelay:`${i*0.02}s`}}>
              <span style={{fontSize:14}}>📡</span>
              <div style={{flex:1}}>
                <div style={{fontSize:11,fontWeight:600,color:"rgba(240,237,230,0.8)"}}>Result: <span style={{color:s.result==="card"?C.ok:s.result==="issuance"?C.gold:C.fail}}>{s.result}</span></div>
                <div className="mono" style={{fontSize:9,color:"rgba(240,237,230,0.28)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.rawValue?.slice(0,40)||"—"}</div>
              </div>
              <span style={{fontSize:10,color:"rgba(240,237,230,0.3)",fontFamily:"'Barlow Condensed',sans-serif"}}>{fmtTime(s.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StaffDashboard() {
  const { state } = useCtx();
  const [tab, setTab] = useState("overview");
  const db = state.db, m = db.metrics||{};
  const profs = Object.values(db.profiles);
  const cards = Object.values(db.cards);
  const total = profs.length, active = cards.filter(c=>c.active).length;
  const redeemed = profs.filter(p=>p.redeemed).length;
  const complete = profs.filter(p=>Object.keys(p.stamps||{}).length>=TOTAL).length;
  const avgSt = total>0?(profs.reduce((a,p)=>a+Object.keys(p.stamps||{}).length,0)/total).toFixed(1):0;
  const maxSt = Math.max(...Object.values(m.byStation||{}),1);

  return (
    <div className="col g12 w100 au" style={{paddingBottom:12}}>
      <div className="tabs w100">
        {[["overview","Overview"],["stations","Stations"],["people","People"]].map(([t,l])=>(
          <button key={t} className={`tab${tab===t?" on":""}`} onClick={()=>setTab(t)}>{l}</button>
        ))}
      </div>

      {tab==="overview"&&<div className="col g10 w100 ai">
        <div className="row g8 wrap w100">
          {[[m.regs||0,"Registered","👤",C.blue],[cards.length,"Cards","🎴",C.gold],[active,"Active","📡",C.ok],[redeemed,"Redeemed","🏆",C.orange],[complete,"Complete","⭐",C.gold],[m.scans||0,"Scans","📊",C.blueHi]].map(([v,l,ico,c])=>(
            <div key={l} className="mc" style={{minWidth:"30%",flex:"1 1 30%",borderTop:`2px solid ${c}44`}}>
              <div className="row g6"><span style={{fontSize:16}}>{ico}</span><div className="mc-n" style={{color:c,fontSize:26}}>{v}</div></div>
              <div className="mc-l">{l}</div>
            </div>
          ))}
        </div>
        <div className="s1 col g4" style={{padding:"16px 18px",borderRadius:16}}>
          <div className="lbl" style={{marginBottom:10}}>Conversion Funnel</div>
          {[{l:"Registered",v:m.regs||0,b:Math.max(m.regs||1,1),c:C.blue},{l:"Card Issued",v:cards.length,b:Math.max(m.regs||1,1),c:C.blue},{l:"1+ Stamps",v:profs.filter(p=>Object.keys(p.stamps||{}).length>0).length,b:Math.max(total,1),c:C.gold},{l:"Completed",v:complete,b:Math.max(total,1),c:C.orange},{l:"Redeemed",v:redeemed,b:Math.max(total,1),c:C.ok}].map(row=>(
            <div key={row.l} className="col g3" style={{marginBottom:8}}>
              <div className="row" style={{justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:11,color:"rgba(240,237,230,0.4)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>{row.l}</span><span style={{fontFamily:"Anton,sans-serif",fontSize:13,color:row.c}}>{row.v} <span style={{fontSize:10,color:"rgba(240,237,230,0.35)"}}>({Math.round(row.v/row.b*100)}%)</span></span></div>
              <div className="prog" style={{height:6}}><div style={{height:"100%",borderRadius:20,background:`linear-gradient(90deg,${row.c}bb,${row.c}55)`,width:`${Math.round(row.v/row.b*100)}%`,transition:"width 0.9s ease"}}/></div>
            </div>
          ))}
        </div>
        <div className="row g8 w100">
          <div className="mc col g3" style={{flex:1,textAlign:"center"}}><div className="mc-n" style={{color:C.gold,fontSize:34}}>{avgSt}</div><div className="mc-l">Avg Stamps</div></div>
          <div className="mc col g3" style={{flex:1,textAlign:"center"}}><div className="mc-n" style={{color:C.blue,fontSize:34}}>{db.stampEvents?.length||0}</div><div className="mc-l">Total Events</div></div>
        </div>
      </div>}

      {tab==="stations"&&<div className="col g10 w100 ai">
        {Object.values(STATIONS).map((s,i)=>{
          const cnt=(m.byStation||{})[s.id]||0, bar=Math.round(cnt/maxSt*100);
          return (
            <div key={s.id} className="staff-surf au" style={{padding:"13px 15px",animationDelay:`${i*0.05}s`}}>
              <div className="row g10" style={{marginBottom:8}}>
                <span style={{fontSize:20}}>{s.icon}</span>
                <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{s.full}</div><div style={{fontSize:11,color:"rgba(240,237,230,0.38)"}}>{s.loc}</div></div>
                <div className="row g6"><div className="dot dot-ok"/><span className="bdg bdg-gn" style={{fontSize:8}}>Online</span></div>
              </div>
              <div className="row" style={{justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:10,color:"rgba(240,237,230,0.38)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>Stamps issued</span><span style={{fontFamily:"Anton,sans-serif",fontSize:15,color:C.gold}}>{cnt}</span></div>
              <div className="prog" style={{height:6}}><div style={{height:"100%",borderRadius:20,background:`linear-gradient(90deg,${C.blue},${C.gold})`,width:`${bar}%`,transition:"width 0.9s ease"}}/></div>
            </div>
          );
        })}
      </div>}

      {tab==="people"&&<div className="col g8 w100 ai">
        <div className="lbl">All Profiles ({profs.length})</div>
        {profs.map((p,i)=>{
          const cnt=Object.keys(p.stamps||{}).length, done=cnt>=TOTAL;
          return (
            <div key={p.id} className="row g10 au" style={{padding:"11px 12px",borderRadius:12,background:"rgba(255,255,255,0.022)",border:"1px solid rgba(255,255,255,0.07)",animationDelay:`${i*0.03}s`}}>
              <div style={{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${C.blue},${C.navyDk})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>⚡</div>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{p.name}</div><div className="row g5" style={{marginTop:3,flexWrap:"wrap"}}><span className={`bdg ${done?"bdg-gd":cnt>0?"bdg-bl":"bdg-mu"}`} style={{fontSize:8}}>{cnt}/{TOTAL}</span>{p.redeemed&&<span className="bdg bdg-gn" style={{fontSize:8}}>Redeemed</span>}</div></div>
              <div className="prog" style={{width:60,height:4}}><div style={{height:"100%",borderRadius:20,background:`linear-gradient(90deg,${C.blue},${C.gold})`,width:`${(cnt/TOTAL)*100}%`}}/></div>
            </div>
          );
        })}
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════ MODE SELECT ══════════
function ModeSelect() {
  const { dispatch } = useCtx();
  return (
    <div style={{position:"relative",zIndex:1,minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px 20px",maxWidth:430,margin:"0 auto"}}>
      <div className="col g14 w100 au" style={{alignItems:"center",textAlign:"center"}}>
        <div style={{width:76,height:76,borderRadius:24,background:`linear-gradient(135deg,${C.navyDk},${C.navy})`,border:"1px solid rgba(0,90,180,0.4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,boxShadow:"0 20px 60px rgba(0,0,0,0.5)",marginBottom:4}}>⚡</div>
        <div className="ant" style={{fontSize:54,lineHeight:0.9}}>LOUD<br/><span style={{WebkitTextStroke:`2px ${C.gold}`,WebkitTextFillColor:"transparent"}}>CITY</span><br/>PASS</div>
        <div style={{fontSize:13,color:"rgba(240,237,230,0.45)",lineHeight:1.6,maxWidth:280}}>OKC Thunder · Playoffs 2025<br/>Real QR scanning · Live intelligence · NFC stamp system</div>
      </div>
      <div className="col g12 w100 au d3" style={{marginTop:32}}>
        <button className="btn btn-or btn-full" style={{height:64,fontSize:18,gap:12}} onClick={()=>dispatch({t:"GO",s:"home"})}>
          <span style={{fontSize:28}}>🏀</span>
          <div className="col g2" style={{alignItems:"flex-start"}}>
            <span>Fan Experience</span>
            <span style={{fontSize:11,fontWeight:400,opacity:0.7,textTransform:"none",letterSpacing:0}}>Register · Stamp card · Claim prize</span>
          </div>
        </button>
        <button className="btn btn-bl btn-full" style={{height:64,fontSize:18,gap:12}} onClick={()=>dispatch({t:"GO",s:"staff"})}>
          <span style={{fontSize:28}}>📡</span>
          <div className="col g2" style={{alignItems:"flex-start"}}>
            <span>Staff Terminal</span>
            <span style={{fontSize:11,fontWeight:400,opacity:0.7,textTransform:"none",letterSpacing:0}}>QR scanner · Issue cards · Live dashboard</span>
          </div>
        </button>
        <div style={{fontSize:10,color:"rgba(240,237,230,0.26)",textAlign:"center",fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:1,textTransform:"uppercase",marginTop:4}}>Shared data engine · Events sync in real time · 1M-scale architecture</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════ ROOT ══════════════
const FAN_SCREENS = { home:FanHome, register:FanRegister, issuance:FanIssuance, stamps:FanStamps };
const FAN_NAV = [["home","🏠","Home"],["register","📝","Register"],["stamps","⚡","My Pass"]];

export default function App() {
  const [state, dispatch] = useReducer(reducer, {
    db: initDB(), sess: DB.loadSess(), online: navigator.onLine,
    screen: "mode_select", stack: [], toast: null,
  });

  useEffect(() => {
    if (!document.getElementById("lc-v5")) {
      const el = document.createElement("style"); el.id = "lc-v5"; el.textContent = CSS;
      document.head.appendChild(el);
    }
  }, []);

  useEffect(() => {
    const on = () => dispatch({t:"NET",v:true}), off = () => dispatch({t:"NET",v:false});
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online",on); window.removeEventListener("offline",off); };
  }, []);

  const FanScreen = FAN_SCREENS[state.screen];
  const isFan = !!FanScreen;
  const isStaff = state.screen === "staff";
  const isMode = state.screen === "mode_select";

  return (
    <Ctx.Provider value={{ state, dispatch }}>
      <div className="shell">
        <div className="shell-bg"/>
        {!state.online && <div className="offline-bar">📶 Offline — Actions queued locally</div>}
        {isMode && <ModeSelect/>}
        {isFan && (
          <>
            <FanScreen/>
            <nav className="bnav">
              {FAN_NAV.map(([s,ico,lbl]) => (
                <button key={s} className={`bnav-btn${state.screen===s?" on":""}`} onClick={()=>dispatch({t:"GO",s})}>
                  <span className="bnav-ico">{ico}</span>
                  <span className="bnav-lbl">{lbl}</span>
                </button>
              ))}
              <button className="bnav-btn" onClick={()=>dispatch({t:"GO",s:"mode_select"})}>
                <span className="bnav-ico">⚙</span>
                <span className="bnav-lbl">Switch</span>
              </button>
            </nav>
          </>
        )}
        {isStaff && <StaffApp/>}
        {state.toast && <div className="toast" style={{color:state.toast.color||C.cream}}>{state.toast.msg}</div>}
      </div>
    </Ctx.Provider>
  );
}

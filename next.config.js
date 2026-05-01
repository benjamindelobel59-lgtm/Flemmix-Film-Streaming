import { useState, useEffect, useRef, useCallback } from "react";
import Head from "next/head";

// ─── CONSTANTS ─────────────────────────────────────────────────────────────
const BLACKLIST = new Set([
  "invoflamme","elizabeth-keen","win-yop","carmelo-anthony",
  "bulla-one","zot","dams","charmander","xiph","pepsimax",
]);
const MIN_XP         = 5_000_000;
const REANNOUNCE_MS  = 120_000;

const CLASS_COLOR = {
  Pandawa:"#4fc3f7", Cra:"#a5d6a7", Sacrieur:"#ef9a9a",
  Enutrof:"#ffe082", Iop:"#ef5350", Féca:"#b39ddb",
  Ecaflip:"#f48fb1", Sadida:"#80cbc4", Xélor:"#90caf9",
  Osamodas:"#c5e1a5", Zobal:"#ce93d8", Eniripsa:"#80deea",
  Sram:"#ff8a65", Roublard:"#ffcc80", Steamer:"#bcaaa4",
  Ouginak:"#ffab40", Forgelance:"#aed581", Huppermage:"#cfd8dc",
  Eliotrope:"#fff176", Masqueraider:"#f8bbd9",
};

const TABS = [
  { id:"global",    label:"Suivi global" },
  { id:"cibles",    label:"Personnages cibles" },
  { id:"guildes",   label:"Guildes" },
  { id:"gchg",      label:"Changements guilde", badge:"orange" },
  { id:"cchg",      label:"Changements classe" },
  { id:"morts",     label:"Morts", badge:"red" },
];

// ─── HELPERS ───────────────────────────────────────────────────────────────
function timeAgo(ms) {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5)  return "Il y a moins d'une minute";
  if (s < 60) return `Il y a ${s}s`;
  if (s < 3600) return `Il y a ${Math.floor(s/60)}min`;
  return `Il y a ${Math.floor(s/3600)}h`;
}

function fxp(n) {
  if (!n && n !== 0) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  if (abs >= 1e9) return `${sign}${(abs/1e9).toFixed(2)}Md`;
  if (abs >= 1e6) return `${sign}${(abs/1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${Math.round(abs/1e3)}k`;
  return `${sign}${abs.toLocaleString()}`;
}

function getRank(p) { return p.rank ?? p.ranking ?? 999999; }

// ─── COMPONENT ─────────────────────────────────────────────────────────────
export default function Home() {
  // ── state ──
  const [rows,       setRows]       = useState([]);
  const [snapshots,  setSnapshots]  = useState(0);
  const [lastAt,     setLastAt]     = useState(null);
  const [autoRef,    setAutoRef]    = useState(true);
  const [ivl,        setIvl]        = useState(1);
  const [tab,        setTab]        = useState("global");
  const [search,     setSearch]     = useState("");
  const [fClass,     setFClass]     = useState("Toutes");
  const [fGuild,     setFGuild]     = useState("Toutes");
  const [minLvl,     setMinLvl]     = useState(1);
  const [limit,      setLimit]      = useState(500);
  const [watchInput, setWatchInput] = useState("");
  const [watched,    setWatched]    = useState({});   // key→{original,xp,gain}
  const [sortCol,    setSortCol]    = useState("gain");
  const [sortDir,    setSortDir]    = useState("desc");
  const [gchg,       setGchg]       = useState([]);
  const [cchg,       setCchg]       = useState([]);
  const [lefts,      setLefts]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [fetching,   setFetching]   = useState(false);
  const [tick,       setTick]       = useState(0);   // force re-render for timeAgo

  // ── refs (mutable, no re-render) ──
  const prevXP    = useRef({});
  const prevRank  = useRef({});
  const prevGuild = useRef({});
  const prevClass = useRef({});
  const announced = useRef({});
  const gained    = useRef({});
  const isFirst   = useRef(true);
  const timer     = useRef(null);
  const rowsRef   = useRef([]);

  // keep rowsRef in sync
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // ── derived lists ──
  const allClasses = [...new Set(rows.map(r => r.class).filter(Boolean))].sort();
  const allGuilds  = [...new Set(rows.map(r => r.guildName).filter(Boolean))].sort();

  // ── fetch ──
  const fetchData = useCallback(async () => {
    if (fetching) return;
    setFetching(true);
    try {
      const res  = await fetch("/api/ranking");
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;

      const now = Date.now();
      setSnapshots(s => s + 1);
      setLastAt(now);

      // ── first run: init maps ──
      if (isFirst.current) {
        const xpMap = {}, rankMap = {}, gMap = {}, cMap = {};
        data.forEach(p => {
          xpMap[p.username]   = p.experience;
          rankMap[p.username] = getRank(p);
          gMap[p.username]    = p.guildName;
          cMap[p.username]    = p.class;
        });
        prevXP.current    = xpMap;
        prevRank.current  = rankMap;
        prevGuild.current = gMap;
        prevClass.current = cMap;
        isFirst.current   = false;

        setRows(data.map(p => ({ ...p, gain: 0, isNew: false, rdelta: 0, lastGainAt: null })));
        setLoading(false);
        return;
      }

      const prev   = prevXP.current;
      const newGC  = [], newCC = [], newL = [];
      const newRankMap = {}, newGMap = {}, newCMap = {};

      // detect left
      Object.keys(prev).forEach(u => {
        if (!data.find(p => p.username === u)) newL.push({ username: u, at: now });
      });

      // build updated rows
      const updated = data.map(p => {
        const u      = p.username;
        const prevE  = prev[u] ?? p.experience;
        const gain   = p.experience - prevE;
        const cr     = getRank(p);
        const pr     = prevRank.current[u];
        const rdelta = (pr != null) ? (pr - cr) : 0;

        newRankMap[u] = cr;
        newGMap[u]    = p.guildName;
        newCMap[u]    = p.class;

        // guild change
        const og = prevGuild.current[u];
        if (og !== undefined && og !== p.guildName)
          newGC.push({ username: u, from: og, to: p.guildName, at: now });

        // class change
        const oc = prevClass.current[u];
        if (oc !== undefined && oc !== p.class)
          newCC.push({ username: u, from: oc, to: p.class, at: now });

        if (gain > 0) gained.current[u] = now;

        // clean stale announced
        if (gained.current[u] && (now - gained.current[u]) >= REANNOUNCE_MS) {
          delete announced.current[u];
          delete gained.current[u];
        }

        const notBlacklisted = !BLACKLIST.has(u.toLowerCase());
        const bigGain = gain >= MIN_XP && notBlacklisted;
        const lastAnn = announced.current[u] || 0;
        const fresh   = (now - lastAnn) >= REANNOUNCE_MS;
        const isNew   = bigGain && fresh;
        if (isNew) announced.current[u] = now;

        // preserve lastGainAt from existing row
        const existing = rowsRef.current.find(r => r.username === u);
        const lastGainAt = gain > 0 ? now : (existing?.lastGainAt ?? null);

        return { ...p, gain, isNew, rdelta, lastGainAt };
      });

      prevXP.current    = Object.fromEntries(data.map(p => [p.username, p.experience]));
      prevRank.current  = { ...prevRank.current,  ...newRankMap };
      prevGuild.current = { ...prevGuild.current,  ...newGMap };
      prevClass.current = { ...prevClass.current,  ...newCMap };

      setRows(updated);
      if (newL.length)  setLefts(l  => [...newL,  ...l ].slice(0, 300));
      if (newGC.length) setGchg( g  => [...newGC, ...g ].slice(0, 300));
      if (newCC.length) setCchg( c  => [...newCC, ...c ].slice(0, 300));

      // update watched xp display
      setWatched(w => {
        const next = { ...w };
        data.forEach(p => {
          const k = p.username.toLowerCase();
          if (next[k]) next[k] = { ...next[k], xp: p.experience, gain: p.experience - (prev[p.username] ?? p.experience) };
        });
        return next;
      });

      setLoading(false);
    } catch(e) {
      console.error("[fetch]", e);
    } finally {
      setFetching(false);
    }
  }, []); // no deps — uses refs

  // ── auto-refresh ──
  useEffect(() => {
    clearInterval(timer.current);
    if (autoRef) timer.current = setInterval(fetchData, ivl * 1000);
    return () => clearInterval(timer.current);
  }, [autoRef, ivl, fetchData]);

  // initial fetch
  useEffect(() => { fetchData(); }, []);

  // tick every 15s for timeAgo display
  useEffect(() => {
    const t = setInterval(() => setTick(n => n+1), 15000);
    return () => clearInterval(t);
  }, []);

  // ── watch ──
  function addWatch() {
    const t = watchInput.trim();
    if (!t) return;
    const k = t.toLowerCase();
    setWatched(w => ({ ...w, [k]: { original: t, xp: null, gain: null } }));
    setWatchInput("");
  }
  function rmWatch(k) { setWatched(w => { const n={...w}; delete n[k]; return n; }); }

  // ── export CSV ──
  function exportCSV() {
    const hdr  = ["Rang","Personnage","Niveau","Classe","Guilde","XP Total","Gain XP"].join(";");
    const body = visRows.map(p => [getRank(p), p.username, p.level, p.class, p.guildName||"", p.experience, p.gain].join(";"));
    const blob = new Blob([[hdr, ...body].join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `ranking-${Date.now()}.csv`; a.click();
  }

  // ── sort ──
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d==="asc"?"desc":"asc");
    else { setSortCol(col); setSortDir("desc"); }
  }
  function SortIco({ col }) {
    if (sortCol !== col) return <span style={{color:"var(--text-muted)",marginLeft:3,fontSize:9}}>↕</span>;
    return <span style={{color:"var(--green)",marginLeft:3,fontSize:9}}>{sortDir==="asc"?"↑":"↓"}</span>;
  }

  // ── filter + sort rows ──
  const watchKeys = new Set(Object.keys(watched));

  let vis = rows.filter(p => {
    if (p.level < minLvl) return false;
    if (fClass !== "Toutes" && p.class !== fClass) return false;
    if (fGuild !== "Toutes" && p.guildName !== fGuild) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!p.username.toLowerCase().includes(q) && !(p.guildName||"").toLowerCase().includes(q)) return false;
    }
    if (tab === "cibles") return watchKeys.has(p.username.toLowerCase());
    if (tab === "global") return p.gain > 0 || watchKeys.has(p.username.toLowerCase());
    return true;
  });

  vis = [...vis].sort((a,b) => {
    let va, vb;
    switch(sortCol) {
      case "rank":  va=getRank(a);     vb=getRank(b);     break;
      case "level": va=a.level;        vb=b.level;        break;
      case "xp":    va=a.experience;   vb=b.experience;   break;
      case "name":  return sortDir==="asc" ? a.username.localeCompare(b.username) : b.username.localeCompare(a.username);
      default:      va=a.gain;         vb=b.gain;
    }
    return sortDir==="asc" ? va-vb : vb-va;
  });

  const visRows = vis.slice(0, limit);

  // ── guild stats ──
  const gMap2 = {};
  rows.forEach(p => {
    if (!p.guildName) return;
    if (!gMap2[p.guildName]) gMap2[p.guildName] = { name: p.guildName, count: 0, gain: 0, members: [] };
    gMap2[p.guildName].count++;
    gMap2[p.guildName].gain += Math.max(0, p.gain);
  });
  const guildList = Object.values(gMap2).sort((a,b) => b.gain - a.gain).slice(0, 100);
  const maxGain   = Math.max(...guildList.map(g => g.gain), 1);

  // ── badge counts ──
  const recentGC = gchg.filter(g => Date.now() - g.at < 3_600_000).length;
  const recentMorts = lefts.length;
  const watchActive = Object.values(watched).filter(w => w.xp != null).length;

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Flemmix Streaming</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>📡</text></svg>" />
      </Head>

      {/* ── LOADING OVERLAY ── */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-logo">FLEMMIX STREAMING</div>
          <div className="spin" />
          <div className="loading-sub">Connexion au flux de données...</div>
        </div>
      )}

      <div className="app">
        {/* ─── HEADER ─── */}
        <header className="hdr">
          <div className="hdr-logo">
            <div className="hdr-logo-dot" />
            FLEMMIX STREAMING
          </div>
          <div className="hdr-meta">
            {snapshots.toLocaleString()} snapshots&nbsp;|&nbsp;{Object.keys(watched).length} cibles
          </div>
          <div className="hdr-sep" />

          <div className="hdr-status">
            <div className={`status-dot ${fetching ? "" : "idle"}`} />
            {lastAt ? timeAgo(lastAt) : "En attente..."}
          </div>

          <div className="hdr-ctrl">
            <label className="toggle-wrap" onClick={() => setAutoRef(a => !a)}>
              <div className={`toggle ${autoRef ? "on" : ""}`}><div className="toggle-k" /></div>
              Auto
            </label>
            <select className="ivl-select" value={ivl} onChange={e => setIvl(+e.target.value)}>
              {[1,2,3,5,10,30,60].map(v => <option key={v} value={v}>{v}s</option>)}
            </select>
            <button className="btn btn-g" onClick={fetchData} disabled={fetching}>
              {fetching ? "..." : "↻ Rafraîchir"}
            </button>
            <button className="btn btn-o" onClick={exportCSV}>↓ CSV</button>
          </div>
        </header>

        {/* ─── STAT STRIP ─── */}
        <div className="stat-strip">
          <div className="stat">
            <div className="stat-lbl">Personnages</div>
            <div className="stat-val">{rows.length.toLocaleString()}</div>
            <div className="stat-sub">{vis.length} affichés</div>
          </div>
          <div className="stat">
            <div className="stat-lbl">Changements guilde</div>
            <div className="stat-val">{recentGC}</div>
            <div className="stat-sub">dernière heure</div>
          </div>
          <div className="stat">
            <div className="stat-lbl">Suivis actifs</div>
            <div className="stat-val accent">{watchActive} / {Object.keys(watched).length}</div>
            <div className="stat-sub">cibles configurées</div>
          </div>
          <div className="stat">
            <div className="stat-lbl">Snapshots</div>
            <div className="stat-val">{snapshots.toLocaleString()}</div>
            <div className="stat-sub">rafraîchissements</div>
          </div>
        </div>

        {/* ─── BODY ─── */}
        <div className="body">
          {/* ─── SIDEBAR ─── */}
          <aside className="sidebar">
            <div className="sb-block">
              <div className="sb-title">Filtres globaux</div>
              <label className="form-lbl">Recherche</label>
              <input className="form-ctrl" type="text" placeholder="Nom, guilde..." value={search} onChange={e => setSearch(e.target.value)} />
              <label className="form-lbl">Classe</label>
              <select className="form-ctrl" value={fClass} onChange={e => setFClass(e.target.value)}>
                <option>Toutes</option>
                {allClasses.map(c => <option key={c}>{c}</option>)}
              </select>
              <label className="form-lbl">Guilde</label>
              <select className="form-ctrl" value={fGuild} onChange={e => setFGuild(e.target.value)}>
                <option>Toutes</option>
                {allGuilds.map(g => <option key={g}>{g}</option>)}
              </select>
              <div className="row2">
                <div>
                  <label className="form-lbl">Niveau min.</label>
                  <input className="form-ctrl" type="number" value={minLvl} min={1} max={200} onChange={e => setMinLvl(+e.target.value)} />
                </div>
                <div>
                  <label className="form-lbl">Limite</label>
                  <input className="form-ctrl" type="number" value={limit} min={10} max={5000} onChange={e => setLimit(+e.target.value)} />
                </div>
              </div>
            </div>

            <div className="sb-block">
              <div className="sb-title">Ajouter un personnage cible</div>
              <div className="input-add">
                <input
                  className="form-ctrl" style={{marginBottom:0}} type="text"
                  placeholder="Pseudo exact..." value={watchInput}
                  onChange={e => setWatchInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addWatch()}
                />
                <button className="btn-add" onClick={addWatch}>+</button>
              </div>
              <div className="watch-list">
                {Object.keys(watched).length === 0 && (
                  <div style={{color:"var(--text-muted)",fontFamily:"var(--font-mono)",fontSize:10,padding:"4px 0"}}>
                    Aucun joueur surveillé
                  </div>
                )}
                {Object.entries(watched).map(([k, v]) => (
                  <div className="watch-row" key={k}>
                    <span className="wr-name">{v.original}</span>
                    {v.gain != null && v.gain !== 0
                      ? <span className="wr-xp">{fxp(v.gain)}</span>
                      : <span className="wr-absent">absent</span>}
                    <button className="wr-del" onClick={() => rmWatch(k)}>×</button>
                  </div>
                ))}
              </div>
              {Object.keys(watched).length > 0 && (
                <button
                  className={`sel-btn ${tab === "cibles" ? "active" : ""}`}
                  onClick={() => setTab("cibles")}
                >
                  Voir personnages cibles ({Object.keys(watched).length})
                </button>
              )}
            </div>

            <div className="sb-block">
              <div className="sb-title">Blacklist ({BLACKLIST.size})</div>
              <div className="bl-wrap">
                {[...BLACKLIST].map(n => <span className="bl-tag" key={n}>{n}</span>)}
              </div>
            </div>
          </aside>

          {/* ─── MAIN ─── */}
          <main className="main">
            {/* TABS */}
            <div className="tabs">
              {TABS.map(t => (
                <div key={t.id} className={`tab ${tab===t.id?"active":""}`} onClick={() => setTab(t.id)}>
                  {t.label}
                  {t.id === "gchg" && recentGC > 0 &&
                    <span className="tab-badge orange">{recentGC}</span>}
                  {t.id === "morts" && recentMorts > 0 &&
                    <span className="tab-badge">{recentMorts}</span>}
                </div>
              ))}
            </div>

            <div className="tbl-wrap">

              {/* ── GLOBAL / CIBLES ── */}
              {(tab === "global" || tab === "cibles") && (
                <table>
                  <colgroup>
                    <col className="c-rank"/><col className="c-name"/><col className="c-lvl"/>
                    <col className="c-cls"/><col className="c-gld"/><col className="c-xp"/>
                    <col className="c-time"/><col className="c-dlt"/>
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={`c-rank ${sortCol==="rank"?"sorted":""}`} onClick={()=>toggleSort("rank")}>Rang<SortIco col="rank"/></th>
                      <th className={`c-name ${sortCol==="name"?"sorted":""}`} onClick={()=>toggleSort("name")}>Personnage<SortIco col="name"/></th>
                      <th className={`c-lvl  ${sortCol==="level"?"sorted":""}`} onClick={()=>toggleSort("level")}>Lvl<SortIco col="level"/></th>
                      <th className="c-cls">Classe</th>
                      <th className="c-gld">Guilde</th>
                      <th className={`c-xp   ${sortCol==="gain"?"sorted":""}`} onClick={()=>toggleSort("gain")}>Gain d'expérience<SortIco col="gain"/></th>
                      <th className="c-time">Dernier changement XP</th>
                      <th className="c-dlt">Rang +/-</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visRows.length === 0 && (
                      <tr className="empty-row"><td colSpan={8}>Aucune activité détectée</td></tr>
                    )}
                    {visRows.map(p => {
                      const k       = p.username.toLowerCase();
                      const isW     = watchKeys.has(k);
                      const rank    = getRank(p);
                      const ccolor  = CLASS_COLOR[p.class] || "var(--cyan)";
                      const xpCls   = isW ? "watched" : p.gain > 0 ? "pos" : "none";
                      const dCls    = p.rdelta > 0 ? "up" : p.rdelta < 0 ? "dn" : "eq";
                      return (
                        <tr key={p.username} className={isW ? "tr-watch" : p.isNew ? "tr-new" : ""}>
                          <td className="td-rank">{rank}</td>
                          <td className={`td-name ${isW?"w":""}`}>
                            {isW && <span className="eye">👁</span>}
                            {p.username}
                            {p.isNew && !isW && <span className="new-badge">Nouveau</span>}
                          </td>
                          <td className="td-lvl">{p.level}</td>
                          <td><span style={{color:ccolor,fontSize:11}}>{p.class||"?"}</span></td>
                          <td className="td-gld">{p.guildName||"—"}</td>
                          <td className={`td-xp ${xpCls}`}>
                            {p.gain !== 0 ? fxp(p.gain) : "—"}
                          </td>
                          <td className="td-time">{p.lastGainAt ? timeAgo(p.lastGainAt) : "—"}</td>
                          <td className={`td-dlt ${dCls}`}>
                            {p.rdelta !== 0 ? (p.rdelta > 0 ? `+${p.rdelta}` : p.rdelta) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {/* ── GUILDES ── */}
              {tab === "guildes" && (
                <table>
                  <thead>
                    <tr>
                      <th style={{width:44}}>#</th>
                      <th>Guilde</th>
                      <th style={{width:90}}>Membres</th>
                      <th style={{width:150}}>Gain XP</th>
                      <th style={{width:220}}>Activité</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guildList.length === 0 && <tr className="empty-row"><td colSpan={5}>Aucune donnée</td></tr>}
                    {guildList.map((g,i) => (
                      <tr key={g.name}>
                        <td className="td-rank">{i+1}</td>
                        <td style={{fontWeight:600,color:"var(--green)",fontSize:12}}>{g.name}</td>
                        <td className="td-lvl">{g.count}</td>
                        <td className={`td-xp ${g.gain>0?"pos":"none"}`}>{g.gain>0?fxp(g.gain):"—"}</td>
                        <td><span className="gbar" style={{width:`${Math.max(4,(g.gain/maxGain)*180)}px`}}/></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* ── CHANGEMENTS GUILDE ── */}
              {tab === "gchg" && (
                <table>
                  <thead>
                    <tr>
                      <th style={{width:160}}>Personnage</th>
                      <th>Ancienne guilde</th>
                      <th>Nouvelle guilde</th>
                      <th style={{width:180}}>Détecté</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gchg.length === 0 && <tr className="empty-row"><td colSpan={4}>Aucun changement détecté</td></tr>}
                    {gchg.map((g,i) => (
                      <tr key={i}>
                        <td style={{fontWeight:600}}>{g.username}</td>
                        <td style={{color:"var(--red)",fontSize:11}}>{g.from||"—"}</td>
                        <td style={{color:"var(--green)",fontSize:11}}>{g.to||"—"}</td>
                        <td className="td-time">{timeAgo(g.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* ── CHANGEMENTS CLASSE ── */}
              {tab === "cchg" && (
                <table>
                  <thead>
                    <tr>
                      <th style={{width:160}}>Personnage</th>
                      <th>Ancienne classe</th>
                      <th>Nouvelle classe</th>
                      <th style={{width:180}}>Détecté</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cchg.length === 0 && <tr className="empty-row"><td colSpan={4}>Aucun changement détecté</td></tr>}
                    {cchg.map((c,i) => (
                      <tr key={i}>
                        <td style={{fontWeight:600}}>{c.username}</td>
                        <td style={{color:"var(--text-dim)",fontSize:11}}>{c.from}</td>
                        <td style={{color:"var(--cyan)",fontSize:11}}>{c.to}</td>
                        <td className="td-time">{timeAgo(c.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* ── MORTS ── */}
              {tab === "morts" && (
                <table>
                  <thead>
                    <tr>
                      <th style={{width:200}}>Personnage</th>
                      <th>Statut</th>
                      <th style={{width:180}}>Détecté</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lefts.length === 0 && <tr className="empty-row"><td colSpan={3}>Aucun joueur n'a quitté le classement</td></tr>}
                    {lefts.map((l,i) => (
                      <tr key={i} className="tr-left">
                        <td style={{fontWeight:600,color:"var(--text-dim)"}}>👻 {l.username}</td>
                        <td style={{color:"var(--red)",fontSize:11}}>Quitté le classement</td>
                        <td className="td-time">{timeAgo(l.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

            </div>
          </main>
        </div>
      </div>
    </>
  );
}

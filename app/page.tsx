"use client";

import { useEffect, useMemo, useState } from "react";
import { teamLogoPath, teamLogoInitials } from "../lib/teamLogos";

type Match = {
  id: number;
  utcDate: string;
  status: string;
  competition?: { name: string; code?: string };
  homeTeam: { name: string; tla?: string; shortName?: string };
  awayTeam: { name: string; tla?: string; shortName?: string };
};

type DecisionAnswer = {
  excitement: number;
  stakes: number;
  rivalry: number;
  atmosphere: number;
  isDerby: number;
  composite: number;
  confidence: number;
  watchRec: "must_watch" | "recommended" | "skip";
};

type DecisionResult = {
  match: {
    id: number;
    competition: string;
    matchday?: number;
    status: string;
    kickoffUTC: string;
    homeTeam: string;
    awayTeam: string;
  };
  answers: DecisionAnswer;
  backend: "typesafe" | "local";
  reason?: string;
};

type NewsItem = {
  title: string;
  source: string;
  url: string;
  tag?: string;
  ago?: string;
};

const DEFAULT_PREFS = {
  backend: "auto" as "auto" | "typesafe" | "local",
  weights: { excitement: 0.4, stakes: 0.25, rivalry: 0.2, atmosphere: 0.15 },
  preferTopLeagues: true,
  preferLive: false,
};

const COMPETITIONS_DEFAULT =
  "WC,CL,BL1,DED,BSA,PD,FL1,ELC,PPL,EC,SA,PL";

const THEME_PRESETS = [
  { id: "violet", label: "Violet",   from: "#a78bfa", to: "#7c3aed" },
  { id: "ember",  label: "Ember",    from: "#f97316", to: "#b91c1c" },
  { id: "ocean",  label: "Ocean",    from: "#14b8a6", to: "#1e40af" },
  { id: "rose",   label: "Rose",     from: "#ec4899", to: "#6d28d9" },
  { id: "forest", label: "Forest",   from: "#22c55e", to: "#0f766e" },
  { id: "sunset", label: "Sunset",   from: "#f59e0b", to: "#b45309" },
];

function fmtKickoff(iso: string) {
  try {
    const d = new Date(iso);
    return {
      weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
      day: d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }),
      time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    };
  } catch {
    return { weekday: iso, day: "", time: "" };
  }
}

function tagColor(rec: DecisionAnswer["watchRec"]) {
  return rec === "must_watch" ? "must" : rec === "recommended" ? "rec" : "skip";
}
function tagLabel(rec: DecisionAnswer["watchRec"]) {
  return rec === "must_watch"
    ? "Must watch"
    : rec === "recommended"
      ? "Recommended"
      : "Skip";
}

function abbr(name: string) {
  return name
    .replace(/[^A-Za-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function TeamLogo({
  team,
  leagueCode,
  className,
}: {
  team: { name: string; tla?: string; shortName?: string };
  leagueCode?: string;
  className?: string;
}) {
  const initials = teamLogoInitials(team);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    teamLogoPath(team, leagueCode)
      .then((s) => {
        if (!cancelled) setSrc(s);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [team.name, team.shortName, team.tla, leagueCode]);
  return (
    <span className={className ?? "swatch"} aria-hidden>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          width={28}
          height={28}
          onError={(e) => {
            const el = e.currentTarget;
            el.style.display = "none";
            const parent = el.parentElement;
            if (parent) parent.dataset.fallback = "1";
          }}
        />
      ) : (
        <span className="swatch-fallback">{initials}</span>
      )}
    </span>
  );
}

function TeamSwatch({
  team,
  side,
  leagueCode,
}: {
  team: { name: string; tla?: string; shortName?: string };
  side: "left" | "right";
  leagueCode?: string;
}) {
  return (
    <div className={`team ${side}`}>
      {side === "left" && (
        <>
          <TeamLogo team={team} leagueCode={leagueCode} />
          <span>{team.name}</span>
        </>
      )}
      {side === "right" && (
        <>
          <span>{team.name}</span>
          <TeamLogo team={team} leagueCode={leagueCode} />
        </>
      )}
    </div>
  );
}

export default function HomePage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [decisions, setDecisions] = useState<DecisionResult[]>([]);
  const [deciding, setDeciding] = useState(false);
  const [decisionNote, setDecisionNote] = useState<string | null>(null);

  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [competitions, setCompetitions] = useState(COMPETITIONS_DEFAULT);
  const [limit, setLimit] = useState(6);
  const [activeTab, setActiveTab] = useState<"fixtures" | "live" | "rankings" | "news">("fixtures");
  const [theme, setTheme] = useState<string>("violet");
  const [navHidden, setNavHidden] = useState(false);

  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [newsQuery, setNewsQuery] = useState("");
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsSourceLabel, setNewsSourceLabel] = useState("Today");

  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? window.localStorage.getItem("jeedle-theme")
        : null;
    if (saved && THEME_PRESETS.some((t) => t.id === saved)) {
      setTheme(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("jeedle-theme", theme);
    } catch {
      /* ignore quota / privacy errors */
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let lastY = window.scrollY;
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        // Always reveal near the top so the nav doesn't get stuck hidden
        if (y < 24) {
          setNavHidden(false);
        } else if (delta > 6) {
          setNavHidden(true);
        } else if (delta < -6) {
          setNavHidden(false);
        }
        lastY = y;
        ticking = false;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function loadNews(q: string = "") {
    setNewsLoading(true);
    setNewsError(null);
    try {
      const url = `/api/news?limit=6${q ? `&q=${encodeURIComponent(q)}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        items: NewsItem[];
        source: string;
        query: string;
        error?: string;
      };
      setNewsItems(data.items ?? []);
      if (data.source === "typesafe" && data.query) {
        setNewsSourceLabel(`TypeSafe · “${data.query}”`);
      } else if (data.source === "needle3" && data.query) {
        setNewsSourceLabel(`Needle 3 · “${data.query}”`);
      } else if (data.query) {
        setNewsSourceLabel(`“${data.query}”`);
      } else if (data.source === "needle3-fallback") {
        setNewsSourceLabel("Needle 3 fallback");
      } else {
        setNewsSourceLabel("Today");
      }
      if (data.error) {
        setNewsError(data.error);
      }
    } catch (e) {
      setNewsError(e instanceof Error ? e.message : "Failed to load news");
    } finally {
      setNewsLoading(false);
    }
  }

  useEffect(() => {
    void loadNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMatches() {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(
        `/api/matches?competitions=${encodeURIComponent(competitions)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMatches(data.matches ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load matches");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rank() {
    setDeciding(true);
    setDecisions([]);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs, competitions, limit }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const hint = body.hint as string | undefined;
        throw new Error(hint ?? body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setDecisions(data.results ?? []);
      setDecisionNote(data.note ?? null);
      if (data.message) setInfo(data.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rank");
    } finally {
      setDeciding(false);
    }
  }

  function setWeight(key: keyof typeof prefs.weights, value: number) {
    setPrefs((p) => ({ ...p, weights: { ...p.weights, [key]: value } }));
  }

  const gameweek = useMemo(() => {
    const scheduled = matches.find(
      (m) => m.status === "SCHEDULED" || m.status === "TIMED",
    );
    if (!scheduled) return "Live fixtures";
    const k = fmtKickoff(scheduled.utcDate);
    return `Gameweek · ${k.weekday} ${k.day}`;
  }, [matches]);

  const liveMatches = useMemo(
    () => matches.filter((m) => m.status === "LIVE" || m.status === "IN_PLAY"),
    [matches],
  );

  const fixtureList = useMemo(() => {
    if (activeTab === "live") return liveMatches.slice(0, 8);
    return matches.slice(0, 8);
  }, [activeTab, matches, liveMatches]);
  const featuredId = decisions[0]?.match.id ?? fixtureList[0]?.id;

  function focusSection(id: string) {
    if (typeof document === "undefined") return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleNav(tab: "fixtures" | "live" | "rankings" | "news") {
    setActiveTab(tab);
    if (tab === "rankings") focusSection("section-rankings");
    else if (tab === "news") focusSection("section-news");
    else if (tab === "live") focusSection("section-fixtures");
    else focusSection("section-fixtures");
  }

  return (
    <div className="shell" id="top">
      <nav className={`nav ${navHidden ? "nav-hidden" : ""}`} aria-label="Primary">
        <a className="brand" href="#top" aria-label="Jeedle home">
          <img className="brand-mark-img" src="/jeedle-mark.svg" alt="" width={28} height={28} />
          <span className="brand-text">
            <span className="brand-name">Jeedle</span>
          </span>
        </a>
        <div className="nav-tabs" role="tablist">
          {([
            { id: "fixtures", label: "Fixtures" },
            { id: "live", label: `Live${liveMatches.length ? ` · ${liveMatches.length}` : ""}` },
            { id: "rankings", label: "Rankings" },
            { id: "news", label: "News" },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={`nav-tab ${activeTab === t.id ? "active" : ""}`}
              onClick={() => handleNav(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="nav-refresh"
          onClick={loadMatches}
          disabled={loading}
          aria-label="Refresh fixtures"
          title="Refresh fixtures"
        >
          {loading ? "…" : "↻"}
        </button>
      </nav>

      <div className="layout">
        <main>
          <section className="hero">
            <div>
              <h1>
                All
                <br />
                Fixtures
                <br />
                Ranked
              </h1>
              <p>
                A Metademic.org experiment — surfacing today's football
                fixtures scored on excitement, stakes, rivalry, and atmosphere
                so you can pick what's worth watching.
              </p>
              <div className="hero-tabs">
                <span className="hero-tab">Fixtures</span>
                <span className="hero-tab">Line Score</span>
                <span className="hero-tab">Statistics</span>
              </div>
              <div className="row-buttons" style={{ marginTop: 4 }}>
                <button className="hero-cta" onClick={rank} disabled={deciding}>
                  {deciding ? (
                    <>
                      <span className="spinner" />{" "}
                      {prefs.backend === "local"
                        ? "Asking Needle 3…"
                        : "Asking Jev…"}
                    </>
                  ) : (
                    <>▶ Rank fixtures</>
                  )}
                </button>
                <button
                  className="hero-cta ghost"
                  onClick={loadMatches}
                  disabled={loading}
                >
                  {loading ? "Refreshing…" : "↻ Refresh"}
                </button>
              </div>
              <div className="hero-foot">
                <span>● Live · {matches.length} fixtures loaded</span>
                <span>·</span>
                <span>{gameweek}</span>
              </div>
            </div>
            <div className="hero-portrait">
              <video
                className="hero-video"
                src="/hero.mp4"
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                aria-hidden
              />
              <div className="hero-portrait-tint" aria-hidden />
              <div className="label">
                <span>Decision Playground</span>
                <span>v1.0</span>
              </div>
            </div>
          </section>

          {error && <div className="toast">{error}</div>}
          {info && !error && <div className="toast info">{info}</div>}

          <section className="section" id="section-fixtures">
            <div className="section-head">
              <h2>
                {activeTab === "live" ? "Live Now" : gameweek}
              </h2>
              <span className="meta">{fixtureList.length} matches</span>
            </div>
            <div className="fixture-grid">
              {fixtureList.length === 0 && (
                <div className="empty">No fixtures in this window yet.</div>
              )}
              {fixtureList.map((m) => {
                const k = fmtKickoff(m.utcDate);
                const featured = m.id === featuredId;
                const live = m.status === "LIVE" || m.status === "IN_PLAY";
                return (
                  <article
                    key={m.id}
                    className={`fixture ${featured ? "featured" : ""}`}
                  >
                    <div className="league">
                      {(m.competition?.name ?? "Friendly").toUpperCase()}
                    </div>
                    <div className="teams">
                      <TeamSwatch team={m.homeTeam} leagueCode={m.competition?.code} side="left" />
                      <span className="vs" aria-hidden>VS</span>
                      <TeamSwatch team={m.awayTeam} leagueCode={m.competition?.code} side="right" />
                    </div>
                    <div className="when">
                      <span>{k.weekday} {k.day}</span>
                      <span>{k.time}</span>
                    </div>
                    <div className="row">
                      <span className={`badge ${live ? "live" : "soon"}`}>
                        {live ? "● Live" : m.status}
                      </span>
                      {featured && <span className="badge soon">Top pick</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="section" id="section-rankings">
            <div className="section-head">
              <h2>Live Rankings</h2>
              <span className="meta">
                {decisions.length > 0
                  ? `${decisions.length} decisions from Jev`
                  : "Run Rank fixtures to populate"}
              </span>
            </div>
            <div className="rank-grid">
              {decisions.length === 0 && (
                <div className="empty" style={{ gridColumn: "1 / -1" }}>
                  No rankings yet — adjust the sliders on the right and tap
                  <strong> Rank fixtures</strong>.
                </div>
              )}
              {decisions.map((d, i) => {
                const k = fmtKickoff(d.match.kickoffUTC);
                return (
                  <article key={d.match.id} className="rank-card">
                    <span className="pos">#{i + 1}</span>
                    <div className="league">
                      {d.match.competition.toUpperCase()}
                      {d.match.matchday ? ` · MD ${d.match.matchday}` : ""}
                    </div>
                    <div className="fixture-line">
                      <span>{d.match.homeTeam}</span>
                      <span className="vs-pill">vs</span>
                      <span>{d.match.awayTeam}</span>
                    </div>
                    <div className="when">
                      {k.weekday} {k.day} · {k.time} ·{" "}
                      <span className="muted">{d.match.status}</span>
                    </div>
                    <span className={`tag ${tagColor(d.answers.watchRec)}`}>
                      ● {tagLabel(d.answers.watchRec)}
                    </span>
                    <span
                      className="tag backend-badge"
                      data-backend={d.backend}
                      title={d.reason ?? (d.backend === "typesafe" ? "Judged by TypeSafe Jev" : "Judged by Needle 3 (offline heuristic)")}
                      style={{ marginLeft: 6 }}
                    >
                      {d.backend === "typesafe" ? "Jev" : "Needle 3"}
                    </span>
                    <div className="scores">
                      <div className="score">
                        <div className="k">Excitement</div>
                        <div className="v">
                          {(d.answers.excitement * 100).toFixed(0)}
                        </div>
                      </div>
                      <div className="score">
                        <div className="k">Stakes</div>
                        <div className="v">
                          {(d.answers.stakes * 100).toFixed(0)}
                        </div>
                      </div>
                      <div className="score">
                        <div className="k">Rivalry</div>
                        <div className="v">
                          {(d.answers.rivalry * 100).toFixed(0)}
                        </div>
                      </div>
                      <div className="score">
                        <div className="k">Atmosphere</div>
                        <div className="v">
                          {(d.answers.atmosphere * 100).toFixed(0)}
                        </div>
                      </div>
                    </div>
                    <div className="composite">
                      <div className="big">
                        {(d.answers.composite * 100).toFixed(0)}
                      </div>
                      <div>
                        <div className="lbl">Composite</div>
                        <div className="conf">
                          Confidence {(d.answers.confidence * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="conf">
                        Derby {(d.answers.isDerby * 100).toFixed(0)}%
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </main>

        <aside>
          <section className="panel">
            <h3>
              Scoring weights <span className="sub">Tune</span>
            </h3>
            {(["excitement", "stakes", "rivalry", "atmosphere"] as const).map(
              (k) => (
                <div className="slider" key={k}>
                  <span>{k[0].toUpperCase() + k.slice(1)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={prefs.weights[k]}
                    onChange={(e) => setWeight(k, parseFloat(e.target.value))}
                  />
                  <span className="val">{prefs.weights[k].toFixed(2)}</span>
                </div>
              ),
            )}
            <div className="toggle-row">
              <button
                className={`chip ${prefs.preferTopLeagues ? "on" : ""}`}
                onClick={() =>
                  setPrefs((p) => ({ ...p, preferTopLeagues: !p.preferTopLeagues }))
                }
              >
                Top leagues
              </button>
              <button
                className={`chip ${prefs.preferLive ? "on" : ""}`}
                onClick={() =>
                  setPrefs((p) => ({ ...p, preferLive: !p.preferLive }))
                }
              >
                Live only
              </button>
            </div>
            <div className="toggle-row" style={{ marginTop: 10 }}>
              {(["auto", "typesafe", "local"] as const).map((b) => (
                <button
                  key={b}
                  className={`chip ${prefs.backend === b ? "on" : ""}`}
                  onClick={() => setPrefs((p) => ({ ...p, backend: b }))}
                  title={
                    b === "auto"
                      ? "Try TypeSafe Jev; fall back to Needle 3 on failure"
                      : b === "typesafe"
                        ? "Always call TypeSafe Jev (no fallback)"
                        : "Needle 3 heuristic only — no API key required"
                  }
                >
                  {b === "auto" ? "Auto" : b === "typesafe" ? "Jev" : "Needle 3"}
                </button>
              ))}
            </div>
            <div className="slider" style={{ marginTop: 12 }}>
              <span>Matches</span>
              <input
                type="range"
                min={1}
                max={12}
                value={limit}
                onChange={(e) =>
                  setLimit(parseInt(e.target.value, 10) || 6)
                }
              />
              <span className="val">{limit}</span>
            </div>
            <input
              type="text"
              value={competitions}
              onChange={(e) => setCompetitions(e.target.value)}
              placeholder="WC,CL,BL1,DED,BSA,PD,FL1,ELC,PPL,EC,SA,PL"
              style={{
                width: "100%",
                marginTop: 10,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--line-soft)",
                borderRadius: 10,
                padding: "8px 10px",
                color: "var(--fg)",
                fontSize: 12,
              }}
            />
          </section>

          <section className="panel" id="section-news">
            <h3>
              Latest News <span className="sub">{newsSourceLabel}</span>
            </h3>
            <div className="news-search">
              <input
                type="search"
                value={newsQuery}
                onChange={(e) => setNewsQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") loadNews(newsQuery);
                }}
                placeholder="Search trending football news…"
                aria-label="Search news"
              />
              <button
                type="button"
                className="news-search-btn"
                onClick={() => loadNews(newsQuery)}
                disabled={newsLoading}
                aria-label="Search"
              >
                {newsLoading ? "…" : "→"}
              </button>
            </div>
            {newsError && <div className="toast">{newsError}</div>}
            {newsItems.length === 0 && !newsLoading && !newsError && (
              <div className="empty">No headlines match this search yet.</div>
            )}
            {newsItems.map((n, i) => (
              <a
                key={`${n.url}-${i}`}
                className="news-item"
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div
                  className={`news-thumb ${
                    i % 5 === 1
                      ? "alt"
                      : i % 5 === 2
                        ? "alt2"
                        : i % 5 === 3
                          ? "alt3"
                          : i % 5 === 4
                            ? "alt4"
                            : ""
                  }`}
                  aria-hidden
                />
                <div>
                  <div className="t">{n.title}</div>
                  <div className="m">
                    {n.source}
                    {n.ago ? ` · ${n.ago} ago` : ""}
                    {n.tag ? ` · ${n.tag}` : ""}
                  </div>
                </div>
              </a>
            ))}
          </section>

          <section className="panel">
            <h3>
              Composite Table <span className="sub">Top picks</span>
            </h3>
            <div className="table-grid">
              {(decisions.length > 0 ? decisions.slice(0, 6) : matches.slice(0, 6)).map(
                (row, i) => {
                  const featured = i === 0;
                  const isDecision = "answers" in row;
                  const id = isDecision ? (row as DecisionResult).match.id : (row as Match).id;
                  const name = isDecision
                    ? `${(row as DecisionResult).match.homeTeam} vs ${(row as DecisionResult).match.awayTeam}`
                    : `${(row as Match).homeTeam.name} vs ${(row as Match).awayTeam.name}`;
                  const score = isDecision
                    ? Math.round((row as DecisionResult).answers.composite * 100)
                    : 60 + ((i * 7) % 30);
                  const swatch = abbr(name.split(" vs ")[0]);
                  const homeTeam = isDecision
                    ? { name: (row as DecisionResult).match.homeTeam }
                    : (row as Match).homeTeam;
                  const leagueCode = isDecision
                    ? undefined
                    : (row as Match).competition?.code;
                  return (
                    <div key={id} className={`table-cell ${featured ? "featured" : ""}`}>
                      <TeamLogo team={homeTeam} leagueCode={leagueCode} className="crest" />
                      <div className="name">{name}</div>
                      <div className="pts">
                        {score}
                        <span>PTS</span>
                      </div>
                      <div className="dots">
                        {Array.from({ length: 5 }).map((_, di) => (
                          <span
                            key={di}
                            className={
                              di < Math.floor(score / 25)
                                ? "dot win"
                                : di === Math.floor(score / 25)
                                  ? "dot draw"
                                  : "dot muted"
                            }
                          />
                        ))}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
            <button className="btn-ghost" style={{ marginTop: 12 }}>
              View more →
            </button>
          </section>

          <section className="panel">
            <h3>
              How Jev decides <span className="sub">Method</span>
            </h3>
            <p className="small muted" style={{ marginTop: 0 }}>
              Each fixture is evaluated by Jev with four parallel{" "}
              <strong style={{ color: "var(--fg)" }}>Score</strong> questions
              and one <strong style={{ color: "var(--fg)" }}>Noul</strong>.
              Your weights combine them into a composite. Tags use thresholds —
              {" "}<strong style={{ color: "var(--good)" }}>Must watch</strong>
              {" "}requires composite ≥ 70 and average score confidence ≥ 45%.
            </p>
            <div className="scores" style={{ marginTop: 10 }}>
              <div className="score">
                <div className="k">Model</div>
                <div className="v">
                  {prefs.backend === "local"
                    ? "needle3"
                    : prefs.backend === "typesafe"
                      ? "jev-latest"
                      : decisionNote?.startsWith("Using local")
                        ? "needle3"
                        : "jev-latest"}
                </div>
              </div>
              <div className="score">
                <div className="k">Questions</div>
                <div className="v">5 / match</div>
              </div>
            </div>
            {decisionNote && (
              <p
                className="small"
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "rgba(167,139,250,0.10)",
                  border: "1px solid rgba(167,139,250,0.25)",
                  color: "var(--fg)",
                }}
              >
                {decisionNote}
              </p>
            )}
          </section>

          <section className="panel">
            <h3>
              Background Theme <span className="sub">{theme}</span>
            </h3>
            <div className="albums">
              {THEME_PRESETS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`album theme-swatch ${theme === t.id ? "active" : ""}`}
                  onClick={() => setTheme(t.id)}
                  aria-label={`Apply ${t.label} theme`}
                  aria-pressed={theme === t.id}
                  title={t.label}
                  style={{
                    background: `linear-gradient(135deg, ${t.from} 0%, ${t.to} 100%)`,
                  }}
                >
                  <span className="swatch-label">{t.label}</span>
                </button>
              ))}
            </div>
            <button
              className="btn-ghost"
              style={{ marginTop: 10 }}
              onClick={() => setTheme("violet")}
            >
              Reset theme
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}
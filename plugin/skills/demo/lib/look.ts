// Seismic's look (frost) for the pages the demo skill writes, the report page and the schema-change page:
// the tokens of the shared demo pages (src/server/demo-page.ts) and the project (src/ui/frost.css), kept
// here since the skill runs without Seismic's sources. Light and dark follow the system, or a
// `data-theme` on the root as a host may set it. Inter where the viewer has it, the system's font else.

const LIGHT = `--bg:#e6edf5; --card:rgba(255,255,255,.82); --ink:#14202e; --muted:#5a6b80; --line:rgba(120,145,175,.28);
  --chip:rgba(120,150,190,.14); --accent:#0b8b93; --accent-glow:rgba(11,139,147,.3); --waiting:#e05f00;
  --add:#2f9a3f; --chg:#c25400; --del:#c42b1c;
  --shadow:0 1px 3px rgba(30,55,90,.08), 0 8px 24px -10px rgba(40,70,110,.18);
  --board:radial-gradient(1100px 800px at 12% 18%, rgba(140,185,255,.22), transparent 60%),
    radial-gradient(900px 700px at 88% 30%, rgba(255,190,220,.14), transparent 60%),
    radial-gradient(1000px 900px at 60% 95%, rgba(150,230,220,.18), transparent 60%),
    linear-gradient(135deg, #dce6f2, #eef3f9 55%, #d7e2ef);
  color-scheme:light;`;

const DARK = `--bg:#0d1420; --card:rgba(18,28,44,.78); --ink:#e6eef8; --muted:#8fa3bb; --line:rgba(160,205,255,.16);
  --chip:rgba(140,185,240,.12); --accent:#2fc2c0; --accent-glow:rgba(47,194,192,.45); --waiting:#ff8a2a;
  --add:#6fcf6a; --chg:#ff9a3c; --del:#ff7a63;
  --shadow:0 1px 3px rgba(0,0,0,.4), 0 12px 28px -8px rgba(0,0,0,.7);
  --board:radial-gradient(1100px 800px at 12% 18%, rgba(50,90,180,.18), transparent 60%),
    radial-gradient(900px 700px at 88% 30%, rgba(130,60,150,.10), transparent 60%),
    radial-gradient(1000px 900px at 60% 95%, rgba(20,120,130,.12), transparent 60%),
    linear-gradient(135deg, #0d1420, #141d2b 55%, #0b111a);
  color-scheme:dark;`;

/** The tokens and the board, the page's own rules go after it. */
export const LOOK = `
:root { ${LIGHT} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} } }
:root[data-theme="dark"] { ${DARK} }
* { box-sizing: border-box; }
body { margin:0; background-color:var(--bg); background-image:var(--board); background-attachment:fixed; color:var(--ink);
  font:15px/1.55 Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing:antialiased; min-height:100vh; }
h1, h2 { font-weight:650; letter-spacing:-.018em; }
`;

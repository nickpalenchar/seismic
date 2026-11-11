import { LOOK } from './look.ts';

export const SCHEMA_STYLE = `
${LOOK}
:root { --add-bg:color-mix(in srgb, var(--add) 13%, var(--card)); --chg-bg:color-mix(in srgb, var(--chg) 13%, var(--card));
  --del-bg:color-mix(in srgb, var(--del) 13%, var(--card)); }
main { padding:20px 20px 28px; }
.mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size:.92em; }
h1 { font-size:22px; line-height:1.25; margin:0 0 4px; }
h2 { font-size:16px; margin:24px 0 8px; }
.sub { color:var(--muted); margin:0 0 14px; }
.legend { display:flex; flex-wrap:wrap; gap:14px; color:var(--muted); font-size:13px; margin-bottom:14px; }
.legend span::before { content:""; display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; border:2px solid var(--c); }
.legend .added { --c:var(--add); } .legend .changed { --c:var(--chg); } .legend .removed { --c:var(--del); } .legend .same { --c:var(--line); }
.diagram { position:relative; display:flex; gap:72px; align-items:flex-start; padding:4px; width:max-content; min-width:100%; }
.column { display:flex; flex-direction:column; gap:28px; }
.diagram svg { position:absolute; inset:0; pointer-events:none; overflow:visible; }
.entity { position:relative; z-index:1; background:var(--card); border:2px solid var(--line); border-radius:12px; box-shadow:var(--shadow); min-width:220px; max-width:420px; overflow:hidden; }
.entity.added { border-color:var(--add); } .entity.changed { border-color:var(--chg); } .entity.removed { border-color:var(--del); }
.entity.neighbour { border-style:dashed; opacity:.85; }
.entity header { display:flex; align-items:center; gap:6px; padding:7px 10px; font-weight:600; border-bottom:1px solid var(--line); background:var(--chip); }
.entity.added header { background:var(--add-bg); } .entity.changed header { background:var(--chg-bg); } .entity.removed header { background:var(--del-bg); }
.entity header .tag { margin-left:auto; font-weight:500; font-size:12px; color:var(--muted); }
.entity.added .tag { color:var(--add); } .entity.changed .tag { color:var(--chg); } .entity.removed .tag { color:var(--del); }
.entity ul { list-style:none; margin:0; padding:4px 0; }
.entity ul.indexes { border-top:1px solid var(--line); }
.entity ul.indexes .field { white-space:normal; flex-wrap:wrap; }
.field { display:flex; align-items:baseline; gap:6px; padding:2px 10px; white-space:nowrap; }
.field .fname { flex:none; }
.field .ftype { color:var(--muted); margin-left:auto; padding-left:12px; }
.field.added { background:var(--add-bg); } .field.added .fname, .field.added .sign { color:var(--add); }
.field.changed { background:var(--chg-bg); } .field.changed .fname, .field.changed .sign { color:var(--chg); }
.field.removed { background:var(--del-bg); } .field.removed .fname, .field.removed .sign { color:var(--del); }
.field.removed .fname, .field.removed .ftype, .entity.removed .ename { text-decoration:line-through; }
.sign { width:10px; flex:none; font-weight:700; text-align:center; }
.entity.added .ename { color:var(--add); } .entity.removed .ename { color:var(--del); }
.badge { font-size:10px; font-weight:600; letter-spacing:.03em; color:var(--muted); border:1px solid var(--line); border-radius:4px; padding:0 4px; }
.ref { color:var(--muted); font-size:12px; }
.more { color:var(--muted); font-size:12px; padding:2px 10px 2px 26px; font-style:italic; }
s { opacity:.7; }
path.rel { fill:none; stroke:var(--muted); stroke-width:1.5; }
path.rel.added { stroke:var(--add); stroke-width:2; } path.rel.removed { stroke:var(--del); stroke-dasharray:5 4; }
marker path { stroke:none; }
ul.changes { margin:0; padding:0; list-style:none; }
ul.changes li { padding:3px 0 3px 22px; position:relative; }
ul.changes li::before { position:absolute; left:4px; font-weight:700; }
ul.changes li.added::before { content:"+"; color:var(--add); } ul.changes li.changed::before { content:"~"; color:var(--chg); } ul.changes li.removed::before { content:"−"; color:var(--del); }
.sources { color:var(--muted); font-size:13px; }
.none { color:var(--muted); }
`;


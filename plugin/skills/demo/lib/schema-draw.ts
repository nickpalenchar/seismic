// Relation overlay: index endpoints once and coalesce layout notifications.
export const DRAW = `(() => {
  const data = JSON.parse(document.getElementById('relations').textContent);
  const diagram = document.querySelector('.diagram');
  const svg = diagram.querySelector('svg');
  const entities = new Map([...diagram.querySelectorAll('section.entity')].map(el => [el.dataset.entity, el]));
  const fields = new Map([...diagram.querySelectorAll('li[data-field]')].map(el => [JSON.stringify([el.dataset.entity, el.dataset.field]), el]));
  const findField = (entity, field) => fields.get(JSON.stringify([entity, field]));
  const draw = () => {
    const box = diagram.getBoundingClientRect();
    svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
    const rects = new Map();
    const rect = el => { if (!rects.has(el)) rects.set(el, el.getBoundingClientRect()); return rects.get(el); };
    const paths = document.createDocumentFragment();
    for (const r of data) {
      const from = findField(r.from[0], r.from[1]);
      const target = entities.get(r.to[0]);
      if (!from || !target) continue;
      const to = (r.to[1] != null && findField(r.to[0], r.to[1])) || target.querySelector('header');
      const a = rect(from), b = rect(to);
      const ea = rect(from.closest('section')), eb = rect(target);
      const ya = a.top + a.height / 2 - box.top, yb = b.top + b.height / 2 - box.top;
      let xa, xb, da, db;
      const ca = (ea.left + ea.right) / 2, cb = (eb.left + eb.right) / 2;
      // beside each other: from the facing sides; one above the other: out on the right and back
      if (Math.abs(cb - ca) < 40) { xa = ea.right; xb = eb.right; da = 1; db = 1; }
      else if (cb > ca) { xa = ea.right; xb = eb.left; da = 1; db = -1; }
      else { xa = ea.left; xb = eb.right; da = -1; db = 1; }
      xa -= box.left; xb -= box.left;
      const bend = Math.max(28, Math.abs(xb - xa) / 2.5);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M' + xa + ' ' + ya + ' C' + (xa + da * bend) + ' ' + ya + ' ' + (xb + db * bend) + ' ' + yb + ' ' + xb + ' ' + yb);
      p.setAttribute('class', 'rel ' + r.status);
      p.setAttribute('marker-end', 'url(#arrow-' + r.status + ')');
      paths.appendChild(p);
    }
    svg.querySelectorAll('path.rel').forEach(p => p.remove());
    svg.appendChild(paths);
  };
  let frame;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
  addEventListener('load', schedule);
  addEventListener('resize', schedule);
  new ResizeObserver(schedule).observe(diagram);
  draw();
})();`;


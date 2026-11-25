




(() => {
  
  
  
  if (window.__demo || window !== window.top) return;
  
  
  
  const CLOCK = { bits: 24, cell: 3, left: 2, bottom: 3 };
  const strip = document.createElement('canvas');
  strip.width = CLOCK.bits * CLOCK.cell;
  strip.height = CLOCK.cell;
  strip.style.cssText =
    `position:fixed;left:${CLOCK.left}px;bottom:${CLOCK.bottom}px;width:${strip.width}px;height:${strip.height}px;` +
    'pointer-events:none;z-index:2147483647;image-rendering:pixelated;';
  const pen = strip.getContext('2d');
  function tick() {
    if (!strip.isConnected && document.documentElement) document.documentElement.appendChild(strip);
    
    const code = Math.floor(Date.now() / 10) % 2 ** CLOCK.bits;
    for (let i = 0; i < CLOCK.bits; i++) {
      pen.fillStyle = (code >> (CLOCK.bits - 1 - i)) & 1 ? '#000' : '#fff';
      pen.fillRect(i * CLOCK.cell, 0, CLOCK.cell, CLOCK.cell);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  const ACCENT = '#f5a524';
  
  const EDGE = 8;
  let root = null;
  let cursor = null;
  let rings = [];
  let dim = null;
  let stage = null;
  let veil = null;
  let pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    cursor = document.createElement('div');
    cursor.innerHTML =
      '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L9 18.5 L13.5 28 L17.5 26.2 L13 17 L21 17 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    cursor.style.cssText =
      'position:absolute;left:0;top:0;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));' +
      'transition:transform 700ms cubic-bezier(.45,0,.2,1);will-change:transform;';
    cursor.style.transform = `translate(${pointer.x}px,${pointer.y}px)`;
    root.appendChild(cursor);
    document.documentElement.appendChild(root);
    requestAnimationFrame(track);
    return root;
  }

  
  
  
  function visibleRect(el) {
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    let fixed = getComputedStyle(el).position === 'fixed';
    for (let a = parentOf(el); a && !fixed; a = parentOf(a)) {
      const style = getComputedStyle(a);
      const paint = /paint|strict|content/.test(style.contain);
      const clipsX = paint || style.overflowX !== 'visible';
      const clipsY = paint || style.overflowY !== 'visible';
      
      if ((clipsX || clipsY) && !/^(inline|contents)$/.test(style.display)) {
        
        const b = a.getBoundingClientRect();
        const x = b.left + a.clientLeft;
        const y = b.top + a.clientTop;
        
        if (a !== document.documentElement && a !== document.body) {
          if (clipsX) {
            left = Math.max(left, x);
            right = Math.min(right, x + a.clientWidth);
          }
          if (clipsY) {
            top = Math.max(top, y);
            bottom = Math.min(bottom, y + a.clientHeight);
          }
        }
      }
      
      fixed = style.position === 'fixed';
    }
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, window.innerWidth);
    bottom = Math.min(bottom, window.innerHeight);
    return right > left && bottom > top ? { left, top, right, bottom } : null;
  }

  function parentOf(el) {
    return el.parentElement || (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);
  }

  
  function unionRect(elements) {
    const rects = elements.filter((e) => e && e.isConnected).map(visibleRect).filter(Boolean);
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, top, width: right - left, height: bottom - top };
  }

  
  
  
  
  const SVG = 'http://www.w3.org/2000/svg';
  function ensureDim() {
    if (dim && dim.el.isConnected) return dim;
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;background:rgba(15,23,42,.18);opacity:0;transition:opacity 300ms ease;';
    root.insertBefore(el, root.firstChild);
    requestAnimationFrame(() => (el.style.opacity = '1'));
    dim = { el, path: '' };
    return dim;
  }
  
  function rounded(x, y, w, h, r) {
    return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  }

  function track() {
    for (const ring of rings) {
      const r = unionRect(ring.elements);
      
      
      ring.box.style.display = r ? '' : 'none';
      ring.hole = null;
      if (!r) continue;
      const pad = 6;
      Object.assign(ring.box.style, {
        left: `${r.left - pad}px`,
        top: `${r.top - pad}px`,
        width: `${r.width + 2 * pad}px`,
        height: `${r.height + 2 * pad}px`,
      });
      
      const drawn = ring.box.getBoundingClientRect();
      ring.hole = drawn;
    }
    if (dim) {
      const holes = rings.filter((x) => x.hole).map((x) => rounded(Math.round(x.hole.left), Math.round(x.hole.top), Math.round(x.hole.width), Math.round(x.hole.height), 12));
      const path = `path(evenodd, "M0 0H${innerWidth}V${innerHeight}H0Z${holes.join('')}")`;
      if (path !== dim.path) dim.el.style.clipPath = dim.path = path;
    }
    
    
    for (const ring of rings) {
      if (!ring.tag) continue;
      const box = ring.box.getBoundingClientRect();
      const h = ring.tag.offsetHeight + 8;
      const above = { top: box.top - h, bottom: box.top };
      const covers = rings.some((other) => {
        if (other === ring) return false;
        const o = other.box.getBoundingClientRect();
        return o.top < above.bottom && o.bottom > above.top;
      });
      const below = (covers || above.top < EDGE) && box.bottom + h <= innerHeight - EDGE;
      ring.tag.style.bottom = below ? '' : 'calc(100% + 8px)';
      ring.tag.style.top = below ? 'calc(100% + 8px)' : '';
      
      
      const w = ring.tag.offsetWidth;
      const left = Math.max(EDGE, Math.min(box.left, innerWidth - EDGE - w));
      
      ring.tag.style.left = `${left - box.left - ring.box.clientLeft}px`;
    }
    requestAnimationFrame(track);
  }

  
  
  
  
  
  
  function hidden(elements) {
    return elements.map((el) => {
      const r = el && el.isConnected && visibleRect(el);
      if (!r) return false;
      for (const fx of [0.1, 0.5, 0.9])
        for (const fy of [0.1, 0.5, 0.9]) {
          const hit = document.elementFromPoint(r.left + (r.right - r.left) * fx, r.top + (r.bottom - r.top) * fy);
          if (hit && (el === hit || el.contains(hit))) return false;
        }
      return true;
    });
  }

  window.__demo = {
    hidden,
    moveTo(x, y, instant = false) {
      ensureRoot();
      pointer = { x, y };
      
      cursor.style.transition = instant ? 'none' : 'transform 700ms cubic-bezier(.45,0,.2,1)';
      cursor.style.transform = `translate(${x - 3}px,${y - 2}px)`;
    },
    ripple() {
      ensureRoot();
      const dot = document.createElement('div');
      dot.style.cssText =
        `position:absolute;left:${pointer.x - 22}px;top:${pointer.y - 22}px;width:44px;height:44px;` +
        `border-radius:50%;background:${ACCENT};opacity:.55;transform:scale(.2);` +
        'transition:transform 450ms ease-out,opacity 450ms ease-out;';
      root.insertBefore(dot, cursor);
      requestAnimationFrame(() => {
        dot.style.transform = 'scale(1)';
        dot.style.opacity = '0';
      });
      setTimeout(() => dot.remove(), 600);
    },
    
    
    
    highlight(elements, label) {
      ensureRoot();
      const same = rings.find((r) => r.elements.length === elements.length && r.elements.every((e) => elements.includes(e)));
      if (same) return { same: same.tag ? same.tag.textContent : '' };
      const box = document.createElement('div');
      box.style.cssText =
        `position:absolute;border:3px solid ${ACCENT};border-radius:12px;` +
        'box-shadow:0 0 18px rgba(245,165,36,.55);' +
        'opacity:0;transition:opacity 300ms ease;';
      let tag = null;
      if (label) {
        tag = document.createElement('div');
        tag.textContent = label;
        tag.style.cssText =
          `position:absolute;left:-3px;bottom:calc(100% + 8px);background:${ACCENT};color:#111;` +
          'font:600 15px/1.2 system-ui,sans-serif;padding:6px 10px;border-radius:8px;' +
          
          `box-sizing:border-box;width:max-content;max-width:calc(100vw - ${2 * EDGE}px);`;
        box.appendChild(tag);
      }
      root.insertBefore(box, cursor);
      ensureDim();
      rings.push({ box, elements, tag, hole: null });
      requestAnimationFrame(() => {
        box.style.opacity = '1';
      });
    },
    clearHighlights() {
      for (const ring of rings) ring.box.remove();
      rings = [];
      if (dim) dim.el.remove();
      dim = null;
    },
    showImage(src, top, caption) {
      ensureRoot();
      this.hideImage();
      stage = document.createElement('div');
      stage.style.cssText =
        'position:absolute;inset:0;background:rgba(15,23,42,.72);overflow:hidden;' +
        'opacity:0;transition:opacity 350ms ease;';
      const img = document.createElement('img');
      img.src = src;
      const width = Math.min(1000, window.innerWidth - 120);
      img.style.cssText =
        `position:absolute;left:50%;top:40px;width:${width}px;margin-left:${-width / 2}px;` +
        'border-radius:6px;box-shadow:0 20px 60px rgba(0,0,0,.5);background:#fff;' +
        'transition:transform 1200ms cubic-bezier(.45,0,.2,1);';
      stage.appendChild(img);
      if (caption) {
        const cap = document.createElement('div');
        cap.textContent = caption;
        cap.style.cssText =
          'position:absolute;left:24px;top:24px;background:#111;color:#fff;border-radius:8px;' +
          'font:600 15px/1.2 system-ui,sans-serif;padding:8px 12px;z-index:1;';
        stage.appendChild(cap);
      }
      root.insertBefore(stage, cursor);
      const place = () => {
        stage.dataset.ready = '1';
        this.panImage(top);
      };
      img.complete ? place() : (img.onload = place);
      requestAnimationFrame(() => (stage.style.opacity = '1'));
    },
    panImage(top) {
      if (!stage) return;
      const img = stage.querySelector('img');
      img.style.transform = `translateY(${-top * img.getBoundingClientRect().height}px)`;
    },
    hideImage() {
      if (stage) stage.remove();
      stage = null;
    },
    
    
    whiteOut() {
      ensureRoot();
      if (veil) veil.remove();
      veil = document.createElement('div');
      veil.style.cssText =
        'position:absolute;inset:0;background:#fff;display:grid;place-items:center;' +
        'color:#57534e;font:600 30px/1.2 system-ui,sans-serif;opacity:0;transition:opacity 250ms ease-in;';
      root.appendChild(veil);
      requestAnimationFrame(() => (veil.style.opacity = '1'));
    },
    timeJump(label) {
      
      if (!veil || !veil.isConnected) {
        this.whiteOut();
        veil.style.transition = 'none';
        veil.style.opacity = '1';
      }
      veil.textContent = label;
    },
    whiteIn() {
      if (!veil) return;
      const v = veil;
      veil = null;
      v.style.transition = 'opacity 400ms ease-out';
      v.style.opacity = '0';
      setTimeout(() => v.remove(), 450);
    },
  };
})();

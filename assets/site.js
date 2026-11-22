/* Aman Kumar Singh: one-page résumé and portfolio. "Fluid" direction.
   Plain JS, no dependencies, no build step. All content lives in index.html; this file only enhances it:
   ink loader, WebGL stable-fluids background (with a still CSS wash as fallback), kinetic name, ink cursor,
   work-row previews, liquid-lens portrait, career river, skill finder, series vials, dock and scroll-spy. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const FINE = matchMedia('(hover: hover) and (pointer: fine)');
const reduced = () => RM.matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const root = document.documentElement;
const noop = () => {};

/* ---------- years of experience, computed from the role dates (first role: June 2019) ---------- */
const NOW = new Date();
const monthsSince = (y, m) => (NOW.getFullYear() - y) * 12 + (NOW.getMonth() + 1 - m);
const dur = n => [Math.floor(n / 12) && `${Math.floor(n / 12)} year${n >= 24 ? 's' : ''}`, n % 12 && `${n % 12} month${n % 12 > 1 ? 's' : ''}`].filter(Boolean).join(' ') || 'under a month';
$$('[data-years-short]').forEach(el => { el.textContent = Math.floor(monthsSince(2019, 6) / 12) + '+'; });
$$('[data-since]').forEach(el => { const [y, m] = el.dataset.since.split('-').map(Number); el.textContent = '· ' + dur(monthsSince(y, m)); });

/* ---------- ink palette (Beer–Lambert absorption per channel) ---------- */
const INK = { indigo: [0.95, 0.78, 0.2], turmeric: [0.04, 0.3, 1.0], madder: [0.1, 0.88, 0.78] };
const INK_HEX = { indigo: '#2e3a8c', turmeric: '#c98a12', madder: '#a92f28' };
const ON = { indigo: '#f4f6fa', madder: '#f4f6fa', turmeric: '#141a33' };
const PAPER = [0.957, 0.965, 0.98];
let ink = 'indigo', paused = false, sim = null, running = false, raf = 0;
let px = -9999, py = -9999, lastMove = 0, nextIdle = 0, lastT = 0, lastScroll = 0, scrollVel = 0, frameN = 0;
const pending = [];
const inView = { hero: true, port: false, fill: false };

/* ---------- stable-fluids solver (WebGL2, or WebGL1 with half floats) ---------- */
function createSim(canvas, onLost) {
  const opts = { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
  let gl = canvas.getContext('webgl2', opts);
  const isGL2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  if (!gl) return null;
  let type, internal, linear;
  const format = gl.RGBA;
  if (isGL2) {
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return null;
    type = gl.HALF_FLOAT; internal = gl.RGBA16F; linear = true;
  } else {
    const hf = gl.getExtension('OES_texture_half_float'); if (!hf) return null;
    linear = !!gl.getExtension('OES_texture_half_float_linear');
    type = hf.HALF_FLOAT_OES; internal = gl.RGBA;
  }
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  const VS = `precision highp float;attribute vec2 aPos;varying vec2 vUv,vL,vR,vT,vB;uniform vec2 texel;
    void main(){vUv=aPos*.5+.5;vL=vUv-vec2(texel.x,0.);vR=vUv+vec2(texel.x,0.);vT=vUv+vec2(0.,texel.y);vB=vUv-vec2(0.,texel.y);gl_Position=vec4(aPos,0.,1.);}`;
  const FS = {
    splat: `precision highp float;varying vec2 vUv;uniform sampler2D uTarget;uniform float aspect,radius;uniform vec3 color;uniform vec2 point;
      void main(){vec2 p=vUv-point;p.x*=aspect;vec3 s=exp(-dot(p,p)/radius)*color;gl_FragColor=vec4(texture2D(uTarget,vUv).xyz+s,1.);}`,
    advect: `precision highp float;varying vec2 vUv;uniform sampler2D uVel,uSrc;uniform vec2 texel,srcTexel;uniform float dt,dissipation;
      vec4 bilerp(sampler2D s,vec2 uv,vec2 ts){vec2 st=uv/ts-.5;vec2 i=floor(st);vec2 f=fract(st);
        vec4 a=texture2D(s,(i+vec2(.5,.5))*ts),b=texture2D(s,(i+vec2(1.5,.5))*ts),c=texture2D(s,(i+vec2(.5,1.5))*ts),d=texture2D(s,(i+vec2(1.5,1.5))*ts);
        return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
      void main(){
      #ifdef MANUAL
        vec2 coord=vUv-dt*bilerp(uVel,vUv,texel).xy*texel;vec4 r=bilerp(uSrc,coord,srcTexel);
      #else
        vec2 coord=vUv-dt*texture2D(uVel,vUv).xy*texel;vec4 r=texture2D(uSrc,coord);
      #endif
        gl_FragColor=r/(1.+dissipation*dt);}`,
    divergence: `precision highp float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVel;
      void main(){float L=texture2D(uVel,vL).x,R=texture2D(uVel,vR).x,T=texture2D(uVel,vT).y,B=texture2D(uVel,vB).y;vec2 C=texture2D(uVel,vUv).xy;
        if(vL.x<0.)L=-C.x;if(vR.x>1.)R=-C.x;if(vT.y>1.)T=-C.y;if(vB.y<0.)B=-C.y;gl_FragColor=vec4(.5*(R-L+T-B),0.,0.,1.);}`,
    curl: `precision highp float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVel;
      void main(){float L=texture2D(uVel,vL).y,R=texture2D(uVel,vR).y,T=texture2D(uVel,vT).x,B=texture2D(uVel,vB).x;gl_FragColor=vec4(.5*(R-L-T+B),0.,0.,1.);}`,
    vorticity: `precision highp float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVel,uCurl;uniform float curl,dt;
      void main(){float L=texture2D(uCurl,vL).x,R=texture2D(uCurl,vR).x,T=texture2D(uCurl,vT).x,B=texture2D(uCurl,vB).x,C=texture2D(uCurl,vUv).x;
        vec2 f=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));f/=length(f)+1e-4;f*=curl*C;f.y*=-1.;
        vec2 v=texture2D(uVel,vUv).xy+f*dt;gl_FragColor=vec4(clamp(v,-1000.,1000.),0.,1.);}`,
    pressure: `precision highp float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uP,uDiv;
      void main(){float L=texture2D(uP,vL).x,R=texture2D(uP,vR).x,T=texture2D(uP,vT).x,B=texture2D(uP,vB).x;gl_FragColor=vec4((L+R+B+T-texture2D(uDiv,vUv).x)*.25,0.,0.,1.);}`,
    gradient: `precision highp float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uP,uVel;
      void main(){float L=texture2D(uP,vL).x,R=texture2D(uP,vR).x,T=texture2D(uP,vT).x,B=texture2D(uP,vB).x;vec2 v=texture2D(uVel,vUv).xy-vec2(R-L,T-B);gl_FragColor=vec4(v,0.,1.);}`,
    scale: `precision highp float;varying vec2 vUv;uniform sampler2D uTex;uniform float value;void main(){gl_FragColor=value*texture2D(uTex,vUv);}`,
    display: `precision highp float;varying vec2 vUv;uniform sampler2D uTex;uniform vec3 paper;
      void main(){vec3 a=max(texture2D(uTex,vUv).rgb,0.);vec3 c=paper*exp(-a*1.35);gl_FragColor=vec4(c,1.);}`,
  };
  const compile = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const vs = compile(gl.VERTEX_SHADER, VS);
  const prog = src => {
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, src));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p, u };
  };
  const P = {};
  try { for (const k in FS) P[k] = prog(k === 'advect' && !linear ? '#define MANUAL\n' + FS[k] : FS[k]); } catch (e) { return null; }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(0);

  let pool = [];
  const fbo = (w, h) => {
    gl.activeTexture(gl.TEXTURE0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    pool.push({ tex, fb });
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo incomplete');
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, w, h, tx: 1 / w, ty: 1 / h, bind(i) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); return i; } };
  };
  const dbl = (w, h) => { let a = fbo(w, h), b = fbo(w, h); return { w, h, tx: 1 / w, ty: 1 / h, get read() { return a; }, get write() { return b; }, swap() { const t = a; a = b; b = t; } }; };
  const res = r => { const asp = Math.max(canvas.width, canvas.height) / Math.max(1, Math.min(canvas.width, canvas.height)); const lo = Math.round(r), hi = Math.round(r * asp); return canvas.width > canvas.height ? [hi, lo] : [lo, hi]; };
  const small = innerWidth < 700;
  const CFG = { sim: small ? 96 : 128, dye: small ? 384 : 640, curl: 22, pressure: .8, iters: small ? 12 : 20, velDiss: .25, dyeDiss: .75, radius: .22, force: 5200 };
  let vel, dye, div, curlF, pres;
  function alloc() {
    pool.forEach(o => { gl.deleteTexture(o.tex); gl.deleteFramebuffer(o.fb); }); pool = [];
    const [sw, sh] = res(CFG.sim), [dw, dh] = res(CFG.dye);
    vel = dbl(sw, sh); div = fbo(sw, sh); curlF = fbo(sw, sh); pres = dbl(sw, sh); dye = dbl(dw, dh);
  }
  // Canvas pixels: device pixel ratio capped at 2 and about 1.5 megapixels in total. The dye field is far
  // coarser than this, so more pixels would only cost fill rate.
  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2), cw = canvas.clientWidth || innerWidth, ch = canvas.clientHeight || innerHeight;
    const k = Math.min(1, Math.sqrt(1.5e6 / (cw * dpr * ch * dpr)));
    const w = Math.max(1, Math.round(cw * dpr * k)), h = Math.max(1, Math.round(ch * dpr * k));
    // Hysteresis: mobile URL bars resize the viewport on every scroll tick; only reallocate on a real change.
    if (vel && Math.abs(w - canvas.width) < w * .1 && Math.abs(h - canvas.height) < h * .1) return;
    canvas.width = w; canvas.height = h; alloc();
  }
  try { size(); } catch (e) { return null; }
  canvas.addEventListener('webglcontextlost', ev => { ev.preventDefault(); onLost(); });
  const use = k => { gl.useProgram(P[k].p); return P[k].u; };
  const blit = t => {
    if (t) { gl.viewport(0, 0, t.w, t.h); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); }
    else { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };
  function step(dt) {
    gl.disable(gl.BLEND);
    let u = use('curl'); gl.uniform2f(u.texel, vel.tx, vel.ty); gl.uniform1i(u.uVel, vel.read.bind(0)); blit(curlF);
    u = use('vorticity'); gl.uniform2f(u.texel, vel.tx, vel.ty); gl.uniform1i(u.uVel, vel.read.bind(0)); gl.uniform1i(u.uCurl, curlF.bind(1));
    gl.uniform1f(u.curl, CFG.curl); gl.uniform1f(u.dt, dt); blit(vel.write); vel.swap();
    u = use('divergence'); gl.uniform2f(u.texel, vel.tx, vel.ty); gl.uniform1i(u.uVel, vel.read.bind(0)); blit(div);
    u = use('scale'); gl.uniform1i(u.uTex, pres.read.bind(0)); gl.uniform1f(u.value, CFG.pressure); blit(pres.write); pres.swap();
    u = use('pressure'); gl.uniform2f(u.texel, vel.tx, vel.ty); gl.uniform1i(u.uDiv, div.bind(0));
    for (let i = 0; i < CFG.iters; i++) { gl.uniform1i(u.uP, pres.read.bind(1)); blit(pres.write); pres.swap(); }
    u = use('gradient'); gl.uniform2f(u.texel, vel.tx, vel.ty); gl.uniform1i(u.uP, pres.read.bind(0)); gl.uniform1i(u.uVel, vel.read.bind(1)); blit(vel.write); vel.swap();
    u = use('advect'); gl.uniform2f(u.texel, vel.tx, vel.ty); if (u.srcTexel) gl.uniform2f(u.srcTexel, vel.tx, vel.ty);
    const v0 = vel.read.bind(0); gl.uniform1i(u.uVel, v0); gl.uniform1i(u.uSrc, v0); gl.uniform1f(u.dt, dt); gl.uniform1f(u.dissipation, CFG.velDiss); blit(vel.write); vel.swap();
    if (u.srcTexel) gl.uniform2f(u.srcTexel, dye.tx, dye.ty);
    gl.uniform1i(u.uVel, vel.read.bind(0)); gl.uniform1i(u.uSrc, dye.read.bind(1)); gl.uniform1f(u.dissipation, CFG.dyeDiss); blit(dye.write); dye.swap();
  }
  function render() { const u = use('display'); gl.uniform1i(u.uTex, dye.read.bind(0)); gl.uniform3f(u.paper, PAPER[0], PAPER[1], PAPER[2]); blit(null); }
  function splat(x, y, dx, dy, col, r = CFG.radius) {
    const asp = canvas.width / canvas.height, u = use('splat');
    gl.uniform1i(u.uTarget, vel.read.bind(0)); gl.uniform1f(u.aspect, asp); gl.uniform2f(u.point, x, y);
    gl.uniform3f(u.color, dx, dy, 0); gl.uniform1f(u.radius, (r / 100) * (asp > 1 ? asp : 1)); blit(vel.write); vel.swap();
    gl.uniform1i(u.uTarget, dye.read.bind(0)); gl.uniform3f(u.color, col[0], col[1], col[2]); blit(dye.write); dye.swap();
  }
  function clear() {
    const u = use('scale'); gl.uniform1f(u.value, 0);
    gl.uniform1i(u.uTex, dye.read.bind(0)); blit(dye.write); dye.swap();
    gl.uniform1i(u.uTex, vel.read.bind(0)); blit(vel.write); vel.swap();
    render();
  }
  return { step, render, splat, clear, size, CFG };
}

/* ---------- ink helpers ---------- */
const inkCol = (name, k) => INK[name].map(v => v * k);
const live = () => sim && running && !paused;
function splatAt(clientX, clientY, name, k = 1, r = .5) {
  if (!live()) return;
  const x = clientX / innerWidth, y = 1 - clientY / innerHeight;
  for (let i = 0; i < 3; i++) { const a = Math.random() * Math.PI * 2; sim.splat(x, y, Math.cos(a) * 650 * k, Math.sin(a) * 650 * k, inkCol(name, .45 * k), r); }
}
const centreOf = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
function bloom(x = .5, y = .54, k = 1) {
  if (!live()) return;
  const names = ['indigo', 'indigo', ink, 'turmeric', 'madder', ink];
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.random() * .4; sim.splat(x, y, Math.cos(a) * 900 * k, Math.sin(a) * 900 * k, inkCol(names[i], .55 * k), .9); }
}
function setInk(name) {
  ink = name;
  $$('[data-ink]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ink === name)));
  root.style.setProperty('--cur', INK_HEX[name]); root.style.setProperty('--cur-on', ON[name]);
  bloom(.72, .6, .6);
}
function setPaused(p) {
  paused = p;
  $$('[data-act="pause"]').forEach(b => { b.setAttribute('aria-pressed', String(p)); b.textContent = p ? 'Resume' : 'Pause'; });
  if (!p) lastT = performance.now();
}
const setHint = t => { const s = $('#fl-hint span'); if (s) s.textContent = t; };

/* ---------- loader: once per session, skippable, never under reduced motion; a fixed overlay over real content ---------- */
const loader = $('#fl-loader');
let opened = !root.classList.contains('ld');
function runLoader() {
  try { sessionStorage.setItem('fl-seen', '1'); } catch (e) { /* storage blocked: the loader may replay, which is harmless */ }
  let done = false, timer = 0;
  const pct = $('#fl-pct'), t0 = performance.now(), maxR = Math.hypot(innerWidth, innerHeight);
  const finish = () => {
    if (done) return; done = true; clearTimeout(timer);
    loader.removeEventListener('click', finish); removeEventListener('keydown', finish);
    loader.classList.add('out');
    setTimeout(() => { root.classList.remove('ld'); loader.remove(); }, 460);
    openPage();
  };
  loader.addEventListener('click', finish); addEventListener('keydown', finish);
  const tick = () => {
    const t = performance.now() - t0, p = clamp(t / 1350, 0, 1);
    pct.textContent = Math.round(100 * (1 - Math.pow(1 - p, 3)));
    if (t > 1350) { const q = clamp((t - 1350) / 600, 0, 1); loader.style.setProperty('--hole', (maxR * q * q).toFixed(0) + 'px'); openPage(); }
    if (!done && t < 2000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  timer = setTimeout(finish, 1980);
}
let bloomed = false;
function openPage() { opened = true; if (sim && !bloomed) { bloomed = true; bloom(.5, .54, innerWidth < 700 ? .7 : 1); } }

/* ---------- generative ink covers for the work-row preview (seeded, drawn lazily on first hover) ---------- */
function coverArt(seed, names) {
  const c = document.createElement('canvas'); c.width = 600; c.height = 400;
  const g = c.getContext('2d');
  let s = seed * 9973 + 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
  g.fillStyle = '#f4f6fa'; g.fillRect(0, 0, 600, 400);
  g.globalCompositeOperation = 'multiply';
  for (let k = 0; k < 4; k++) {
    const col = INK_HEX[names[k % names.length]];
    let x = 140 + rnd() * 340, y = 70 + rnd() * 220, r = 70 + rnd() * 50, a = rnd() * 6.28;
    for (let i = 0; i < 80; i++) {
      a += (rnd() - .5) * .9; x += Math.cos(a) * 8; y += Math.sin(a) * 6; r *= .978;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgba(col, .14)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.29); g.fill();
    }
  }
  g.lineCap = 'round';
  for (let k = 0; k < 18; k++) {
    const col = INK_HEX[names[k % names.length]];
    let x = rnd() * 600, y = rnd() * 400, a = rnd() * 6.28;
    g.strokeStyle = rgba(col, .3); g.lineWidth = .5 + rnd() * 1.6; g.beginPath(); g.moveTo(x, y);
    for (let i = 0; i < 46; i++) { a += (rnd() - .5) * .55; x += Math.cos(a) * 6; y += Math.sin(a) * 6; g.lineTo(x, y); }
    g.stroke();
  }
  return c;
}

/* ---------- selected work: each row is a plain link; on hover a following card previews its ink cover ---------- */
const peek = $('#fl-peek'), covers = [];
let peekOn = false, peekX = 0, peekY = 0, peekVX = 0;
function buildWork() {
  const list = $('#fl-worklist');
  if (!FINE.matches || reduced()) return;
  list.addEventListener('pointerover', e => {
    const a = e.target.closest('.fl-wrow'); if (!a) return;
    const i = +a.dataset.i;
    if (!covers[i]) covers[i] = coverArt(i + 1, a.dataset.cv.split(' '));
    $$('canvas', peek).forEach(c => c.remove()); peek.prepend(covers[i]);
    $('b', peek).textContent = $('.mt', a).firstChild.textContent; $('small', peek).textContent = $('.mt small', a).textContent;
    if (!peekOn) { peekX = px + 28; peekY = py - 120; }
    peekOn = true; peek.classList.add('on');
  });
  list.addEventListener('pointerleave', () => { peekOn = false; peek.classList.remove('on'); });
}

/* ---------- about: portrait seen through a liquid lens ---------- */
const lens = { x: .62, y: .4, r: .2, reveal: false, hover: false, lx: 0, ly: 0 };
function drawLens(now) {
  const fig = $('#fl-portrait'), size = fig.clientWidth, t = now / 1000, rm = reduced();
  let tx, ty, tr;
  if (lens.reveal) { tx = .5; ty = .5; tr = 1.1; }
  else if (lens.hover) { tx = lens.lx; ty = lens.ly; tr = .27; }
  else { tx = .55 + (rm ? 0 : .16 * Math.sin(t * .5)); ty = .42 + (rm ? 0 : .12 * Math.cos(t * .7)); tr = .2; }
  if (rm) { lens.x = tx; lens.y = ty; lens.r = tr; } else { lens.x = lerp(lens.x, tx, .12); lens.y = lerp(lens.y, ty, .12); lens.r = lerp(lens.r, tr, .08); }
  const R = lens.r * size, ox = lens.x * size, oy = lens.y * size, w = rm ? 0 : t, col = $('#fl-col');
  const set = (i, x, y, r) => { col.style.setProperty('--x' + i, x.toFixed(1) + 'px'); col.style.setProperty('--y' + i, y.toFixed(1) + 'px'); col.style.setProperty('--r' + i, Math.max(0, r).toFixed(1) + 'px'); };
  set(1, ox, oy, R);
  set(2, ox + Math.cos(w * 1.5) * R * .5, oy + Math.sin(w * 1.5) * R * .45, R * .72);
  set(3, ox + Math.cos(-w * 1.1 + 2) * R * .55, oy + Math.sin(-w * 1.1 + 2) * R * .5, R * .62);
}
function buildPortrait() {
  const fig = $('#fl-portrait');
  fig.addEventListener('pointerenter', () => { lens.hover = true; });
  fig.addEventListener('pointerleave', () => { lens.hover = false; });
  fig.addEventListener('pointermove', e => { const r = fig.getBoundingClientRect(); lens.lx = (e.clientX - r.left) / r.width; lens.ly = (e.clientY - r.top) / r.height; }, { passive: true });
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'fl-chip'; btn.textContent = 'Clear the water';
  $('figcaption', fig).append(btn);
  const toggle = () => {
    lens.reveal = !lens.reveal; btn.textContent = lens.reveal ? 'Stir it back' : 'Clear the water';
    const [x, y] = centreOf(fig); splatAt(x, y, 'indigo', .7, .5);
    if (reduced()) drawLens(0);
  };
  fig.addEventListener('click', e => { if (e.target !== btn) toggle(); });
  btn.addEventListener('click', toggle);
  drawLens(performance.now());
}

/* ---------- career river: fills as you scroll and drops ink at each role ---------- */
let riverLen = 0; const reached = new Set();
function layoutRiver() {
  const box = $('#fl-river'), svg = $('svg', box), h = $('#fl-roles').offsetHeight; if (!h) return;
  box.classList.add('js');
  const X = y => 30 + 13 * Math.sin(y / 58);
  let d = `M${X(0).toFixed(1)} 0`; for (let y = 8; y <= h; y += 8) d += ` L${X(y).toFixed(1)} ${y}`;
  svg.setAttribute('viewBox', `0 0 64 ${h}`); svg.style.height = h + 'px';
  $('.bed', svg).setAttribute('d', d);
  const flow = $('.flow', svg); flow.setAttribute('d', d); riverLen = flow.getTotalLength(); flow.style.strokeDasharray = riverLen;
  $('.nodes', svg).innerHTML = $$('#fl-roles > li').map(li => { const y = li.offsetTop + 30; return `<circle cx="${X(y).toFixed(1)}" cy="${y}" r="7" data-y="${y}" data-id="${li.dataset.id}"/>`; }).join('');
  river();
}
function river() {
  const box = $('#fl-river'); if (!riverLen) return;
  const r = box.getBoundingClientRect(), p = reduced() ? 1 : clamp((innerHeight * .72 - r.top) / r.height, 0, 1), yy = p * r.height;
  $('.flow', box).style.strokeDashoffset = (riverLen * (1 - p)).toFixed(1);
  $$('circle', box).forEach(c => {
    const on = +c.dataset.y <= yy + 2;
    c.classList.toggle('on', on);
    if (on && !reached.has(c.dataset.id)) { reached.add(c.dataset.id); const [x, y] = centreOf(c); splatAt(x, y, 'indigo', .9, .45); }
  });
}

/* ---------- skills: droplets that merge with the skills they touch, plus a where-used panel ---------- */
const picked = new Set();
const PROJECTS = Object.fromEntries($$('.fl-wrow').map(a => [a.dataset.slug, { name: $('.nm', a).textContent, href: a.href }]));
const USES_EMPTY = '<h3>Where I used it</h3><p>Select one or more skills. The projects that use them, and anything I\'ve written about them, show up here.</p>';
function renderUses() {
  const box = $('#fl-uses');
  if (!picked.size) { box.innerHTML = USES_EMPTY; return; }
  const names = [...picked].map(b => b.textContent), count = new Map(), reads = new Map();
  picked.forEach(b => {
    b.dataset.p.split(' ').filter(Boolean).forEach(s => count.set(s, (count.get(s) || 0) + 1));
    b.dataset.w.split(';').filter(Boolean).forEach(x => { const [t, u] = x.split('|'); reads.set(u, t); });
  });
  const hits = [...count].sort((a, b) => b[1] - a[1]);
  box.innerHTML = `<h3>Where I used it</h3><div class="picked">${names.map(s => `<span>${esc(s)}</span>`).join('')}</div>` +
    (hits.length ? `<p class="sub">Projects</p><ul class="hits">${hits.map(([s, n]) => `<li><a href="${esc(PROJECTS[s].href)}">${esc(PROJECTS[s].name)}<small>${n} of ${names.length}</small></a></li>`).join('')}</ul>`
      : '<p>Not used in the four featured projects above; it is part of my wider résumé.</p>') +
    (reads.size ? `<p class="sub">Writing</p><ul class="hits">${[...reads].map(([u, t]) => `<li><a href="https://amanksingh.com${esc(u)}">${esc(t)}<small>↗</small></a></li>`).join('')}</ul>` : '') +
    '<button class="fl-chip clear" type="button" data-act="unpick">Clear selection</button>';
}
function buildSkills() {
  $$('#fl-dropgrid .fl-field').forEach(f => {
    const drop = f.closest('.fl-drop'), spans = $$('.sk', f);
    const goo = document.createElement('div'); goo.className = 'goo'; goo.setAttribute('aria-hidden', 'true');
    goo.innerHTML = spans.map(s => `<span>${esc(s.textContent)}</span>`).join('') + '<i class="blob"></i>';
    f.prepend(goo); f.classList.add('js');
    const ghosts = $$('span', goo), btns = spans.map((s, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sk'; b.textContent = s.textContent;
      b.setAttribute('aria-pressed', 'false'); b.dataset.p = s.dataset.p || ''; b.dataset.w = s.dataset.w || ''; b.dataset.cursor = 'Drop';
      s.replaceWith(b); b._ghost = ghosts[i]; return b;
    });
    let items = [];
    const enter = () => { const fr = f.getBoundingClientRect(); items = btns.map(b => { const r = b.getBoundingClientRect(); return [b, r.left - fr.left + r.width / 2, r.top - fr.top + r.height / 2]; }); f.classList.add('live'); };
    f.addEventListener('pointerenter', enter);
    f.addEventListener('pointermove', e => {
      if (!items.length) enter();
      const r = f.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      f.style.setProperty('--x', (x - 27) + 'px'); f.style.setProperty('--y', (y - 27) + 'px');
      items.forEach(([b, cx, cy]) => b.classList.toggle('near', Math.abs(cx - x) < 60 && Math.abs(cy - y) < 30));
    }, { passive: true });
    f.addEventListener('pointerleave', () => { f.classList.remove('live'); items.forEach(([b]) => b.classList.remove('near')); items = []; });
    f.addEventListener('click', e => {
      const b = e.target.closest('button.sk'); if (!b) return;
      const on = !picked.has(b);
      if (on) picked.add(b); else picked.delete(b);
      b.setAttribute('aria-pressed', String(on)); b._ghost.classList.toggle('sel', on);
      if (on) { const [x, y] = centreOf(b); splatAt(x, y, [...drop.classList].find(c => c.startsWith('ink-')).slice(4), 1, .4); }
      renderUses();
    });
  });
  $('#fl-uses').addEventListener('click', e => {
    if (!e.target.closest('[data-act="unpick"]')) return;
    picked.forEach(b => { b.setAttribute('aria-pressed', 'false'); b._ghost.classList.remove('sel'); }); picked.clear(); renderUses();
  });
}

/* ---------- series vials: surfaces lean toward the pointer ---------- */
function buildVials() {
  const box = $('#fl-vials'), waves = $$('.liq svg', box); let queued = false, lx = 0;
  box.addEventListener('pointermove', e => {
    lx = e.clientX; if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; waves.forEach(w => { const r = w.getBoundingClientRect(); w.style.setProperty('--tilt', (clamp((lx - (r.left + r.width / 2)) / 260, -1, 1) * -5).toFixed(2) + 'deg'); }); });
  }, { passive: true });
}

/* ---------- dock with a gooey active pill, scroll-spy, and show-after-hero ---------- */
let dockShown = false, heroH = 600;
function buildDock() {
  const links = $$('#fl-dock-links a'), box = $('#fl-dock-links'), goo = $('.fl-dock-goo'), pills = $$('.fl-dock-goo i'), dock = $('#fl-dock');
  let active = null;
  const go = a => {
    active = a; links.forEach(l => l.classList.toggle('on', l === a));
    goo.classList.toggle('on', !!a); if (!a) return;
    const br = box.getBoundingClientRect(), r = a.getBoundingClientRect();
    pills.forEach(p => { p.style.width = r.width + 'px'; p.style.transform = `translateX(${r.left - br.left}px)`; });
  };
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) go(links.find(l => l.getAttribute('href') === '#' + e.target.id) || null);
    else if (active && active.getAttribute('href') === '#' + e.target.id && e.boundingClientRect.top > 0 && e.target.id === 'work') go(null);
  }), { rootMargin: '-42% 0px -52% 0px' });
  links.forEach(l => io.observe($(l.getAttribute('href'))));
  new ResizeObserver(() => go(active)).observe(box);
  const hero = $('.fl-hero');
  new ResizeObserver(() => { heroH = hero.offsetHeight || heroH; }).observe(hero);
  const onScroll = () => { const show = scrollY > heroH * .55; if (show !== dockShown) { dockShown = show; dock.classList.toggle('show', show); } };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
}

/* ---------- per-frame UI: cursor, preview card, kinetic name, badge ring, lens, contact fill ---------- */
const cursor = { el: null, label: '' }, ringG = $('#fl-ring-g');
let cx = -9999, cy = -9999, chars = [], centers = [], centersAt = 0, ringA = 0, fillSpans = [];
function kinetic(now) {
  if (now - centersAt > 400) { centers = chars.map(c => centreOf(c.el)); centersAt = now; }
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], [x, y] = centers[i] || [0, 0];
    const f = Math.pow(clamp(1 - Math.hypot(px - x, py - y) / 260, 0, 1), 2);
    c.w = lerp(c.w, 780 - 560 * f, .16); c.d = lerp(c.d, 92 + 8 * f, .16); c.f = lerp(c.f, f, .16);
    if (Math.abs(c.w - c.lw) > .8) { const s = c.el.style; s.setProperty('--w', c.w.toFixed(0)); s.setProperty('--d', c.d.toFixed(1)); s.setProperty('--f', c.f.toFixed(3)); c.lw = c.w; }
  }
}
function fill(now) {
  const box = fillSpans[0].parentElement.getBoundingClientRect();
  const p = clamp((innerHeight - box.top) / (box.height + innerHeight * .45), 0, 1);
  fillSpans.forEach((s, i) => { const f = clamp(p * 1.5 - i * .2, 0, 1); s.style.setProperty('--lvl', (s.offsetHeight * (1 - f) + 4).toFixed(1) + 'px'); s.style.setProperty('--wx', ((now * .06 + i * 70) % 220).toFixed(1) + 'px'); });
}
function ui(now, dt) {
  if (cursor.el && px > -999) {
    cx = lerp(cx < -999 ? px : cx, px, .24); cy = lerp(cy < -999 ? py : cy, py, .24);
    cursor.el.style.transform = `translate3d(${cx.toFixed(1)}px,${cy.toFixed(1)}px,0)`;
  }
  if (peekOn) {
    const ox = peekX; peekX = lerp(peekX, px + 28, .16); peekY = lerp(peekY, py - 120, .16); peekVX = lerp(peekVX, peekX - ox, .2);
    peek.style.transform = `translate(${peekX.toFixed(1)}px,${peekY.toFixed(1)}px) rotate(${clamp(peekVX * .5, -10, 10).toFixed(2)}deg)`;
  }
  if (inView.hero) {
    ringA = (ringA + dt * (.012 + Math.min(.25, Math.abs(scrollVel) * .004))) % 360; ringG.setAttribute('transform', `rotate(${ringA.toFixed(2)} 100 100)`);
    kinetic(now);
  }
  if (inView.port) drawLens(now);
  if (inView.fill) fill(now);
}

/* ---------- main loop ---------- */
let guardSum = 0, guardN = 0;
function guard(raw) { // too slow for live water? first cut the pressure solver, then fall back to the still wash
  if (++guardN <= 30) return;
  guardSum += raw;
  if (guardN < 90) return;
  const avg = guardSum / 60; guardSum = 0; guardN = 30;
  if (avg <= 42) return;
  if (sim.CFG.iters > 8) sim.CFG.iters = 8; else simOff('The live water was switched off because this device is too slow for it; a still ink wash stays.');
}
function frame(now) {
  const raw = now - lastT, dt = Math.min(50, raw); lastT = now;
  const sy = scrollY, v = sy - lastScroll; lastScroll = sy; scrollVel = lerp(scrollVel, v, .25);
  if (sim && !paused) {
    sim.size();
    while (pending.length) {
      const [x, y, dx0, dy0] = pending.shift(); let dx = dx0, dy = dy0; const asp = innerWidth / innerHeight;
      if (asp < 1) dx *= asp; else dy /= asp;
      sim.splat(x, y, dx * sim.CFG.force, dy * sim.CFG.force, inkCol(ink, .14));
    }
    if (Math.abs(v) > 2 && (frameN++ & 1)) { // scrolling makes waves at the edges
      const side = frameN & 2 ? .03 : .97;
      sim.splat(side, .2 + Math.random() * .6, (side < .5 ? 1 : -1) * Math.abs(v) * 6, clamp(v, -60, 60) * 9, inkCol(ink, .06), .35);
    }
    if (opened && now - lastMove > 3000 && now > nextIdle) { // an idle drop now and then
      const names = Object.keys(INK), a = Math.random() * Math.PI * 2;
      sim.splat(.15 + Math.random() * .7, .2 + Math.random() * .6, Math.cos(a) * 1400, Math.sin(a) * 1400, inkCol(names[(Math.random() * 3) | 0], .32), .6);
      nextIdle = now + 3200 + Math.random() * 2000;
    }
    sim.step(Math.min(.016666, dt / 1000)); sim.render();
    guard(raw);
  }
  ui(now, dt);
  if (running) raf = requestAnimationFrame(frame);
}
function startLoop() { if (running || reduced()) return; running = true; lastT = performance.now(); lastScroll = scrollY; raf = requestAnimationFrame(frame); }
function stopLoop() { running = false; cancelAnimationFrame(raf); }
document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else startLoop(); }); // paused while the tab is hidden

/* ---------- input ---------- */
let last = null, magRaf = 0;
function onMove(e) {
  px = e.clientX; py = e.clientY;
  if (cursor.el && e.pointerType === 'mouse') cursor.el.classList.add('on');
  if (!magRaf && FINE.matches && !reduced()) magRaf = requestAnimationFrame(() => { magRaf = 0; magnets(); });
  if (!live()) return;
  const x = e.clientX / innerWidth, y = 1 - e.clientY / innerHeight;
  if (last) { const dx = x - last.x, dy = y - last.y; if (Math.abs(dx) + Math.abs(dy) > 1e-5) pending.push([x, y, dx, dy]); }
  last = { x, y }; lastMove = performance.now();
  if (pending.length > 30) pending.splice(0, pending.length - 30);
}
function magnets() {
  $$('.mag').forEach(b => {
    const r = b.getBoundingClientRect(), dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2), d = Math.hypot(dx, dy), k = d < 110 ? 1 - d / 110 : 0;
    b.style.transform = k ? `translate(${dx * .28 * k}px,${dy * .38 * k}px)` : '';
    b.firstElementChild.style.transform = k ? `translate(${dx * .12 * k}px,${dy * .14 * k}px)` : '';
  });
}
function onDown(e) {
  if (!live() || e.target.closest('a,button,summary,input')) return;
  const x = e.clientX / innerWidth, y = 1 - e.clientY / innerHeight;
  for (let i = 0; i < 3; i++) { const a = Math.random() * Math.PI * 2; sim.splat(x, y, Math.cos(a) * 700, Math.sin(a) * 700, inkCol(ink, .5), .45); }
}
function onOver(e) {
  const t = e.target.closest('[data-cursor]'), label = t ? t.dataset.cursor : '';
  if (label === cursor.label) return;
  cursor.label = label; cursor.el.classList.toggle('big', !!label);
  if (label) cursor.el.firstElementChild.textContent = label;
}

/* ---------- boot ---------- */
function simOff(msg) {
  sim = null; root.classList.remove('fl-live'); $$('[data-act]').forEach(b => { b.hidden = true; });
  if (msg) setHint(msg);
}
function bootSim() {
  if (reduced()) { simOff('Reduced motion is on, so a still ink wash replaces the live water.'); return; }
  try { sim = createSim($('#fl-canvas'), () => simOff()); } catch (err) { sim = null; }
  if (!sim) { simOff('WebGL is unavailable here, so a still ink wash replaces the live water.'); return; }
  root.classList.add('fl-live');
  setHint('Move to stir · click to drop ink · scroll to make waves');
  nextIdle = performance.now() + 1500;
  if (opened) { bloomed = true; bloom(); }
}
function init() {
  // Controls and cursor only make sense with JavaScript, so they are hidden in the HTML until now.
  $$('[data-tools]').forEach(el => { el.hidden = false; });
  document.addEventListener('click', e => {
    const ib = e.target.closest('[data-ink]'); if (ib) { setInk(ib.dataset.ink); return; }
    const ab = e.target.closest('[data-act]'); if (!ab) return;
    if (ab.dataset.act === 'clear' && sim) sim.clear();
    if (ab.dataset.act === 'pause') setPaused(!paused);
  });
  buildDock(); buildWork(); buildPortrait(); buildSkills(); buildVials(); renderUses();
  chars = $$('#fl-letters .ch').map(el => ({ el, w: 780, d: 92, f: 0, lw: 0 }));
  fillSpans = $$('#fl-fill span');
  if (!reduced()) fill(0); // start the contact headline empty; it fills as it scrolls in
  new ResizeObserver(layoutRiver).observe($('#fl-roles'));
  let rq = false;
  addEventListener('scroll', () => { if (!rq) { rq = true; requestAnimationFrame(() => { rq = false; river(); }); } }, { passive: true });
  // Offscreen sections stop their CSS animations; the per-frame work is gated by the same observers.
  const flag = { top: 'hero', 'fl-portrait': 'port', 'fl-fill': 'fill' };
  const io = new IntersectionObserver(es => es.forEach(e => {
    e.target.classList.toggle('off', !e.isIntersecting);
    if (flag[e.target.id]) inView[flag[e.target.id]] = e.isIntersecting;
  }));
  [$('#top'), $('#fl-portrait'), $('#fl-fill'), ...$$('[data-io]')].forEach(el => io.observe(el));
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerdown', onDown, { passive: true });
  if (FINE.matches && !reduced()) {
    cursor.el = $('#fl-cursor');
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', e => { if (!e.relatedTarget) cursor.el.classList.remove('on'); });
  }
  root.style.setProperty('--cur', INK_HEX[ink]);
  if (!reduced()) { if (root.classList.contains('ld')) runLoader(); startLoop(); }
  RM.addEventListener('change', () => location.reload());
  // The page is complete and fast with the still wash alone. The WebGL water starts on the first pointer, scroll,
  // touch or key event, so visitors who never engage never pay for it.
  if (reduced()) { bootSim(); return; }
  const wakes = ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'];
  const wake = () => { wakes.forEach(t => removeEventListener(t, wake)); (window.requestIdleCallback || (f => setTimeout(f, 50)))(bootSim, { timeout: 600 }); };
  wakes.forEach(t => addEventListener(t, wake, { passive: true }));
  setHint('Move, scroll or tap to wake the ink.');
}
init();
})();


/* EnT Photo Editor v1.0.0 */
const APP_VERSION = '1.0.0';
const $ = (sel) => document.querySelector(sel);

const toastEl = document.createElement('div');
toastEl.className = 'toast';
document.body.appendChild(toastEl);
function toast(msg, ms=1800){ toastEl.textContent = msg; toastEl.style.display='block'; setTimeout(()=>toastEl.style.display='none', ms); }

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
}

async function loadHeicLib() {
  if (window.heic2any) return true;
  const tryLoad = (src) => new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = () => resolve(true); s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  let ok = await tryLoad('https://cdn.jsdelivr.net/npm/heic2any/dist/heic2any.min.js');
  if (!ok) ok = await tryLoad('./heic2any.js');
  return ok;
}

function isHeic(file) {
  const name=(file.name||'').toLowerCase();
  const type=(file.type||'').toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif') || type.includes('heic') || type.includes('heif');
}

async function convertHeic(file, to='image/jpeg', quality=0.95) {
  const ok = await loadHeicLib();
  if (!ok || !window.heic2any) throw new Error('HEIC converter not available');
  const out = await window.heic2any({ blob:file, toType:to, quality });
  const blob = Array.isArray(out) ? out[0] : out;
  return new File([blob], to.includes('png')?'converted.png':'converted.jpg', { type: to });
}

function fileToDataURL(file) {
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload = e=> resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function loadImageURL(url) {
  return new Promise((resolve,reject)=>{
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
}

function sizeForViewport(nw, nh) {
  const maxW = Math.min(980, Math.floor(window.innerWidth*0.98));
  const maxH = Math.floor(window.innerHeight*0.58);
  const s = Math.min(maxW/nw, maxH/nh, 1);
  return { w: Math.max(1, Math.floor(nw*s)), h: Math.max(1, Math.floor(nh*s)) };
}

const canvas = document.createElement('canvas');
canvas.id = 'canvas';
const visibleCanvas = document.getElementById('canvas');
const ctx = visibleCanvas.getContext('2d');
const glStage = document.getElementById('glStage');
const gl = glStage.getContext('webgl') || glStage.getContext('experimental-webgl');
const WEBGL_OK = !!gl;
let glProgram=null, glBuffer=null, glTex=null, uRes,uImg,uExposure,uGamma,uTemp,uBright,uContrast,uSaturation,uGray,uSepia,uInvert;

function createShader(gl,t,src){ const sh=gl.createShader(t); gl.shaderSource(sh,src); gl.compileShader(sh); if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(sh)); return null;} return sh; }
function initGL(){
  if (!WEBGL_OK) return;
  const vertSrc = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv=(aPos+1.0)*0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fragSrc = `precision mediump float; varying vec2 vUv; uniform sampler2D uImg; uniform vec2 uRes;
    uniform float uExposure,uGamma,uTemp,uBright,uContrast,uSaturation,uGray,uSepia,uInvert;
    vec3 applyExposure(vec3 c,float s){return c*pow(2.0,s);}
    vec3 applyGamma(vec3 c,float g){return pow(c,vec3(1.0/g));}
    vec3 applyTemperature(vec3 c,float t){float rShift=mix(-0.2,0.8,(t+1.0)/2.0); float bShift=mix(0.8,-0.2,(t+1.0)/2.0);
      return vec3(clamp(c.r + rShift*0.05,0.0,1.0), c.g, clamp(c.b + bShift*0.05,0.0,1.0));}
    vec3 applyBrightnessContrast(vec3 c,float b,float ct){c*=b; float tt=0.5*(1.0-ct); return c*ct+tt;}
    vec3 applySaturation(vec3 c,float s){float l=dot(c,vec3(0.2126,0.7152,0.0722)); return mix(vec3(l),c,s);}
    vec3 applyGrayscale(vec3 c,float a){float l=dot(c,vec3(0.299,0.587,0.114)); return mix(c,vec3(l),a);}
    vec3 applySepia(vec3 c,float a){vec3 s=vec3(dot(c,vec3(0.393,0.769,0.189)), dot(c,vec3(0.349,0.686,0.168)), dot(c,vec3(0.272,0.534,0.131))); return mix(c,s,a);}
    vec3 applyInvert(vec3 c,float a){return mix(c,1.0-c,a);}
    void main(){ vec4 tex=texture2D(uImg,vUv); vec3 c=tex.rgb;
      c=applyExposure(c,uExposure); c=applyGamma(c,uGamma); c=applyTemperature(c,uTemp);
      c=applyBrightnessContrast(c,uBright,uContrast); c=applySaturation(c,uSaturation);
      c=applyGrayscale(c,uGray); c=applySepia(c,uSepia); c=applyInvert(c,uInvert);
      gl_FragColor=vec4(clamp(c,0.0,1.0), tex.a); }`;
  const vs=createShader(gl,gl.VERTEX_SHADER,vertSrc); const fs=createShader(gl,gl.FRAGMENT_SHADER,fragSrc);
  const prog=gl.createProgram(); gl.attachShader(prog,vs); gl.attachShader(prog,fs); gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(prog)); return;}
  gl.useProgram(prog); const posLoc=gl.getAttribLocation(prog,'aPos'); glBuffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc,2,gl.FLOAT,false,0,0);
  uRes=gl.getUniformLocation(prog,'uRes'); uImg=gl.getUniformLocation(prog,'uImg');
  uExposure=gl.getUniformLocation(prog,'uExposure'); uGamma=gl.getUniformLocation(prog,'uGamma'); uTemp=gl.getUniformLocation(prog,'uTemp');
  uBright=gl.getUniformLocation(prog,'uBright'); uContrast=gl.getUniformLocation(prog,'uContrast'); uSaturation=gl.getUniformLocation(prog,'uSaturation');
  uGray=gl.getUniformLocation(prog,'uGray'); uSepia=gl.getUniformLocation(prog,'uSepia'); uInvert=gl.getUniformLocation(prog,'uInvert');
  glProgram=prog;
}
initGL();

function ensureTexture(image){
  if(!WEBGL_OK) return;
  if(!glTex) glTex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, glTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
}

function renderWebGLToStage(image, outW, outH){
  if(!WEBGL_OK) return null;
  glStage.width=outW; glStage.height=outH; gl.viewport(0,0,outW,outH);
  gl.useProgram(glProgram); gl.uniform2f(uRes,outW,outH); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, glTex); gl.uniform1i(uImg,0);
  const exposureStops = state.fx.exposure/50.0; const gamma = state.fx.tone>=0 ? (1.0+state.fx.tone/100.0) : (1.0/(1.0 - state.fx.tone/100.0));
  gl.uniform1f(uExposure, exposureStops); gl.uniform1f(uGamma, gamma); gl.uniform1f(uTemp, state.fx.temp/100.0);
  gl.uniform1f(uBright, state.fx.brightness/100.0); gl.uniform1f(uContrast, state.fx.contrast/100.0); gl.uniform1f(uSaturation, state.fx.saturation/100.0);
  gl.uniform1f(uGray, state.fx.gray/100.0); gl.uniform1f(uSepia, state.fx.sepia/100.0); gl.uniform1f(uInvert, state.fx.invert/100.0);
  gl.drawArrays(gl.TRIANGLES,0,6); return glStage;
}

const state = {
  img: null,
  caption: { text:'', x:120, y:120, size:44, color:'#ffffff', font:'Arial', dragging:false },
  fx: { temp:0, tone:0, exposure:0, brightness:100, contrast:100, saturation:100, blur:0, gray:0, sepia:0, invert:0 },
  border: { color:'#ffffff', size:20, pos:'all' },
  version: APP_VERSION
};

const els = {
  singleUpload: document.getElementById('singleUpload'),
  toggleBorder:  document.getElementById('toggleBorder'),
  toggleCaption: document.getElementById('toggleCaption'),
  toggleEffects: document.getElementById('toggleEffects'),
  borderPanel:   document.getElementById('borderPanel'),
  captionPanel:  document.getElementById('captionPanel'),
  effectsPanel:  document.getElementById('effectsPanel'),
  borderColor:   document.getElementById('borderColor'),
  borderSize:    document.getElementById('borderSize'),
  borderPos:     document.getElementById('borderPos'),
  captionText:   document.getElementById('captionText'),
  captionSize:   document.getElementById('captionSize'),
  captionColor:  document.getElementById('captionColor'),
  captionFont:   document.getElementById('captionFont'),
  fxTemp:        document.getElementById('fxTemp'),
  fxTone:        document.getElementById('fxTone'),
  fxExposure:    document.getElementById('fxExposure'),
  fxBrightness:  document.getElementById('fxBrightness'),
  fxContrast:    document.getElementById('fxContrast'),
  fxSaturation:  document.getElementById('fxSaturation'),
  fxBlur:        document.getElementById('fxBlur'),
  fxGray:        document.getElementById('fxGray'),
  fxSepia:       document.getElementById('fxSepia'),
  fxInvert:      document.getElementById('fxInvert'),
  effectsReset:  document.getElementById('effectsReset'),
  singleShare:   document.getElementById('singleShare'),
  singleDownload:document.getElementById('singleDownload'),
  emojiBtn:      document.getElementById('toggleEmojiPicker'),
  emojiPicker:   document.getElementById('emojiPicker'),
  btnSingle:     document.getElementById('btnSingle'),
  btnCollage:    document.getElementById('btnCollage'),
  modalMask:     document.getElementById('modalMask'),
  heicError:     document.getElementById('heicError'),
  toPNG:         document.getElementById('toPNG'),
  toJPG:         document.getElementById('toJPG'),
  cancelHeic:    document.getElementById('cancelHeic'),
};

function showSingle(){
  document.getElementById('singleControls').style.display='block';
  document.getElementById('collageControls').style.display='none';
}
function showCollage(){
  document.getElementById('singleControls').style.display='none';
  document.getElementById('collageControls').style.display='block';
}
els.btnSingle.addEventListener('click', showSingle);
els.btnCollage.addEventListener('click', showCollage);
showSingle();

// Emoji picker
els.emojiBtn.addEventListener('click', () => {
  const isOpen = els.emojiPicker.style.display !== 'none';
  els.emojiPicker.style.display = isOpen ? 'none' : 'grid';
});
els.emojiPicker.addEventListener('click', (e) => {
  if (e.target.classList.contains('btn')) {
    state.caption.text += e.target.textContent;
    els.captionText.value = state.caption.text;
    draw();
  }
});

// Build emojis
(function buildEmojis(){
  const EMOJIS = "😀 😃 😄 😁 😆 😂 😊 😉 🥰 😍 😘 😜 🤩 🤗 🤔 😎 😴 😇 😢 😭 😤 😱 🤯 😅 🙃 🙂 🤌 👍 👎 👋 🙌 💪 ✌️ 🫶 ❤️ 🧡 💛 💚 💙 💜 🤍 🖤 🎉 🎂 🎈 🔥 ✨ ⭐ 🌟 💡 📸 🖼️ 📍".split(' ');
  els.emojiPicker.innerHTML = EMOJIS.map(e => `<button class="btn" style="padding:8px 0;font-size:22px">${e}</button>`).join('');
})();

// HEIC modal
let pendingHeicFile = null;
function openModal(){ els.modalMask.style.display='flex'; els.modalMask.setAttribute('aria-hidden','false'); }
function closeModal(){ els.modalMask.style.display='none'; els.modalMask.setAttribute('aria-hidden','true'); els.heicError.style.display='none'; els.heicError.textContent=''; }
els.cancelHeic.addEventListener('click', ()=>{ pendingHeicFile=null; closeModal(); });

// Upload
els.singleUpload.addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if (!f) return;
  if (isHeic(f)) { pendingHeicFile=f; openModal(); return; }
  await loadRegularFile(f);
});

async function loadRegularFile(file) {
  const maxSide = 4096;
  const dataUrl = await fileToDataURL(file);
  const img = await loadImageURL(dataUrl);
  const scale = Math.min(1, maxSide/Math.max(img.naturalWidth, img.naturalHeight));
  let finalImg = img;
  if (scale < 1) {
    const tmp = document.createElement('canvas'); const tctx=tmp.getContext('2d');
    tmp.width = Math.floor(img.naturalWidth*scale); tmp.height = Math.floor(img.naturalHeight*scale);
    tctx.drawImage(img,0,0,tmp.width,tmp.height);
    const downUrl = tmp.toDataURL('image/jpeg', 0.95);
    finalImg = await loadImageURL(downUrl);
  }
  state.img = finalImg;
  enableEditing();
  draw();
}

// Modal actions
els.toJPG.addEventListener('click', async ()=>{
  if (!pendingHeicFile) return;
  try{
    const f = await convertHeic(pendingHeicFile, 'image/jpeg', 0.95);
    await loadRegularFile(f);
    closeModal(); toast('Converted HEIC → JPG');
  }catch(e){
    els.heicError.style.display='block';
    els.heicError.textContent = e?.message || 'Conversion failed.';
  }
});
els.toPNG.addEventListener('click', async ()=>{
  if (!pendingHeicFile) return;
  try{
    const f = await convertHeic(pendingHeicFile, 'image/png', 1.0);
    await loadRegularFile(f);
    closeModal(); toast('Converted HEIC → PNG');
  }catch(e){
    els.heicError.style.display='block';
    els.heicError.textContent = e?.message || 'Conversion failed.';
  }
});

function enableEditing(){
  ['toggleBorder','toggleCaption','toggleEffects','singleShare','singleDownload'].forEach(id=> document.getElementById(id)?.removeAttribute('disabled'));
}

els.toggleBorder.addEventListener('click', ()=>{ const p=document.getElementById('borderPanel'); p.style.display = p.style.display==='none'?'block':'none'; });
els.toggleCaption.addEventListener('click', ()=>{ const p=document.getElementById('captionPanel'); p.style.display = p.style.display==='none'?'block':'none'; });
els.toggleEffects.addEventListener('click', ()=>{ const p=document.getElementById('effectsPanel'); p.style.display = p.style.display==='none'?'block':'none'; });

document.getElementById('borderColor').addEventListener('input', e=>{ state.border.color = e.target.value; draw(); });
document.getElementById('borderSize').addEventListener('input', e=>{ state.border.size = +e.target.value; draw(); });
document.getElementById('borderPos').addEventListener('change', e=>{ state.border.pos = e.target.value; draw(); });

document.getElementById('captionText').addEventListener('input', e=>{ state.caption.text = e.target.value; draw(); });
document.getElementById('captionSize').addEventListener('input', e=>{ state.caption.size = +e.target.value; draw(); });
document.getElementById('captionColor').addEventListener('input', e=>{ state.caption.color = e.target.value; draw(); });
document.getElementById('captionFont').addEventListener('change', e=>{ state.caption.font = e.target.value; draw(); });

let dragging=false, dragOffset={x:0,y:0};
const visible = document.getElementById('canvas');
visible.addEventListener('pointerdown', (e)=>{
  if (!state.img) return;
  const rect = visible.getBoundingClientRect();
  const x = e.clientX - rect.left; const y = e.clientY - rect.top;
  const m = visible.getContext('2d'); m.font = `${state.caption.size}px ${state.caption.font}`;
  const tw = m.measureText(state.caption.text||' ').width; const th = state.caption.size;
  if (x>=state.caption.x && x<=state.caption.x+tw && y<=state.caption.y && y>=state.caption.y-th) {
    dragging=true; dragOffset.x=x-state.caption.x; dragOffset.y=y-state.caption.y;
  }
});
window.addEventListener('pointermove', (e)=>{
  if (!dragging) return;
  const rect = visible.getBoundingClientRect();
  const x = e.clientX - rect.left; const y = e.clientY - rect.top;
  state.caption.x = x - dragOffset.x; state.caption.y = y - dragOffset.y;
  draw();
});
window.addEventListener('pointerup', ()=> dragging=false);

function hookSlider(id, key){
  document.getElementById(id).addEventListener('input', e=>{ state.fx[key] = +e.target.value; draw(); });
}
hookSlider('fxTemp','temp');
hookSlider('fxTone','tone');
hookSlider('fxExposure','exposure');
hookSlider('fxBrightness','brightness');
hookSlider('fxContrast','contrast');
hookSlider('fxSaturation','saturation');
hookSlider('fxBlur','blur');
hookSlider('fxGray','gray');
hookSlider('fxSepia','sepia');
hookSlider('fxInvert','invert');

document.getElementById('effectsReset').addEventListener('click', ()=>{
  Object.assign(state.fx, { temp:0,tone:0,exposure:0,brightness:100,contrast:100,saturation:100,blur:0,gray:0,sepia:0,invert:0 });
  ['fxTemp','fxTone','fxExposure','fxBrightness','fxContrast','fxSaturation','fxBlur','fxGray','fxSepia','fxInvert'].forEach(id=>{
    const elt=document.getElementById(id);
    elt.value = elt.getAttribute('value') || elt.defaultValue || (id.includes('Brightness')||id.includes('Contrast')||id.includes('Saturation')?'100':'0');
  });
  draw();
});

document.getElementById('singleDownload').addEventListener('click', ()=> saveImage());
document.getElementById('singleShare').addEventListener('click', async ()=>{
  const blob = await canvasToBlob();
  if (navigator.canShare && navigator.canShare({ files: [new File([blob],'ent-photo.jpg',{type:'image/jpeg'})] })) {
    await navigator.share({
      files: [new File([blob], 'ent-photo.jpg', {type:'image/jpeg'})],
      title: 'EnT Photo Editor',
      text: 'Edited with EnT Photo Editor'
    }).catch(()=>{});
  } else {
    saveImage();
  }
});

function saveImage(){
  const c=document.getElementById('canvas');
  c.toBlob((blob)=>{
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='ent-photo.jpg'; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }, 'image/jpeg', 0.92);
}
function canvasToBlob(){ return new Promise(resolve=> document.getElementById('canvas').toBlob(resolve,'image/jpeg',0.9)); }

function draw(){
  const c = document.getElementById('canvas'); const x = c.getContext('2d'); x.clearRect(0,0,c.width,c.height);
  if (!state.img) return;
  const baseW = state.img.naturalWidth, baseH = state.img.naturalHeight;
  const sized = sizeForViewport(baseW, baseH);

  const bs = state.border.size;
  let pad = {l:0,t:0,r:0,b:0};
  if (state.border.pos === 'all') pad = {l:bs,t:bs,r:bs,b:bs};
  else if (state.border.pos === 'topBottom') pad = {l:0,t:bs,r:0,b:bs};
  else if (state.border.pos === 'leftRight') pad = {l:bs,t:0,r:bs,b:0};

  c.width  = sized.w + pad.l + pad.r;
  c.height = sized.h + pad.t + pad.b;

  if (bs>0) { x.fillStyle = state.border.color; x.fillRect(0,0,c.width,c.height); }

  if (WEBGL_OK) {
    ensureTexture(state.img);
    const stage = renderWebGLToStage(state.img, sized.w, sized.h);
    x.drawImage(stage, 0,0, stage.width, stage.height, pad.l, pad.t, sized.w, sized.h);
  } else {
    x.drawImage(state.img, 0,0, baseW, baseH, pad.l, pad.t, sized.w, sized.h);
  }

  if (state.fx.blur>0) {
    const t = document.createElement('canvas'); const tc=t.getContext('2d');
    t.width = Math.max(1, Math.floor(c.width * (1- state.fx.blur/20)));
    t.height= Math.max(1, Math.floor(c.height* (1- state.fx.blur/20)));
    tc.drawImage(c,0,0,c.width,c.height, 0,0,t.width,t.height);
    x.clearRect(0,0,c.width,c.height);
    x.imageSmoothingEnabled = true;
    x.drawImage(t,0,0,t.width,t.height, 0,0,c.width,c.height);
  }

  if (state.caption.text) {
    x.font = `${state.caption.size}px ${state.caption.font}`;
    x.fillStyle = state.caption.color;
    x.textBaseline = 'alphabetic';
    x.fillText(state.caption.text, state.caption.x, state.caption.y);
  }
}

(function whatsNew(){
  try {
    const key='ent-photo-editor-version';
    const stored = localStorage.getItem(key);
    if (stored !== APP_VERSION) {
      localStorage.setItem(key, APP_VERSION);
      toast('Welcome to EnT Photo Editor v'+APP_VERSION);
    }
  }catch(e){}
})();

window.addEventListener('resize', draw);

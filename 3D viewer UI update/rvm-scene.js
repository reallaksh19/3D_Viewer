/**
 * rvm-scene.js — Three.js plant/equipment demo for RVM Viewer
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ── DOM ──────────────────────────────────────────────────── */
const vp     = document.getElementById('rvm-viewport');
const canvas = document.getElementById('rvm-canvas');
const vc     = document.getElementById('vc');
const ctx    = document.getElementById('rvm-ctx');
const secPnl = document.getElementById('sec-panel');
const kbdHlp = document.getElementById('rvm-kbd');
const tagMod = document.getElementById('tag-modal');

/* ── State ────────────────────────────────────────────────── */
const S = { mode:'orbit', selected:null, hovered:null, _fc:0, _ft:0 };

/* ── Renderer ─────────────────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08111c);

const camera = new THREE.PerspectiveCamera(45,1,.1,400);
camera.position.set(14,10,18);

/* ── Lights ───────────────────────────────────────────────── */
scene.add(new THREE.AmbientLight(0x445566,.55));
const sun = new THREE.DirectionalLight(0xffffff,1.2);
sun.position.set(12,18,14); sun.castShadow=true;
sun.shadow.mapSize.setScalar(1024);
['left','right','top','bottom'].forEach(k=>sun.shadow.camera[k]=k==='top'||k==='right'?18:-18);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x22446a,0x111e2a,.45));

/* ── Controls ─────────────────────────────────────────────── */
const ctrl = new OrbitControls(camera, renderer.domElement);
ctrl.target.set(0,2,0); ctrl.enableDamping=true; ctrl.dampingFactor=.08;
ctrl.minDistance=2; ctrl.maxDistance=80;
ctrl.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
ctrl.update();

/* ── Materials ────────────────────────────────────────────── */
const steel  = (c=0x7a8898,r=.35,m=.6)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:m});
const M_HOV  = steel(0x5090c8,.2,.5);
M_HOV.emissive=new THREE.Color(0x0a2038); M_HOV.emissiveIntensity=.5;
const M_SEL  = steel(0x2060f0,.2,.5);
M_SEL.emissive=new THREE.Color(0x0a1550); M_SEL.emissiveIntensity=.7;

/* ── Scene objects list ───────────────────────────────────── */
let allObjs = [];

function add(geo, mat, pos, rot, ud) {
  const m = new THREE.Mesh(geo, mat.clone());
  m.position.copy(pos||new THREE.Vector3());
  if(rot) m.rotation.copy(rot);
  m.castShadow=true; m.receiveShadow=true;
  m.userData = { ...ud, _mat:m.material };
  scene.add(m); allObjs.push(m); return m;
}

/* ── Build plant model ────────────────────────────────────── */
const EQUIP_ATTRS = {
  'V-101':{ NAME:'V-101', TYPE:'Vertical Process Vessel', PDMS_ID:'1234567', NOZZLES:'3',
    DIAMETER:'2400 mm', HEIGHT:'6500 mm', 'DESIGN PRESS':'10 bar', 'DESIGN TEMP':'150°C',
    MATERIAL:'SA-516 Grade 70', INSULATION:'50 mm mineral wool', AREA:'RHBG-AREA-01' },
  'P-101A':{ NAME:'P-101A', TYPE:'Centrifugal Pump', PDMS_ID:'1234568', MODEL:'API 610 OH2',
    FLOW:'180 m³/h', HEAD:'65 m', POWER:'55 kW', SHAFT_SPEED:'2960 rpm',
    FLUID:'Process water', MATERIAL:'316 SS', AREA:'RHBG-AREA-01' },
  'M-101':{ NAME:'M-101', TYPE:'Electric Motor', PDMS_ID:'1234569', POWER:'55 kW',
    VOLTAGE:'415V 3Ph', FREQUENCY:'50 Hz', SPEED:'2960 rpm', CLASS:'IE3', AREA:'RHBG-AREA-01' },
  'PIPE-IN':{ NAME:'PIPE-4"-150-CS-IN', TYPE:'Pipe Segment', SPEC:'4"-150# CS',
    OD:'114.3 mm', WT:'6.02 mm', MATERIAL:'ASTM A106 Gr.B', FLUID:'Process water' },
  'PIPE-OUT':{ NAME:'PIPE-4"-150-CS-OUT', TYPE:'Pipe Segment', SPEC:'4"-150# CS',
    OD:'114.3 mm', WT:'6.02 mm', MATERIAL:'ASTM A106 Gr.B', FLUID:'Discharge' },
  'COL-01':{ NAME:'COL-01', TYPE:'Structural Column', SECTION:'UC 203×203×60',
    HEIGHT:'5000 mm', MATERIAL:'S275 JR', FINISH:'Hot-dip galvanised' },
};

function buildScene() {
  const eqMat  = steel(0x7a8898,.38,.6);
  const pipeMat= steel(0x5a7090,.32,.65);
  const strMat = steel(0x3e5060,.55,.5);
  const platMat= steel(0x485868,.65,.4);
  const noMat  = steel(0x506070,.4,.7);
  const pumpMat= steel(0x6a8080,.35,.6);

  // ── V-101 Vessel ──────────────────────────────────────────
  // Shell
  add(new THREE.CylinderGeometry(1.2,1.2,5.5,32),eqMat,
    new THREE.Vector3(0,5.75,0),null,{id:'V-101',name:'V-101',kind:'EQUIP'});
  // Top head
  add(new THREE.SphereGeometry(1.2,24,12,0,Math.PI*2,0,Math.PI/2),eqMat,
    new THREE.Vector3(0,8.5,0),null,{id:'V-101',name:'V-101',kind:'EQUIP'});
  // Bottom head
  const bh = add(new THREE.SphereGeometry(1.2,24,12,0,Math.PI*2,0,Math.PI/2),eqMat,
    new THREE.Vector3(0,3,0),new THREE.Euler(Math.PI,0,0),{id:'V-101',name:'V-101',kind:'EQUIP'});
  // Nozzles
  [[0,7,1.2,'N1'],[0,6,-1.2,'N2'],[1.2,5.5,0,'N3']].forEach(([x,y,z,n])=>{
    const dir = new THREE.Vector3(x,0,z).normalize();
    const m=add(new THREE.CylinderGeometry(.12,.12,.6,12),noMat,
      new THREE.Vector3(x>0?1.5:x<0?-1.5:x,y,z>0?1.5:z<0?-1.5:z),null,
      {id:`V-101-${n}`,name:`V-101 Nozzle ${n}`,kind:'NOZZLE'});
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.set(x,0,z).normalize());
    // Flange
    const f=add(new THREE.CylinderGeometry(.22,.22,.08,16),noMat,
      new THREE.Vector3(x>0?1.82:x<0?-1.82:x,y,z>0?1.82:z<0?-1.82:z),null,
      {id:`V-101-${n}-FL`,name:`V-101 Flange ${n}`,kind:'FLANGE'});
    f.quaternion.copy(m.quaternion);
  });

  // Skirt
  add(new THREE.CylinderGeometry(1.25,1.25,2.8,32,1,true),steel(0x405060,.55,.5),
    new THREE.Vector3(0,1.4,0),null,{id:'V-101-SKT',name:'V-101 Skirt',kind:'STRUCT'});

  // ── P-101A Pump ───────────────────────────────────────────
  // Volute casing
  add(new THREE.BoxGeometry(.9,.55,.7),pumpMat,
    new THREE.Vector3(4.5,1.3,0),null,{id:'P-101A',name:'P-101A Pump',kind:'EQUIP'});
  // Casing cylinder (suction)
  const pc=add(new THREE.CylinderGeometry(.28,.28,.9,16),pumpMat,
    new THREE.Vector3(4.5,1.3,0),null,{id:'P-101A',name:'P-101A Pump Casing',kind:'EQUIP'});
  pc.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(1,0,0));
  // Baseplate
  add(new THREE.BoxGeometry(2.5,.12,1.2),strMat,
    new THREE.Vector3(5,.86,0),null,{id:'P-101A-BASE',name:'P-101A Baseplate',kind:'STRUCT'});

  // ── M-101 Motor ───────────────────────────────────────────
  const mot=add(new THREE.CylinderGeometry(.28,.28,1.1,16),steel(0x606870,.4,.5),
    new THREE.Vector3(6.2,1.3,0),null,{id:'M-101',name:'M-101 Motor',kind:'EQUIP'});
  mot.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(1,0,0));
  // Fan cover
  add(new THREE.CylinderGeometry(.3,.3,.12,16),steel(0x404848,.5,.4),
    new THREE.Vector3(6.8,1.3,0),
    new THREE.Euler(0,0,Math.PI/2),{id:'M-101',name:'M-101 Fan',kind:'EQUIP'});

  // ── Piping ────────────────────────────────────────────────
  function pipe(s,e,ud){
    const d=new THREE.Vector3().subVectors(e,s),l=d.length();
    if(l<.01) return;
    const m2=add(new THREE.CylinderGeometry(.12,.12,l,12),pipeMat,
      s.clone().add(e).multiplyScalar(.5),null,ud);
    m2.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
  }
  pipe(new THREE.Vector3(0,3.5,2.5),new THREE.Vector3(0,2.2,2.5),{id:'PIPE-IN',name:'4"-150-CS Suction',kind:'PIPE'});
  pipe(new THREE.Vector3(0,2.2,2.5),new THREE.Vector3(4,2.2,2.5),{id:'PIPE-IN',name:'4"-150-CS Suction',kind:'PIPE'});
  pipe(new THREE.Vector3(4,2.2,2.5),new THREE.Vector3(4,1.3,2.5),{id:'PIPE-IN',name:'4"-150-CS Suction',kind:'PIPE'});
  pipe(new THREE.Vector3(4,1.3,2.5),new THREE.Vector3(4.5,1.3,.35),{id:'PIPE-IN',name:'4"-150-CS Suction',kind:'PIPE'});
  // Discharge
  pipe(new THREE.Vector3(4.5,1.58,0),new THREE.Vector3(4.5,2.8,0),{id:'PIPE-OUT',name:'4"-150-CS Discharge',kind:'PIPE'});
  pipe(new THREE.Vector3(4.5,2.8,0),new THREE.Vector3(0,2.8,0),{id:'PIPE-OUT',name:'4"-150-CS Discharge',kind:'PIPE'});
  pipe(new THREE.Vector3(0,2.8,0),new THREE.Vector3(0,3,-1.2),{id:'PIPE-OUT',name:'4"-150-CS Discharge',kind:'PIPE'});

  // ── Structure ─────────────────────────────────────────────
  // Columns
  [[-2,0,-2],[-2,0,2],[3,0,-2],[3,0,2],[8,0,-2],[8,0,2]].forEach(([x,,z],i)=>{
    add(new THREE.BoxGeometry(.18,5.2,.18),strMat,
      new THREE.Vector3(x,2.6,z),null,{id:`COL-0${i+1}`,name:`Column COL-0${i+1}`,kind:'STRUCT'});
  });
  // Beams at 5m height
  [[-2,2],[-2,3],[8,2],[8,3]].forEach(([x,z])=>{
    add(new THREE.BoxGeometry(5.2,.2,.18),strMat,
      new THREE.Vector3((x+3)/2,5.2,z),null,{id:'BEAM',name:'Platform Beam',kind:'STRUCT'});
  });
  // Cross beams
  [[-2,3],[8,3]].forEach(([x])=>{
    add(new THREE.BoxGeometry(.18,.2,4.18),strMat,
      new THREE.Vector3(x,5.2,0.5),null,{id:'BEAM',name:'Platform Beam',kind:'STRUCT'});
  });
  // Platform deck
  add(new THREE.BoxGeometry(5.4,4.4,.15),platMat,
    new THREE.Vector3(0.5,5.3,0.5),
    new THREE.Euler(Math.PI/2,0,0),{id:'PLAT-01',name:'Platform PLAT-01',kind:'STRUCT'});

  // Ladder
  [-2.08,-1.88].forEach(x=>{
    add(new THREE.BoxGeometry(.08,5.2,.04),strMat,
      new THREE.Vector3(x,2.6,3),null,{id:'LAD-01',name:'Ladder LAD-01',kind:'STRUCT'});
  });
  for(let i=0;i<7;i++){
    add(new THREE.BoxGeometry(.2,.04,.04),strMat,
      new THREE.Vector3(-1.98,.6+i*.7,3),null,{id:'LAD-01',name:'Ladder Rung',kind:'STRUCT'});
  }

  // Ground
  const gnd=new THREE.Mesh(new THREE.PlaneGeometry(50,50),
    new THREE.MeshStandardMaterial({color:0x0a1020,roughness:1,metalness:0}));
  gnd.rotation.x=-Math.PI/2; gnd.receiveShadow=true; scene.add(gnd);
  const grid=new THREE.GridHelper(30,30,0x1e3050,0x162540); grid.position.y=.001; scene.add(grid);

  updateUI();
  populateTree();
  populateTags();
  document.getElementById('rvm-hint').style.display='none';
  document.getElementById('rvm-sb-msg').textContent='RHBG-AREA-01 — demo plant model loaded';
  document.getElementById('ss-model').textContent='RHBG-AREA-01';
  document.getElementById('ss-model').classList.add('active');
  document.getElementById('ss-nodes').textContent=`${allObjs.length} nodes`;
  document.getElementById('ss-tri').textContent=`${(renderer.info.render.triangles/1000).toFixed(0)}K tri`;
}

/* ── Resize ───────────────────────────────────────────────── */
function resize(){ const w=vp.clientWidth,h=vp.clientHeight; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); }
resize(); window.addEventListener('resize',resize); new ResizeObserver(resize).observe(vp);

/* ── Raycasting ───────────────────────────────────────────── */
const ray=new THREE.Raycaster(); const mouse=new THREE.Vector2();
function hits(e){ const r=canvas.getBoundingClientRect(); mouse.x=((e.clientX-r.left)/r.width)*2-1; mouse.y=-((e.clientY-r.top)/r.height)*2+1; ray.setFromCamera(mouse,camera); return ray.intersectObjects(allObjs.filter(o=>o.visible),false); }
function setHov(o){ if(S.hovered===o) return; if(S.hovered&&S.hovered!==S.selected)S.hovered.material=S.hovered.userData._mat; S.hovered=o; if(o&&o!==S.selected)o.material=M_HOV; }
function setSel(o){
  if(S.selected)S.selected.material=S.selected.userData._mat;
  S.selected=o;
  if(o){ o.material=M_SEL; showAttrs(o); document.getElementById('rvm-sel-count').textContent='1'; document.getElementById('ss-sel').textContent='1 selected'; }
  else { clearAttrs(); document.getElementById('rvm-sel-count').textContent='0'; document.getElementById('ss-sel').textContent='0 selected'; }
}

/* ── Attributes panel ─────────────────────────────────────── */
function showAttrs(obj){
  const ud=obj.userData;
  const attrs=EQUIP_ATTRS[ud.id]||{NAME:ud.name||ud.id,TYPE:ud.kind||'Object'};
  document.getElementById('attr-empty').style.display='none';
  document.getElementById('attr-name-row').style.display='';
  document.getElementById('attr-obj-name').textContent=attrs.NAME||ud.name||ud.id;
  document.getElementById('attr-obj-type').textContent=attrs.TYPE||ud.kind||'Object';
  const tbody=document.getElementById('attr-tbody');
  document.getElementById('attr-table').style.display='';
  tbody.innerHTML=Object.entries(attrs).map(([k,v])=>`<tr class="attr-row"><td>${k}</td><td>${v}</td></tr>`).join('');
}
function clearAttrs(){
  document.getElementById('attr-empty').style.display='';
  document.getElementById('attr-name-row').style.display='none';
  document.getElementById('attr-table').style.display='none';
}
document.getElementById('attr-filter').addEventListener('input',e=>{
  const q=e.target.value.toLowerCase();
  document.querySelectorAll('#attr-tbody .attr-row').forEach(r=>{r.style.display=r.textContent.toLowerCase().includes(q)?'':'none';});
});

/* ── Tree ─────────────────────────────────────────────────── */
const TREE = [
  {id:'ROOT',label:'RHBG-AREA-01',kind:'root',count:allObjs.length,children:[
    {id:'EQUIP',label:'Equipment',kind:'group',count:3,children:[
      {id:'V-101', label:'V-101  — Vessel',    kind:'EQUIP'},
      {id:'P-101A',label:'P-101A — Pump',      kind:'EQUIP'},
      {id:'M-101', label:'M-101  — Motor',     kind:'EQUIP'},
    ]},
    {id:'PIPE',label:'Piping',kind:'group',count:2,children:[
      {id:'PIPE-IN', label:'4"-150-CS-IN  Suction',  kind:'PIPE'},
      {id:'PIPE-OUT',label:'4"-150-CS-OUT Discharge',kind:'PIPE'},
    ]},
    {id:'STRU',label:'Structure',kind:'group',count:3,children:[
      {id:'COL-01',  label:'Columns (6)',   kind:'STRUCT'},
      {id:'PLAT-01', label:'Platform',      kind:'STRUCT'},
      {id:'LAD-01',  label:'Ladder',        kind:'STRUCT'},
    ]},
  ]}
];
const KIND_COLOR={EQUIP:'#7ab8d8',PIPE:'#78b8f0',STRUCT:'#a8b8c8',NOZZLE:'#a8d8b8',group:'#4a9eff',root:'#4a9eff'};

function buildTreeHTML(nodes,depth=0){
  return nodes.map(n=>{
    const ch=n.children?.length;
    const indent=depth===0?'':depth===1?' class="rti indented"':' class="rti indented2"';
    const wrap=`<li id="tni-${n.id}">
      <div${depth?indent:' class="rti"'} data-id="${n.id}" onclick="rvmTreeClick('${n.id}',event)">
        <span class="rti-toggle${ch?' open':' leaf'}">▶</span>
        <input type="checkbox" class="rti-cb" checked onclick="rvmCbClick('${n.id}',this,event)">
        <span class="rti-icon" style="background:${KIND_COLOR[n.kind]||'#888'}"></span>
        <span class="rti-name">${n.label}</span>
        ${n.count?`<span class="rti-count">${n.count}</span>`:''}
      </div>
      ${ch?`<ul class="rvm-tree rti-children open">${buildTreeHTML(n.children,depth+1)}</ul>`:''}
    </li>`;
    return wrap;
  }).join('');
}
function populateTree(){
  document.getElementById('rvm-tree-root').innerHTML=buildTreeHTML(TREE);
  document.querySelectorAll('.rti-toggle:not(.leaf)').forEach(t=>{
    t.closest('li').querySelector(':scope > div').addEventListener('click',e=>{
      if(e.target.matches('input')) return;
      const ch=t.closest('li').querySelector('.rti-children');
      const op=ch?.classList.toggle('open');
      t.classList.toggle('open',!!op);
    });
  });
}
window.rvmTreeClick=(id,e)=>{ if(e.target.matches('input')) return; const obj=allObjs.find(o=>o.userData.id===id); if(obj)setSel(obj); };
window.rvmCbClick=(id,cb,e)=>{ e.stopPropagation(); allObjs.filter(o=>o.userData.id===id).forEach(o=>{ o.visible=cb.checked; }); };

document.getElementById('tc-all') .addEventListener('click',()=>{ document.querySelectorAll('.rti-cb').forEach(c=>{c.checked=true;  allObjs.forEach(o=>o.visible=true);  }); });
document.getElementById('tc-none').addEventListener('click',()=>{ document.querySelectorAll('.rti-cb').forEach(c=>{c.checked=false; allObjs.forEach(o=>o.visible=false); }); });
document.getElementById('tc-exp') .addEventListener('click',()=>{ document.querySelectorAll('.rti-children').forEach(c=>c.classList.add('open'));    document.querySelectorAll('.rti-toggle:not(.leaf)').forEach(t=>t.classList.add('open'));    });
document.getElementById('tc-col') .addEventListener('click',()=>{ document.querySelectorAll('.rti-children').forEach(c=>c.classList.remove('open')); document.querySelectorAll('.rti-toggle:not(.leaf)').forEach(t=>t.classList.remove('open')); });

document.getElementById('tree-filter').addEventListener('input',e=>{
  const q=e.target.value.toLowerCase();
  document.querySelectorAll('#rvm-tree-root li').forEach(li=>{ li.style.display=(!q||li.textContent.toLowerCase().includes(q))?'':'none'; });
});

// inline search
document.getElementById('rvm-search-input').addEventListener('input',e=>{
  const q=e.target.value.toLowerCase().trim();
  const list=document.getElementById('rvm-search-list');
  if(!q){list.innerHTML=''; document.getElementById('search-count').textContent=''; return;}
  const seen=new Set();
  const r=allObjs.filter(o=>{ const id=o.userData.id||''; if(seen.has(id))return false; seen.add(id); return id.toLowerCase().includes(q)||(o.userData.name||'').toLowerCase().includes(q)||(o.userData.kind||'').toLowerCase().includes(q); });
  document.getElementById('search-count').textContent=`${r.length} result${r.length!==1?'s':''}`;
  list.innerHTML=r.slice(0,20).map(o=>`<li class="rti" onclick="rvmTreeClick('${o.userData.id}',event)" data-id="${o.userData.id}">
    <span class="rti-toggle leaf">▶</span>
    <span class="rti-icon" style="background:${KIND_COLOR[o.userData.kind]||'#888'}"></span>
    <span class="rti-name">${o.userData.name||o.userData.id}</span>
    <span class="rti-count">${o.userData.kind||''}</span>
  </li>`).join('');
});

/* ── Tags ─────────────────────────────────────────────────── */
let TAGS=[
  {id:'TAG-001',text:'Clash detected at V-101 nozzle N1 / structural beam',sev:'high',target:'V-101-N1'},
  {id:'TAG-002',text:'Missing insulation on hot tap connection PIPE-OUT',sev:'medium',target:'PIPE-OUT'},
  {id:'TAG-003',text:'Label orientation incorrect on P-101A',sev:'low',target:'P-101A'},
];
let tagCounter=4;

function renderTags(filter='all'){
  const list=document.getElementById('tag-list');
  const filtered=filter==='all'?TAGS:TAGS.filter(t=>t.sev===filter);
  list.innerHTML=filtered.map(t=>`
    <div class="tag-item sev-${t.sev}" data-id="${t.id}">
      <div class="tag-body">
        <div class="tag-text">${t.text}</div>
        <div class="tag-meta">
          <span class="tag-sev-badge">${t.sev.toUpperCase()}</span>
          <span>${t.id}</span>
          <span style="color:#4f6079">${t.target}</span>
        </div>
      </div>
      <div class="tag-actions">
        <button class="tag-act-btn" data-tag-jump="${t.id}" title="Jump to tag">⟳</button>
        <button class="tag-act-btn del" data-tag-del="${t.id}" title="Delete tag">✕</button>
      </div>
    </div>`).join('')||'<div style="padding:12px 10px;font-size:10px;color:var(--muted)">No tags</div>';

  list.querySelectorAll('[data-tag-jump]').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation(); const tag=TAGS.find(t=>t.id===b.dataset.tagJump);
    if(!tag) return; const obj=allObjs.find(o=>o.userData.id===tag.target);
    if(obj){ setSel(obj); fitObjs([obj]); }
  }));
  list.querySelectorAll('[data-tag-del]').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation(); TAGS=TAGS.filter(t=>t.id!==b.dataset.tagDel);
    renderTags(document.getElementById('tag-sev-filter').value);
    document.getElementById('ss-tags').textContent=`${TAGS.length} review tags`;
  }));
  list.querySelectorAll('.tag-item').forEach(item=>item.addEventListener('click',()=>{
    const tag=TAGS.find(t=>t.id===item.dataset.id); if(!tag) return;
    document.getElementById('tm-target').value=tag.target;
  }));
}
function populateTags(){ renderTags(); }
document.getElementById('tag-sev-filter').addEventListener('change',e=>renderTags(e.target.value));

// Tag modal
document.getElementById('add-tag-btn').addEventListener('click',()=>{ document.getElementById('tm-id').value=`TAG-00${tagCounter}`; tagMod.classList.add('show'); });
document.getElementById('tm-cancel').addEventListener('click',()=>tagMod.classList.remove('show'));
document.getElementById('tm-create').addEventListener('click',()=>{
  const id=document.getElementById('tm-id').value||`TAG-00${tagCounter}`;
  const text=document.getElementById('tm-text').value||'New tag';
  const sev=document.getElementById('tm-sev').value;
  const target=document.getElementById('tm-target').value||'—';
  TAGS.push({id,text,sev,target}); tagCounter++;
  renderTags(document.getElementById('tag-sev-filter').value);
  document.getElementById('ss-tags').textContent=`${TAGS.length} review tags`;
  tagMod.classList.remove('show');
  ['tm-id','tm-text','tm-target'].forEach(i=>document.getElementById(i).value='');
});
document.getElementById('rvm-ctx').querySelector('[data-a="tag"]').addEventListener('click',()=>{ if(S.selected) document.getElementById('tm-target').value=S.selected.userData.id||''; tagMod.classList.add('show'); });

/* ── Camera ───────────────────────────────────────────────── */
const R2D=180/Math.PI;
const SNAPS={front:[0,0,1],back:[0,0,-1],right:[1,0,0],left:[-1,0,0],top:[0,1,0],bottom:[0,-1,0],nw:[-1,1,-1],ne:[1,1,-1],se:[1,-1,1]};
function snapTo(k){ const d=SNAPS[k]; if(!d) return; const t=ctrl.target.clone(),dist=camera.position.distanceTo(t)||18; animCam(t.clone().addScaledVector(new THREE.Vector3(...d).normalize(),dist),t); }
function animCam(tp,tt,dur=500){ const fp=camera.position.clone(),ft=ctrl.target.clone(),s=performance.now(); const tick=n=>{ const e2=Math.min((n-s)/dur,1),e=e2<.5?2*e2*e2:1-Math.pow(-2*e2+2,2)/2; camera.position.lerpVectors(fp,tp,e); ctrl.target.lerpVectors(ft,tt,e); ctrl.update(); if(e2<1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
function fitObjs(objs){ const box=new THREE.Box3(); objs.forEach(o=>box.expandByObject(o)); const c=new THREE.Vector3(); box.getCenter(c); const sz=new THREE.Vector3(); box.getSize(sz); const d=Math.abs(Math.max(sz.x,sz.y,sz.z,.1)/2/Math.tan(camera.fov*Math.PI/360))*1.6; const dir=camera.position.clone().sub(ctrl.target).normalize(); animCam(c.clone().addScaledVector(dir,d),c); }
function fitAll(){ fitObjs(allObjs.filter(o=>o.visible)); }

/* ── Mode ─────────────────────────────────────────────────── */
function setMode(m){
  S.mode=m; ctrl.enableRotate=(m==='orbit'); ctrl.enablePan=(m==='orbit'||m==='pan');
  vp.className=`m-${m}`;
  const chip=document.getElementById('rvm-mode-chip'); chip.textContent=m.charAt(0).toUpperCase()+m.slice(1);
  chip.style.background=m==='measure'?'rgba(249,115,22,.14)':m==='select'?'rgba(74,222,128,.1)':'rgba(74,158,255,.16)';
  document.querySelectorAll('.rt-btn[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
}

/* ── ViewCube ─────────────────────────────────────────────── */
function syncVC(){ const a=ctrl.getAzimuthalAngle(),p=ctrl.getPolarAngle(); vc.style.transform=`rotateX(${-(p-Math.PI/2)*R2D}deg) rotateY(${-a*R2D}deg)`; }
document.querySelectorAll('.vcf').forEach(f=>f.addEventListener('click',e=>{e.stopPropagation();snapTo(f.dataset.snap);}));

/* ── Axis Gizmo ───────────────────────────────────────────── */
const AX={x:new THREE.Vector3(1,0,0),y:new THREE.Vector3(0,1,0),z:new THREE.Vector3(0,0,1)};
function syncAxis(){ const L=36,vm=camera.clone(); vm.updateMatrixWorld(); const mm=vm.matrixWorldInverse; ['x','y','z'].forEach(k=>{ const v=AX[k].clone().applyMatrix4(mm).normalize(); const lx=v.x*L,ly=-v.y*L; const el=document.getElementById(`rax-${k}`),tl=document.getElementById(`rax-${k}l`); if(el){el.setAttribute('x2',lx.toFixed(1));el.setAttribute('y2',ly.toFixed(1));} if(tl){tl.setAttribute('x',(lx*1.22).toFixed(1));tl.setAttribute('y',(ly*1.22).toFixed(1));} }); }

/* ── Coords ───────────────────────────────────────────────── */
function updateCoords(e){ if(!e){['rcx','rcy','rcz','rsx','rsy','rsz'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='—';}); return;} const h=hits(e); if(h.length){const p=h[0].point; [['rcx','rsx',(p.x*1000).toFixed(0)],['rcy','rsy',(p.y*1000).toFixed(0)],['rcz','rsz',(p.z*1000).toFixed(0)]].forEach(([a,b,v])=>{[a,b].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=v;});}); } else {['rcx','rcy','rcz','rsx','rsy','rsz'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='—';});} }

/* ── Ribbon wiring ────────────────────────────────────────── */
const rbn=(id,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener('click',fn);};
rbn('rt-select',()=>setMode('select')); rbn('rt-orbit',()=>setMode('orbit'));
rbn('rt-pan',()=>setMode('pan'));       rbn('rt-measure',()=>setMode('measure'));
rbn('rt-fitall',()=>fitAll());          rbn('rt-fitsel',()=>{if(S.selected)fitObjs([S.selected]);});
rbn('rt-proj',()=>{camera.fov=camera.fov===45?1:45;camera.updateProjectionMatrix();document.getElementById('rt-proj').classList.toggle('active',camera.fov===1);});
rbn('rt-nw',()=>snapTo('nw')); rbn('rt-ne',()=>snapTo('ne')); rbn('rt-se',()=>snapTo('se')); rbn('rt-top',()=>snapTo('top'));
rbn('rt-secbox',()=>secPnl.classList.toggle('show'));
rbn('rt-secoff',()=>secPnl.classList.remove('show'));
rbn('help-btn',()=>kbdHlp.classList.toggle('show'));
rbn('rv-help',()=>kbdHlp.classList.toggle('show'));
rbn('kh-close',()=>kbdHlp.classList.remove('show'));
rbn('sp-close',()=>secPnl.classList.remove('show'));
rbn('sp-reset',()=>{['rx-min','ry-min','rz-min'].forEach(id=>document.getElementById(id).value=0); ['rx-max','ry-max','rz-max'].forEach(id=>document.getElementById(id).value=100); updateSecLabels();});

function updateSecLabels(){ [['rx-min','lbl-xmin'],['rx-max','lbl-xmax'],['ry-min','lbl-ymin'],['ry-max','lbl-ymax'],['rz-min','lbl-zmin'],['rz-max','lbl-zmax']].forEach(([src,dst])=>{const s=document.getElementById(src),d=document.getElementById(dst);if(s&&d)d.textContent=s.value;}); }
document.querySelectorAll('#sec-panel input[type=range]').forEach(s=>s.addEventListener('input',updateSecLabels));

/* ── Context menu ─────────────────────────────────────────── */
const hideCtx=()=>ctx.classList.remove('show');
canvas.addEventListener('contextmenu',e=>{ e.preventDefault(); const r=vp.getBoundingClientRect(); const x=Math.min(e.clientX-r.left,vp.clientWidth-196); const y=Math.min(e.clientY-r.top,vp.clientHeight-240); ctx.style.left=x+'px'; ctx.style.top=y+'px'; ctx.classList.add('show'); });
document.addEventListener('click',e=>{ if(!ctx.contains(e.target))hideCtx(); if(!tagMod.contains(e.target)&&!e.target.matches('#add-tag-btn,[data-a="tag"]'))tagMod.classList.remove('show'); });
ctx.querySelector('[data-a="fitsel"]').addEventListener('click',()=>{ if(S.selected)fitObjs([S.selected]); hideCtx(); });
ctx.querySelector('[data-a="showall"]').addEventListener('click',()=>{ allObjs.forEach(o=>o.visible=true); document.querySelectorAll('.rti-cb').forEach(c=>c.checked=true); hideCtx(); });
ctx.querySelector('[data-a="hide"]').addEventListener('click',()=>{ if(S.selected){S.selected.visible=false;setSel(null);} hideCtx(); });
ctx.querySelector('[data-a="isolate"]').addEventListener('click',()=>{ if(S.selected){const k=S.selected.userData.kind; allObjs.forEach(o=>o.visible=o.userData.kind===k);} hideCtx(); });
ctx.querySelector('[data-a="attrs"]').addEventListener('click',()=>{ if(S.selected)showAttrs(S.selected); hideCtx(); });

/* ── Mouse events ─────────────────────────────────────────── */
canvas.addEventListener('mousemove',e=>{ updateCoords(e); if(S.mode==='select'){const h=hits(e);setHov(h.length?h[0].object:null);} });
canvas.addEventListener('click',e=>{ if(S.mode==='select'){const h=hits(e);setSel(h.length&&h[0].object.userData.id?h[0].object:null);} });
canvas.addEventListener('mouseleave',()=>{setHov(null);updateCoords(null);});

/* ── Keyboard ─────────────────────────────────────────────── */
document.addEventListener('keydown',e=>{ if(e.target.matches('input,select,textarea')) return; const k=e.key; if(k==='o'||k==='O')setMode('orbit'); if(k==='s'||k==='S')setMode('select'); if(k==='p'||k==='P')setMode('pan'); if(k==='m'||k==='M')setMode('measure'); if(k==='f'||k==='F'){e.shiftKey&&S.selected?fitObjs([S.selected]):fitAll();} if(k==='Escape'){setSel(null);hideCtx();secPnl.classList.remove('show');kbdHlp.classList.remove('show');tagMod.classList.remove('show');} if(k==='?')kbdHlp.classList.toggle('show'); if(k==='t'||k==='T')document.getElementById('add-tag-btn').click(); if(k==='7')snapTo('nw'); if(k==='9')snapTo('ne'); if(k==='3')snapTo('se'); });

/* ── Right panel resize ───────────────────────────────────── */
const handle=document.getElementById('rvm-right-resize'); const rpanel=document.getElementById('rvm-right');
handle.addEventListener('mousedown',e=>{ e.preventDefault(); const sx=e.clientX,sw=rpanel.offsetWidth; handle.classList.add('drag');
  const onMove=me=>{ const nw=Math.max(160,Math.min(540,sw+(sx-me.clientX))); rpanel.style.width=nw+'px'; };
  const onUp=()=>{ handle.classList.remove('drag'); document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); };
  document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp); });

/* ── FPS ──────────────────────────────────────────────────── */
function fps(t){ S._fc++; if(t-S._ft>1000){document.getElementById('rvm-fps').textContent=`${S._fc}fps`; S._fc=0; S._ft=t; } }
function updateUI(){ document.getElementById('ss-nodes').textContent=`${allObjs.length} nodes`; }

/* ── Init + Loop ──────────────────────────────────────────── */
buildScene();
(function animate(t){ requestAnimationFrame(animate); ctrl.update(); syncVC(); syncAxis(); fps(t); renderer.render(scene,camera); })(0);

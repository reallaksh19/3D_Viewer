/**
 * viewer-scene.js — Three.js demo scene, ViewCube, raycasting, UI wiring
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ── DOM refs ─────────────────────────────────────────────── */
const wrap    = document.getElementById('cvs-wrap');
const canvas  = document.getElementById('viewer-canvas');
const vc      = document.getElementById('vc');
const hint    = document.getElementById('hint');
const selHud  = document.getElementById('sel-hud');
const ctxMenu = document.getElementById('ctx');
const kbdHelp = document.getElementById('kbd-help');

/* ── State ────────────────────────────────────────────────── */
const S = {
  mode: 'orbit',
  selected: null,
  hovered: null,
  hidden: new Set(),
  grid: true,
  wire: false,
  xray: false,
  fps: 0, _fc: 0, _ft: 0,
};

const COLORS = {
  PIPE:'#66d9ff', FLANGE:'#ffb25c', VALVE:'#72e39a', TEE:'#ffe07a',
  ELBOW:'#d0a8ff', REDUCER:'#ff9dc7', SUPPORT:'#60c864', ANCI:'#ff7070',
  UNKNOWN:'#94a8bc'
};

/* ── Renderer ─────────────────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08111c);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
camera.position.set(10, 7, 14);

/* ── Lights ───────────────────────────────────────────────── */
scene.add(new THREE.AmbientLight(0x4466aa, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.25);
sun.position.set(10, 16, 12);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -15;
sun.shadow.camera.right = sun.shadow.camera.top = 15;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x224466, 0x111e2a, 0.4));

/* ── Controls ─────────────────────────────────────────────── */
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.5;
controls.maxDistance = 80;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.update();

/* ── Materials ────────────────────────────────────────────── */
function mat(hex, rough=0.32, metal=0.55) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: metal });
}
const MATS  = Object.fromEntries(Object.entries(COLORS).map(([k,v])=>[k, mat(v)]));
const M_HOV = new THREE.MeshStandardMaterial({ color:0x5090d0, roughness:0.2, metalness:0.5, emissive:0x0a2040 });
const M_SEL = new THREE.MeshStandardMaterial({ color:0x2860f8, roughness:0.2, metalness:0.5, emissive:0x0a1560, emissiveIntensity:0.55 });

/* ── Scene objects ────────────────────────────────────────── */
let allObjects = [];
let gridHelper, groundMesh;

function addMesh(geo, type, tag, extra={}) {
  const m = new THREE.Mesh(geo, MATS[type].clone());
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData = { type, tag, _mat: m.material, ...extra };
  scene.add(m);
  allObjects.push(m);
  return m;
}

function cylinder(s, e, r, type, tag, extra={}) {
  const d = new THREE.Vector3().subVectors(e,s), l = d.length();
  if(l < .01) return null;
  const mid = s.clone().add(e).multiplyScalar(.5);
  const m = addMesh(new THREE.CylinderGeometry(r,r,l,16), type, tag, extra);
  m.position.copy(mid);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.normalize());
  return m;
}

function disc(pos, dir, r, type, tag, extra={}) {
  const m = addMesh(new THREE.CylinderGeometry(r,r,0.1,20), type, tag, extra);
  m.position.copy(pos);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.normalize());
  return m;
}

function tube(pts, r, type, tag, extra={}) {
  const curve = new THREE.CatmullRomCurve3(pts);
  return addMesh(new THREE.TubeGeometry(curve,12,r,10,false), type, tag, extra);
}

const BASE = {
  pipelineRef:'1001-P-001', spec:'ASTM A106 Gr.B', T1:'120°C', T2:'65°C', P1:'14.7 bar', wt:'8.18 mm'
};

function buildModel() {
  const xv = new THREE.Vector3(1,0,0);
  const od = 0.22, br = 0.14, fr = 0.38;

  // ── Main run A (X axis) ──────────────────────────────────
  cylinder(new THREE.Vector3(-8,0,0), new THREE.Vector3(-2,0,0), od, 'PIPE','PIPE-A01',
    {...BASE, lineRef:'1001-A-8"-CS', od:'219.1 mm (8")', len:'6000 mm'});
  cylinder(new THREE.Vector3( 2,0,0), new THREE.Vector3( 8,0,0), od, 'PIPE','PIPE-A02',
    {...BASE, lineRef:'1001-A-8"-CS', od:'219.1 mm (8")', len:'6000 mm'});

  // flanges on A
  [[-8,-1],[-2,-1],[2,1],[8,1]].forEach(([x,s],i)=>{
    disc(new THREE.Vector3(x,0,0), new THREE.Vector3(s,0,0), fr, 'FLANGE',`FL-A0${i+1}`,
      {lineRef:'1001-A-8"-CS'});
  });

  // Gate valve
  const vb = addMesh(new THREE.BoxGeometry(3.8,0.52,0.52),'VALVE','VLV-A01',
    {lineRef:'1001-A-8"-CS',spec:'Gate Valve DN200',T1:'120°C',T2:'65°C',P1:'14.7 bar'});
  const stemM = MATS.VALVE.clone();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,1.4,8), stemM);
  stem.position.set(0,.9,0); vb.add(stem);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(.3,.038,8,20), stemM);
  wheel.position.set(0,1.65,0); wheel.rotation.x=Math.PI/2; vb.add(wheel);

  // TEE at x=4
  const tee = addMesh(new THREE.CylinderGeometry(.34,.34,.5,18), 'TEE','TEE-A01',
    {lineRef:'1001-A-8"-CS',spec:'Weld Tee 8"×4"'});
  tee.position.set(4,0,0);
  tee.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), xv);

  // ── Branch B (Y axis) ────────────────────────────────────
  cylinder(new THREE.Vector3(4,0.3,0),new THREE.Vector3(4,4.2,0), br,'PIPE','PIPE-B01',
    {pipelineRef:'1001-P-001',lineRef:'1001-B-4"-CS',od:'114.3 mm (4")',len:'3900 mm',
     spec:'ASTM A106 Gr.B',T1:'80°C',T2:'40°C',P1:'10.2 bar',wt:'6.02 mm'});
  disc(new THREE.Vector3(4,4.3,0),new THREE.Vector3(0,1,0),.24,'FLANGE','FL-B01',{lineRef:'1001-B-4"-CS'});
  disc(new THREE.Vector3(4,.2,0), new THREE.Vector3(0,-1,0),.24,'FLANGE','FL-B02',{lineRef:'1001-B-4"-CS'});

  // elbow at top of branch
  const elbPts=[];
  for(let i=0;i<=12;i++){const t=i/12,a=Math.PI/2*t;elbPts.push(new THREE.Vector3(4,4.3+.6*Math.cos(a),-.6*Math.sin(a)));}
  tube(elbPts, br,'ELBOW','ELB-B01',{lineRef:'1001-B-4"-CS',spec:'90° LR Elbow 4"'});

  cylinder(new THREE.Vector3(4,4.3,-.6),new THREE.Vector3(4,4.3,-3.8), br,'PIPE','PIPE-B02',
    {pipelineRef:'1001-P-001',lineRef:'1001-B-4"-CS',od:'114.3 mm (4")',len:'3200 mm',
     spec:'ASTM A106 Gr.B',T1:'80°C',T2:'40°C',P1:'10.2 bar',wt:'6.02 mm'});
  disc(new THREE.Vector3(4,4.3,-3.8),new THREE.Vector3(0,0,-1),.24,'FLANGE','FL-B03',{lineRef:'1001-B-4"-CS'});

  // left elbow + run C
  const lePts=[];
  for(let i=0;i<=12;i++){const t=i/12,a=-Math.PI/2*t;lePts.push(new THREE.Vector3(-8-.6*Math.sin(a),0,-.6+.6*Math.cos(a)));}
  tube(lePts, od,'ELBOW','ELB-A01',{lineRef:'1001-A-8"-CS'});
  cylinder(new THREE.Vector3(-8.6,0,-.6),new THREE.Vector3(-8.6,0,-3.8), od,'PIPE','PIPE-A03',
    {...BASE, lineRef:'1001-A-8"-CS',len:'3200 mm'});

  // reducer + large pipe right end
  const redGeo = new THREE.CylinderGeometry(.42,od,1.4,16);
  const red = addMesh(redGeo,'REDUCER','RED-A01',{lineRef:'1001-A-8"-CS',spec:'Conc. Reducer 8"×10"'});
  red.position.set(9.2,0,0);
  red.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),xv);
  cylinder(new THREE.Vector3(10,0,0),new THREE.Vector3(12.5,0,0),.42,'PIPE','PIPE-A04',
    {...BASE, lineRef:'1001-A-10"-CS',od:'273.0 mm (10")',len:'2500 mm',wt:'9.27 mm'});
  disc(new THREE.Vector3(10.2,0,0),xv,.56,'FLANGE','FL-A05',{lineRef:'1001-A-10"-CS'});
  disc(new THREE.Vector3(12.4,0,0),xv,.56,'FLANGE','FL-A06',{lineRef:'1001-A-10"-CS'});

  // ANCI marker at x=6
  const anc = addMesh(new THREE.OctahedronGeometry(.28,0),'ANCI','ANCI-A01',
    {lineRef:'1001-A-8"-CS',spec:'Fixed Anchor'});
  anc.position.set(6,.5,0); anc.rotation.y=Math.PI/4;

  // Supports
  [[-6,0],[-0.5,0],[6,0]].forEach(([x,z],i)=>{
    const grp=new THREE.Group(); grp.position.set(x,-1.15,z); scene.add(grp);
    const legG=new THREE.BoxGeometry(.1,1.4,.1);
    const baseG=new THREE.BoxGeometry(1.3,.12,.5);
    const sadG=new THREE.CylinderGeometry(.26,.26,.1,16,1,false,0,Math.PI);
    [-0.44,0.44].forEach(dx=>{
      const leg=new THREE.Mesh(legG,MATS.SUPPORT.clone());
      leg.position.set(dx,0,0); grp.add(leg);
      leg.userData={type:'SUPPORT',tag:`SUP-A0${i+1}`,_mat:leg.material,lineRef:'1001-A-8"-CS',spec:'Pipe Support'};
      allObjects.push(leg);
    });
    const base=new THREE.Mesh(baseG,MATS.SUPPORT.clone());
    base.position.set(0,-.65,0); grp.add(base);
    base.userData={type:'SUPPORT',tag:`SUP-A0${i+1}-base`,_mat:base.material};
    allObjects.push(base);
    const sad=new THREE.Mesh(sadG,MATS.SUPPORT.clone());
    sad.position.set(0,.7,0); sad.rotation.z=Math.PI; grp.add(sad);
    sad.userData={type:'SUPPORT',tag:`SUP-A0${i+1}-sad`,_mat:sad.material};
    allObjects.push(sad);
  });

  // Ground + grid
  const groundM=new THREE.MeshStandardMaterial({color:0x0a1020,roughness:1,metalness:0});
  groundMesh=new THREE.Mesh(new THREE.PlaneGeometry(60,60),groundM);
  groundMesh.rotation.x=-Math.PI/2; groundMesh.position.y=-1.8; groundMesh.receiveShadow=true;
  scene.add(groundMesh);

  gridHelper=new THREE.GridHelper(32,32,0x1e3050,0x162540);
  gridHelper.position.y=-1.8;
  scene.add(gridHelper);

  updateCompCount();
  populateTree();
  populateSearchFilters();
  document.getElementById('hint').style.display='none';
  document.getElementById('sb-msg').textContent=`${allObjects.filter(o=>o.userData.type).length} components rendered — 1001-P-001`;
}

/* ── Resize ───────────────────────────────────────────────── */
function resize() {
  const w=wrap.clientWidth, h=wrap.clientHeight;
  renderer.setSize(w,h,false);
  camera.aspect=w/h; camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize',resize);
new ResizeObserver(resize).observe(wrap);

/* ── Raycasting ───────────────────────────────────────────── */
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function getHits(e) {
  const r=canvas.getBoundingClientRect();
  mouse.x=((e.clientX-r.left)/r.width)*2-1;
  mouse.y=-((e.clientY-r.top)/r.height)*2+1;
  ray.setFromCamera(mouse,camera);
  return ray.intersectObjects(allObjects.filter(o=>!o.userData._hidden&&o.userData.type),false);
}

function setHover(obj) {
  if(S.hovered===obj) return;
  if(S.hovered&&S.hovered!==S.selected) S.hovered.material=S.hovered.userData._mat;
  S.hovered=obj;
  if(obj&&obj!==S.selected) obj.material=M_HOV;
  wrap.style.cursor=obj&&S.mode==='select'?'pointer':'';
}

function setSelected(obj) {
  if(S.selected) { S.selected.material=S.selected.userData._mat; }
  S.selected=obj;
  if(obj) {
    obj.material=M_SEL;
    showSelHud(obj);
    showProps(obj);
    syncTreeSelection(obj.userData.tag);
    document.getElementById('sel-count').textContent='1';
  } else {
    selHud.classList.remove('show');
    document.getElementById('sel-count').textContent='0';
    document.getElementById('props-empty').style.display='';
    document.getElementById('props-content').style.display='none';
  }
}

function showSelHud(obj) {
  const ud=obj.userData;
  document.getElementById('sh-type').textContent=ud.type||'?';
  document.getElementById('sh-name').textContent=ud.tag||'—';
  document.getElementById('sh-len').textContent=ud.len||'—';
  document.getElementById('sh-od').textContent=ud.od||'—';
  document.getElementById('sh-line').textContent=ud.lineRef||'—';
  selHud.classList.add('show');
}

function showProps(obj) {
  const ud=obj.userData;
  const pos=new THREE.Vector3(); obj.getWorldPosition(pos);
  document.getElementById('props-empty').style.display='none';
  document.getElementById('props-content').style.display='';
  document.getElementById('prop-type-badge').textContent=ud.type||'?';
  document.getElementById('prop-tag').textContent=ud.tag||'—';
  document.getElementById('prop-pipeline').textContent=`${ud.pipelineRef||'—'} / ${ud.lineRef||'—'}`;
  document.getElementById('pr-from').textContent=ud.from||'—';
  document.getElementById('pr-to').textContent=ud.to||'—';
  document.getElementById('pr-len').textContent=ud.len||'—';
  document.getElementById('pr-od').textContent=ud.od||'—';
  document.getElementById('pr-wt').textContent=ud.wt||'—';
  document.getElementById('pr-t1').textContent=ud.T1||'—';
  document.getElementById('pr-t2').textContent=ud.T2||'—';
  document.getElementById('pr-p1').textContent=ud.P1||'—';
  document.getElementById('pr-spec').textContent=ud.spec||'—';
  document.getElementById('pr-skey').textContent=ud.skey||'—';
  document.getElementById('pr-x').textContent=pos.x.toFixed(3);
  document.getElementById('pr-y').textContent=pos.y.toFixed(3);
  document.getElementById('pr-z').textContent=pos.z.toFixed(3);
  // switch to props tab
  switchPanel('props');
}

/* ── Mode ─────────────────────────────────────────────────── */
const MODE_CHIP_CLASS = { orbit:'', select:'select', pan:'', measure:'measure', zoom:'' };

function setMode(m) {
  S.mode=m;
  controls.enableRotate = (m==='orbit');
  controls.enablePan    = (m==='orbit'||m==='pan');
  wrap.className='';
  wrap.classList.add(`m-${m}`);
  const chip=document.getElementById('mode-chip');
  chip.textContent=m.charAt(0).toUpperCase()+m.slice(1);
  chip.className='mode-chip '+(MODE_CHIP_CLASS[m]||'');
  // sync buttons
  document.querySelectorAll('.rb[data-mode]').forEach(b=>{
    b.classList.toggle('active', b.dataset.mode===m);
  });
}

/* ── ViewCube sync ────────────────────────────────────────── */
const RAD2DEG=180/Math.PI;

function syncViewCube() {
  const azi=controls.getAzimuthalAngle();
  const pol=controls.getPolarAngle();
  const rx=-(pol-Math.PI/2)*RAD2DEG;
  const ry=-azi*RAD2DEG;
  vc.style.transform=`rotateX(${rx}deg) rotateY(${ry}deg)`;
}

/* ── Axis Gizmo ───────────────────────────────────────────── */
const axVec = {
  x:new THREE.Vector3(1,0,0), y:new THREE.Vector3(0,1,0), z:new THREE.Vector3(0,0,1)
};

function syncAxisGizmo() {
  const cam=camera.clone();
  cam.updateMatrixWorld();
  const vMat=cam.matrixWorldInverse;
  const L=38;
  ['x','y','z'].forEach(ax=>{
    const v=axVec[ax].clone().applyMatrix4(vMat).normalize();
    const lx=v.x*L, ly=-v.y*L;
    const el=document.getElementById(`ax-${ax}`);
    const tl=document.getElementById(`ax-${ax}l`);
    if(el){ el.setAttribute('x2',lx.toFixed(1)); el.setAttribute('y2',ly.toFixed(1)); }
    if(tl){ tl.setAttribute('x',(lx*1.22).toFixed(1)); tl.setAttribute('y',(ly*1.22).toFixed(1)); }
  });
}

/* ── Coordinate readout ───────────────────────────────────── */
function updateCoords(e) {
  if(!e) { ['cx','cy','cz','sx','sy','sz'].forEach(id=>{ const el=document.getElementById(id); if(el)el.textContent='—'; }); return; }
  const hits=getHits(e);
  if(hits.length) {
    const p=hits[0].point;
    const vals=[(p.x*1000).toFixed(0),(p.y*1000).toFixed(0),(p.z*1000).toFixed(0)];
    ['cx','sx'].forEach(id=>{ const el=document.getElementById(id); if(el)el.textContent=vals[0]; });
    ['cy','sy'].forEach(id=>{ const el=document.getElementById(id); if(el)el.textContent=vals[1]; });
    ['cz','sz'].forEach(id=>{ const el=document.getElementById(id); if(el)el.textContent=vals[2]; });
  } else {
    ['cx','cy','cz','sx','sy','sz'].forEach(id=>{ const el=document.getElementById(id); if(el)el.textContent='—'; });
  }
}

/* ── Tree ─────────────────────────────────────────────────── */
const TREE_DATA = [
  { id:'root',  label:'1001-P-001', type:'root', color:'#4a9eff', count:18, children:[
    { id:'lineA', label:'1001-A-8"-CS', type:'line', color:'#66d9ff', count:11, children:[
      { id:'PIPE-A01',  label:'PIPE-A01',  type:'PIPE',    color:'#66d9ff' },
      { id:'PIPE-A02',  label:'PIPE-A02',  type:'PIPE',    color:'#66d9ff' },
      { id:'PIPE-A03',  label:'PIPE-A03',  type:'PIPE',    color:'#66d9ff' },
      { id:'PIPE-A04',  label:'PIPE-A04',  type:'PIPE',    color:'#66d9ff' },
      { id:'VLV-A01',   label:'VLV-A01',   type:'VALVE',   color:'#72e39a' },
      { id:'TEE-A01',   label:'TEE-A01',   type:'TEE',     color:'#ffe07a' },
      { id:'RED-A01',   label:'RED-A01',   type:'REDUCER', color:'#ff9dc7' },
      { id:'ELB-A01',   label:'ELB-A01',   type:'ELBOW',   color:'#d0a8ff' },
      { id:'ANCI-A01',  label:'ANCI-A01',  type:'ANCI',    color:'#ff7070' },
      { id:'FL-group-A',label:'Flanges (6)',type:'FLANGE',  color:'#ffb25c' },
    ]},
    { id:'lineB', label:'1001-B-4"-CS', type:'line', color:'#66d9ff', count:5, children:[
      { id:'PIPE-B01',  label:'PIPE-B01',  type:'PIPE',    color:'#66d9ff' },
      { id:'PIPE-B02',  label:'PIPE-B02',  type:'PIPE',    color:'#66d9ff' },
      { id:'ELB-B01',   label:'ELB-B01',   type:'ELBOW',   color:'#d0a8ff' },
      { id:'FL-group-B',label:'Flanges (3)',type:'FLANGE',  color:'#ffb25c' },
    ]},
    { id:'supports', label:'Supports', type:'group', color:'#60c864', count:3, children:[
      { id:'SUP-A01',   label:'SUP-A01',   type:'SUPPORT', color:'#60c864' },
      { id:'SUP-A02',   label:'SUP-A02',   type:'SUPPORT', color:'#60c864' },
      { id:'SUP-A03',   label:'SUP-A03',   type:'SUPPORT', color:'#60c864' },
    ]},
  ]}
];

function buildTreeHTML(nodes, depth=0) {
  return nodes.map(n=>{
    const hasChildren=n.children&&n.children.length;
    const indent = depth===0?'':depth===1?'i1':'i2';
    return `<div class="tn" id="tn-${n.id}">
      <div class="tn-row ${indent}" onclick="handleTreeClick('${n.id}',event)" data-tag="${n.id}">
        <span class="tn-toggle${hasChildren?' open':' leaf'}">▶</span>
        <input type="checkbox" class="tn-cb" checked onchange="handleVisCb('${n.id}',this.checked)" onclick="event.stopPropagation()">
        <span class="tn-dot" style="background:${n.color}"></span>
        <span class="tn-label">${n.label}</span>
        ${n.count?`<span class="tn-count">${n.count}</span>`:''}
      </div>
      ${hasChildren?`<div class="tn-children open">${buildTreeHTML(n.children,depth+1)}</div>`:''}
    </div>`;
  }).join('');
}

function populateTree() {
  document.getElementById('tree-root').innerHTML=buildTreeHTML(TREE_DATA);
  // expand/collapse toggles
  document.querySelectorAll('.tn-toggle:not(.leaf)').forEach(t=>{
    t.closest('.tn-row').addEventListener('click', e=>{
      if(e.target.matches('.tn-cb')||e.target.matches('input')) return;
      const ch=t.closest('.tn').querySelector('.tn-children');
      const open=ch.classList.toggle('open');
      t.classList.toggle('open',open);
    });
  });
}

window.handleTreeClick=(id,e)=>{
  if(e.target.matches('input')) return;
  const obj=allObjects.find(o=>o.userData.tag===id);
  if(obj) { setSelected(obj); }
};

window.handleVisCb=(id,checked)=>{
  allObjects.filter(o=>o.userData.tag===id||o.userData.tag?.startsWith(id)).forEach(o=>{
    o.visible=checked; o.userData._hidden=!checked;
  });
};

function syncTreeSelection(tag) {
  document.querySelectorAll('.tn-row').forEach(r=>r.classList.remove('selected'));
  const row=document.querySelector(`.tn-row[data-tag="${tag}"]`);
  if(row) row.classList.add('selected');
}

/* ── Search ───────────────────────────────────────────────── */
const FILTER_TYPES=['PIPE','FLANGE','VALVE','TEE','ELBOW','REDUCER','SUPPORT','ANCI'];
let activeFilters=new Set(FILTER_TYPES);

function populateSearchFilters() {
  const el=document.getElementById('search-filters');
  el.innerHTML=FILTER_TYPES.map(t=>`<div class="sf on" data-type="${t}">
    <span class="sf-dot" style="background:${COLORS[t]||'#888'}"></span>${t}
  </div>`).join('');
  el.querySelectorAll('.sf').forEach(sf=>{
    sf.addEventListener('click',()=>{
      const t=sf.dataset.type;
      if(activeFilters.has(t)) activeFilters.delete(t);
      else activeFilters.add(t);
      sf.classList.toggle('on', activeFilters.has(t));
      doSearch(document.getElementById('search-input').value);
    });
  });
}

function doSearch(q='') {
  const res=document.getElementById('search-results');
  if(!q.trim()&&activeFilters.size===FILTER_TYPES.length){res.innerHTML='';return;}
  const matches=allObjects.filter(o=>{
    const ud=o.userData;
    if(!activeFilters.has(ud.type)) return false;
    if(!q.trim()) return true;
    const ql=q.toLowerCase();
    return (ud.tag||'').toLowerCase().includes(ql)||(ud.type||'').toLowerCase().includes(ql)||(ud.lineRef||'').toLowerCase().includes(ql);
  });
  const seen=new Set();
  const unique=matches.filter(o=>{ const t=o.userData.tag; if(seen.has(t)) return false; seen.add(t); return true; });
  res.innerHTML=unique.slice(0,40).map(o=>`
    <div class="sr-item" onclick="handleSearchClick('${o.userData.tag}')">
      <span class="sr-dot" style="background:${COLORS[o.userData.type]||'#888'}"></span>
      <span class="sr-tag">${o.userData.tag}</span>
      <span class="sr-type">${o.userData.type}</span>
    </div>`).join('')||`<div style="padding:12px 10px;font-size:10px;color:var(--muted)">No results</div>`;
}

window.handleSearchClick=(tag)=>{
  const obj=allObjects.find(o=>o.userData.tag===tag);
  if(obj){ setSelected(obj); fitObjects([obj]); }
};

document.getElementById('search-input').addEventListener('input',e=>doSearch(e.target.value));
document.getElementById('tree-search').addEventListener('input',e=>{
  const q=e.target.value.toLowerCase().trim();
  document.querySelectorAll('.tn').forEach(node=>{
    const label=node.querySelector('.tn-label')?.textContent.toLowerCase()||'';
    node.style.display=(!q||label.includes(q))?'':'none';
  });
});

/* ── Camera snapping ──────────────────────────────────────── */
const SNAP_PRESETS = {
  front:[0,0,1], back:[0,0,-1], right:[1,0,0], left:[-1,0,0],
  top:[0,1,0], bottom:[0,-1,0],
  nw:[-1,1,-1], ne:[1,1,-1], sw:[-1,-1,1], se:[1,-1,1]
};

function snapTo(key) {
  const dir=SNAP_PRESETS[key]; if(!dir) return;
  const dist=camera.position.distanceTo(controls.target)||14;
  const target=controls.target.clone();
  const d=new THREE.Vector3(...dir).normalize();
  const pos=target.clone().addScaledVector(d,dist);
  animateCamera(pos, target);
}

function animateCamera(toPos, toTarget, dur=500) {
  const fromPos=camera.position.clone(), fromTarget=controls.target.clone();
  const start=performance.now();
  function tick(now) {
    const t=Math.min((now-start)/dur,1);
    const e=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
    camera.position.lerpVectors(fromPos,toPos,e);
    controls.target.lerpVectors(fromTarget,toTarget,e);
    controls.update();
    if(t<1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function fitObjects(objs) {
  if(!objs||!objs.length) return;
  const box=new THREE.Box3();
  objs.forEach(o=>box.expandByObject(o));
  const center=new THREE.Vector3(); box.getCenter(center);
  const size=new THREE.Vector3(); box.getSize(size);
  const maxDim=Math.max(size.x,size.y,size.z,0.1);
  const fov=camera.fov*(Math.PI/180);
  const dist=Math.abs(maxDim/2/Math.tan(fov/2))*1.6;
  const dir=camera.position.clone().sub(controls.target).normalize();
  animateCamera(center.clone().addScaledVector(dir,dist), center);
}

function fitAll() { fitObjects(allObjects.filter(o=>o.visible&&o.userData.type)); }

/* ── Panels ───────────────────────────────────────────────── */
function switchPanel(id) {
  document.querySelectorAll('.rp-tab').forEach(t=>t.classList.toggle('active',t.dataset.panel===id));
  document.querySelectorAll('.rp-content').forEach(c=>c.classList.toggle('active',c.id===`panel-${id}`));
}

document.querySelectorAll('.rp-tab').forEach(t=>{
  t.addEventListener('click',()=>switchPanel(t.dataset.panel));
});

function updateCompCount() {
  const n=allObjects.filter(o=>o.userData.type).length;
  document.getElementById('comp-count').textContent=n;
}

/* ── Context menu ─────────────────────────────────────────── */
function showCtx(x,y) {
  ctxMenu.style.left=x+'px'; ctxMenu.style.top=y+'px';
  ctxMenu.classList.add('show');
}
function hideCtx() { ctxMenu.classList.remove('show'); }

ctxMenu.querySelectorAll('.ci').forEach(item=>{
  item.addEventListener('click',()=>{
    const a=item.dataset.action;
    if(a==='fit-sel') fitObjects(S.selected?[S.selected]:null);
    if(a==='isolate') doIsolate();
    if(a==='hide')    doHide();
    if(a==='show-all') doShowAll();
    if(a==='deselect') setSelected(null);
    if(a==='properties'&&S.selected) showProps(S.selected);
    if(a==='select-all-type'&&S.selected) selectAllOfType(S.selected.userData.type);
    hideCtx();
  });
});

function doIsolate() {
  if(!S.selected) return;
  const keepType=S.selected.userData.type;
  allObjects.forEach(o=>{ o.visible=o.userData.type===keepType; o.userData._hidden=!o.visible; });
}
function doHide() {
  if(!S.selected) return;
  S.selected.visible=false; S.selected.userData._hidden=true; setSelected(null);
}
function doShowAll() {
  allObjects.forEach(o=>{ o.visible=true; o.userData._hidden=false; });
  document.querySelectorAll('.tn-cb,.vis-cb').forEach(cb=>cb.checked=true);
}
function selectAllOfType(type) {
  const objs=allObjects.filter(o=>o.userData.type===type&&!o.userData._hidden);
  objs.forEach(o=>{o.material=M_SEL;});
}

/* ── Keyboard ─────────────────────────────────────────────── */
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea,select')) return;
  const k=e.key;
  if(k==='o'||k==='O') setMode('orbit');
  if(k==='s'||k==='S') setMode('select');
  if(k==='p'||k==='P') setMode('pan');
  if(k==='m'||k==='M') setMode('measure');
  if(k==='f'||k==='F') { e.shiftKey&&S.selected?fitObjects([S.selected]):fitAll(); }
  if(k==='h'||k==='H') animateCamera(new THREE.Vector3(10,7,14), new THREE.Vector3(0,0,0));
  if(k==='g'||k==='G') toggleGrid();
  if(k==='i'||k==='I') doIsolate();
  if(k==='Delete')      doHide();
  if(k==='Escape')      { setSelected(null); hideCtx(); kbdHelp.classList.remove('show'); }
  if(k==='?')           kbdHelp.classList.toggle('show');
  if(k==='7') snapTo('nw'); if(k==='9') snapTo('ne');
  if(k==='1') snapTo('sw'); if(k==='3') snapTo('se');
});

/* ── Ribbon wiring ────────────────────────────────────────── */
function rb(id,fn) { const el=document.getElementById(id); if(el)el.addEventListener('click',fn); }

rb('rb-select',()=>setMode('select'));
rb('rb-orbit', ()=>setMode('orbit'));
rb('rb-pan',   ()=>setMode('pan'));
rb('rb-zoom',  ()=>setMode('zoom'));
rb('rb-measure',()=>setMode('measure'));
rb('rb-fitall',()=>fitAll());
rb('rb-fitsel',()=>{ if(S.selected) fitObjects([S.selected]); });
rb('rb-home',  ()=>animateCamera(new THREE.Vector3(10,7,14), new THREE.Vector3(0,0,0)));
rb('rb-proj',  ()=>{ camera.fov=camera.fov===45?1:45; camera.updateProjectionMatrix(); document.getElementById('rb-proj').classList.toggle('active',camera.fov===1); });
rb('rb-nw',    ()=>snapTo('nw')); rb('rb-ne',()=>snapTo('ne'));
rb('rb-sw',    ()=>snapTo('sw')); rb('rb-se',()=>snapTo('se'));
rb('rb-top',   ()=>snapTo('top')); rb('rb-front',()=>snapTo('front'));
rb('rb-grid',  ()=>toggleGrid());
rb('rb-wire',  ()=>toggleWireframe());
rb('rb-xray',  ()=>toggleXray());
rb('rb-isolate',()=>doIsolate());
rb('rb-hide',  ()=>doHide());
rb('rb-showall',()=>doShowAll());

function toggleGrid() {
  S.grid=!S.grid; gridHelper.visible=S.grid;
  document.getElementById('rb-grid').classList.toggle('active',S.grid);
}
function toggleWireframe() {
  S.wire=!S.wire;
  allObjects.forEach(o=>{ if(o.material) o.material.wireframe=S.wire; });
  document.getElementById('rb-wire').classList.toggle('active',S.wire);
}
function toggleXray() {
  S.xray=!S.xray;
  allObjects.forEach(o=>{ if(o.material&&o!==S.selected){ o.material.transparent=S.xray; o.material.opacity=S.xray?.35:1; }});
  document.getElementById('rb-xray').classList.toggle('active',S.xray);
}

rb('rb-collapse',()=>{
  const btn=document.getElementById('rb-collapse');
  const rib=document.getElementById('ribbon');
  btn.classList.toggle('closed');
  rib.style.maxHeight=btn.classList.contains('closed')?'0':'200px';
  rib.style.overflow=btn.classList.contains('closed')?'hidden':'auto';
});

rb('lp-toggle',()=>{
  const p=document.getElementById('lpanel');
  const t=document.getElementById('lp-toggle');
  p.classList.toggle('closed'); t.classList.toggle('closed');
});

rb('kh-close',()=>kbdHelp.classList.remove('show'));
rb('help-btn',()=>kbdHelp.classList.toggle('show'));

// ViewCube face clicks
document.querySelectorAll('.vc-f').forEach(face=>{
  face.addEventListener('click',e=>{ e.stopPropagation(); snapTo(face.dataset.snap); });
});

// Left panel range readouts
[['lp-ov-scale','lp-ov-val','x','100',.01],
 ['lp-bp-val',  'lp-bp-val','', '0',  1],
 ['lp-po-val',  'lp-po-val','', '0',  1],
 ['lp-sup-scale','lp-ss-val','x','200',.01]].forEach(([src,dst,sfx,def,mult])=>{
  const inp=document.getElementById(src==='lp-bp-val'?'lp-box-pad':src==='lp-po-val'?'lp-plane-off':src);
  if(!inp) return;
  inp.addEventListener('input',()=>{
    const el=document.getElementById(dst);
    if(el) el.textContent=(parseFloat(inp.value)*mult).toFixed(2)+sfx;
  });
});

// Visibility checkboxes
document.querySelectorAll('.vis-cb').forEach(cb=>{
  cb.addEventListener('change',()=>{
    const type=cb.dataset.type;
    allObjects.filter(o=>o.userData.type===type).forEach(o=>{o.visible=cb.checked;o.userData._hidden=!cb.checked;});
  });
});

/* ── Mouse events ─────────────────────────────────────────── */
canvas.addEventListener('mousemove', e=>{
  updateCoords(e);
  if(S.mode==='select'||S.mode==='measure') {
    const hits=getHits(e);
    setHover(hits.length?hits[0].object:null);
  }
});

canvas.addEventListener('click',e=>{
  if(S.mode==='select') {
    const hits=getHits(e);
    setSelected(hits.length&&hits[0].object.userData.type?hits[0].object:null);
  }
});

canvas.addEventListener('mouseleave',()=>{ setHover(null); updateCoords(null); });

canvas.addEventListener('contextmenu',e=>{
  e.preventDefault();
  const rect=wrap.getBoundingClientRect();
  const x=e.clientX-rect.left, y=e.clientY-rect.top;
  // adjust to stay in bounds
  const mx=Math.min(x, wrap.clientWidth-200);
  const my=Math.min(y, wrap.clientHeight-300);
  showCtx(mx,my);
});

document.addEventListener('click',e=>{ if(!ctxMenu.contains(e.target)) hideCtx(); });

/* ── FPS ──────────────────────────────────────────────────── */
function updateFPS(now) {
  S._fc++;
  if(now-S._ft>1000) {
    S.fps=S._fc; S._fc=0; S._ft=now;
    const tri=Math.round(renderer.info.render.triangles/1000);
    document.getElementById('sb-fps').textContent=`${S.fps}fps · ${tri}K tri`;
  }
}

/* ── Init ─────────────────────────────────────────────────── */
buildModel();

/* ── Animation loop ───────────────────────────────────────── */
function animate(t) {
  requestAnimationFrame(animate);
  controls.update();
  syncViewCube();
  syncAxisGizmo();
  updateFPS(t);
  renderer.render(scene,camera);
}
animate(0);

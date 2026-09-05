const DATA_SCHEMA='1.0';
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);

let jobs=[];
let applications=[];
let sources=[];
let runStatus=null;
let canonicalConfig=null;
let savedCriteria=null;
let draftExclusions=[];
let view='jobs',active='all',visible=[];

async function fetchJson(path,token=null){
  const headers={};
  if(token)headers.Authorization=`Bearer ${token}`;
  const response=await fetch(path,{headers,cache:'no-store'});
  if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function validateContract(payload,name){
  if(payload?.schema_version!==DATA_SCHEMA)throw new Error(`${name}: versiune contract ${payload?.schema_version||'lipsa'}; asteptat ${DATA_SCHEMA}`);
}

function criteriaFromConfig(config){
  const groups=config?.role_groups||{};
  const modes=config?.work_modes||{};
  return {
    rolePm:groups.pm?.enabled!==false,
    roleDelivery:groups.delivery?.enabled!==false,
    roleService:groups.service?.enabled!==false,
    roleScrum:groups.scrum?.enabled!==false,
    roleProgram:groups.program?.enabled!==false,
    workRemote:modes.remote!==false,
    workHybrid:modes.hybrid!==false,
    freshness:String(config?.freshness_hours??24),
    fitThreshold:String(config?.fit_threshold??80),
    keepReposts:config?.keep_reposts!==false,
    rateMin:String(config?.rate_min_eur_day??250),
    rateMax:String(config?.rate_max_eur_day??650),
    immediateStart:config?.immediate_start!==false,
    exclusions:Array.isArray(config?.exclusions)?[...config.exclusions]:[]
  };
}

function ageHours(value){
  if(!value)return 0;
  const ms=Date.now()-new Date(value).getTime();
  return Number.isFinite(ms)?Math.max(0,Math.floor(ms/3600000)):0;
}

function normalizeMode(value){
  const raw=String(value||'').trim().toLowerCase();
  if(raw==='remote')return 'Remote';
  if(raw==='hybrid')return 'Hybrid';
  if(['onsite','on-site','office','in-office'].includes(raw))return 'Onsite';
  return 'N/A';
}

function normalizeJob(j){
  return {
    id:j.id||null,
    title:j.title||'Titlu indisponibil',
    company:j.company||'Companie nespecificata',
    initial:j.initial||((j.company||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'?'),
    fit:Number.isFinite(Number(j.fit))?Number(j.fit):0,
    location:j.location||'Nespecificat',
    mode:normalizeMode(j.mode),
    type:j.type||'Nespecificat',
    age:Number.isFinite(Number(j.age))?Number(j.age):ageHours(j.date_posted),
    remote:Boolean(j.remote),
    b2b:Boolean(j.b2b),
    repost:Boolean(j.repost),
    status:j.status||'review',
    pros:Array.isArray(j.pros)?j.pros:[],
    risks:Array.isArray(j.risks)?j.risks:[],
    url:j.url||null,
    description:(j.description||'').trim(),
    date_posted:j.date_posted||null,
    source:j.source||'Nespecificata',
    verified_at:j.verified_at||null,
    isApplication:false
  };
}

function normalizeApplication(a){
  const ref=a.reference?`Referinta: ${a.reference}`:'Referinta nespecificata';
  const next=a.next_status_check?`Urmatorul status check: ${a.next_status_check}`:'Status check nespecificat';
  return {
    title:a.title||'Rol nespecificat',company:a.company||'Companie nespecificata',initial:(a.company||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'?',
    fit:null,location:a.location||'Nespecificat',mode:'N/A',type:'Aplicat',age:0,remote:false,b2b:false,repost:false,status:'applied',
    pros:[`Aplicat: ${a.applied_at||'data nespecificata'}`,ref],risks:[next],url:a.url||null,description:`Status: ${a.status||'applied'}. ${ref}. ${next}.`,source:'Istoric aplicari',date_posted:a.applied_at||null,isApplication:true
  };
}

async function loadData(token){
  if(!token)throw new Error('Autentificarea este necesara pentru incarcarea datelor.');
  const [jobPayload,statusPayload,applicationPayload,sourcePayload,configPayload]=await Promise.all([
    fetchJson('./data/jobs.json',token),
    fetchJson('./data/run-status.json',token),
    fetchJson('./data/applications.json',token),
    fetchJson('./data/sources.json',token),
    fetchJson('./data/search-config.json',token)
  ]);
  validateContract(jobPayload,'jobs.json');
  validateContract(statusPayload,'run-status.json');
  validateContract(configPayload,'search-config.json');
  canonicalConfig=configPayload;
  const localCriteria=JSON.parse(localStorage.getItem('selectionCriteria')||'null');
  savedCriteria=localCriteria||criteriaFromConfig(canonicalConfig);
  draftExclusions=[...(savedCriteria.exclusions||[])];
  jobs=(jobPayload.jobs||[]).map(normalizeJob);
  applications=(applicationPayload.applications||[]).map(normalizeApplication);
  sources=(sourcePayload.sources||[]).map(s=>({category:s.category||'Altele',name:s.name||'Sursa',url:s.url||'#',active:s.active!==false}));
  runStatus=statusPayload;
  updateRunStatus();
}

function restoreLocalSourceState(){
  try{
    const localSourceState=JSON.parse(localStorage.getItem('sourceState')||'null');
    if(localSourceState)sources.forEach(s=>{if(Object.hasOwn(localSourceState,s.url))s.active=Boolean(localSourceState[s.url])});
  }catch(error){console.error('Starea locala a surselor nu a putut fi restaurata',error)}
}

function clearProtectedClientData(){
  jobs=[];applications=[];sources=[];runStatus=null;canonicalConfig=null;savedCriteria=null;draftExclusions=[];visible=[];
  const jobList=$('#jobList');if(jobList)jobList.innerHTML='';
  const empty=$('#empty');if(empty){empty.hidden=true;empty.textContent='Niciun rol nu corespunde filtrelor.'}
  ['countJobs','countReview','countApplications','metricJobs','metricHigh','metricReposts','metricRemote','filterAll','filterHigh','filterB2b'].forEach(id=>{const el=$('#'+id);if(el)el.textContent='0'});
  const runState=$('#runState');if(runState)runState.textContent='Monitor';
  const lastRun=$('#lastRun');if(lastRun)lastRun.textContent='Ultima rulare: se incarca...';
}

function updateRunStatus(){
  const statusMap={completed:'Monitor activ',completed_with_errors:'Finalizat cu erori',failed:'Ultima rulare esuata',running:'Verificare in curs'};
  const strong=$('#runState'),small=$('#lastRun');
  if(strong)strong.textContent=statusMap[runStatus?.status]||'Monitor';
  if(small){
    const value=runStatus?.completed_at||runStatus?.started_at;
    small.textContent=value?`Ultima rulare: ${new Intl.DateTimeFormat('ro-RO',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Bucharest'}).format(new Date(value))}`:'Ultima rulare: necunoscuta';
  }
}

function setHeaderDate(){
  const el=$('#currentDate');
  if(el)el.textContent=new Intl.DateTimeFormat('ro-RO',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Bucharest'}).format(new Date()).toUpperCase();
}

function baseRows(){return view==='applications'?applications:view==='review'?jobs.filter(j=>j.status==='review'):jobs}

function selectedWorkModes(){return new Set($$('.work-mode-filter:checked').map(x=>x.value))}

function globalFilteredRows(rows){
  if(view==='applications')return rows;
  const freshness=Number($('#freshnessFilter')?.value||savedCriteria?.freshness||24);
  const modes=selectedWorkModes();
  return rows.filter(j=>j.isApplication||(j.age<=freshness&&modes.has(j.mode)));
}

function updateWorkModeLabel(){
  const boxes=[...$$('.work-mode-filter')];
  const selected=boxes.filter(x=>x.checked);
  const label=$('#workModeLabel');
  if(!label)return;
  if(selected.length===boxes.length){label.textContent='Mod lucru: Toate';return;}
  if(selected.length===0){label.textContent='Mod lucru: Niciunul';return;}
  label.textContent=`Mod lucru: ${selected.map(x=>x.dataset.label||x.value).join(', ')}`;
}

function updateFreshnessLabel(){
  const hours=Number($('#freshnessFilter')?.value||24);
  const label=$('#metricFreshnessLabel');
  if(label)label.textContent=hours===120?'ultimele 5 zile':`ultimele ${hours}h`;
}

function setCounts(){
  const threshold=Number(savedCriteria?.fitThreshold||80);
  const base=globalFilteredRows(baseRows());
  const allJobs=globalFilteredRows(jobs);
  $('#countJobs').textContent=jobs.length;
  $('#countReview').textContent=jobs.filter(j=>j.status==='review').length;
  $('#countApplications').textContent=applications.length;
  $('#metricJobs').textContent=allJobs.length;
  $('#metricHigh').textContent=allJobs.filter(j=>j.fit>=threshold).length;
  $('#metricReposts').textContent=allJobs.filter(j=>j.repost).length;
  $('#metricRemote').textContent=allJobs.filter(j=>j.mode==='Remote').length;
  $('#filterAll').textContent=base.length;
  $('#filterHigh').textContent=base.filter(j=>!j.isApplication&&j.fit>=threshold).length;
  $('#filterB2b').textContent=base.filter(j=>j.b2b).length;
  updateFreshnessLabel();updateWorkModeLabel();
}

function renderJobs(){
  const q=($('#search').value||'').toLowerCase();
  const threshold=Number(savedCriteria?.fitThreshold||80);
  visible=globalFilteredRows(baseRows()).filter(j=>{
    const filterOk=active==='all'||active==='high'&&!j.isApplication&&j.fit>=threshold||active==='b2b'&&j.b2b;
    const text=`${j.title} ${j.company} ${j.description} ${j.source}`.toLowerCase();
    return filterOk&&text.includes(q);
  });
  const sortValue=$('#sort')?.value||'fit-desc';
  visible.sort(sortValue==='fit-asc'?(a,b)=>(a.fit??Number.MAX_SAFE_INTEGER)-(b.fit??Number.MAX_SAFE_INTEGER)||a.age-b.age:(a,b)=>(b.fit??-1)-(a.fit??-1)||a.age-b.age);
  $('.table-head').innerHTML='<span>ROL</span><span>FIT</span><span>MOD DE LUCRU</span><span>PUBLICAT</span><span></span>';
  $('#jobList').innerHTML=visible.map((j,i)=>{
    const score=j.fit===null?'—':`${j.fit}%`;
    const posted=j.isApplication?(j.date_posted?`aplicat ${j.date_posted}`:'aplicat'):`acum ${j.age}h`;
    return `<article class="job" data-index="${i}"><div class="role"><span class="company-logo">${escapeHtml(j.initial)}</span><div><strong>${escapeHtml(j.title)}</strong><div class="meta"><span>${escapeHtml(j.company)} · ${escapeHtml(j.location)}</span>${j.repost?'<span class="tag repost">Repostare</span>':''}<span class="tag">${escapeHtml(j.type)}</span></div></div></div><span class="score ${j.fit!==null&&j.fit>=threshold?'high':'mid'}">${score}</span><span class="mode">${escapeHtml(j.mode)}</span><span class="posted">${escapeHtml(posted)}</span><span class="chev">›</span></article>`;
  }).join('');
  $('#empty').textContent=jobs.length===0&&view!=='applications'?'Ultima rulare nu a publicat niciun job eligibil.':'Niciun rol nu corespunde filtrelor.';
  $('#empty').hidden=visible.length>0;
  $$('.job').forEach(el=>el.onclick=()=>openJob(visible[+el.dataset.index]));
}

function renderSources(){
  const q=($('#sourceSearch').value||'').toLowerCase(),sort=$('#sourceSort').value;
  let rows=sources.filter(s=>`${s.name} ${s.category}`.toLowerCase().includes(q));
  rows.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):Number(b.active)-Number(a.active)||a.name.localeCompare(b.name));
  const groups=rows.reduce((acc,s)=>((acc[s.category]??=[]).push(s),acc),{});
  $('.table-head').innerHTML='<span>LISTE DE SURSE</span>';
  $('#jobList').innerHTML=Object.entries(groups).map(([category,items])=>`<details class="source-group" open><summary><strong>${escapeHtml(category)}</strong><small>${items.length} surse</small></summary><div class="source-items">${items.map(s=>`<div class="source-item"><div><a href="${escapeAttribute(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)} ↗</a></div><label class="switch-label"><input class="source-toggle" type="checkbox" data-url="${escapeAttribute(s.url)}" ${s.active?'checked':''}> Activa</label></div>`).join('')}</div></details>`).join('');
  $('#empty').hidden=rows.length>0;
  $$('.source-toggle').forEach(x=>x.onchange=()=>{
    const source=sources.find(v=>v.url===x.dataset.url);if(source)source.active=x.checked;
    localStorage.setItem('sourceState',JSON.stringify(Object.fromEntries(sources.map(s=>[s.url,s.active]))));
    toast('Starea sursei este salvata local; sincronizarea cu workflow-ul depinde de ARCH #19.');
  });
}

function currentCriteria(){
  const c={};
  ['rolePm','roleDelivery','roleService','roleScrum','roleProgram','workRemote','workHybrid','keepReposts','immediateStart'].forEach(id=>c[id]=$('#'+id).checked);
  c.freshness=Number($('#freshness').value);c.fitThreshold=Number($('#fitThreshold').value);c.exclusions=[...draftExclusions];return c;
}

function previewCriteria(){
  const c=currentCriteria();
  const rows=jobs.filter(j=>{
    const t=j.title.toLowerCase();
    const role=t.includes('scrum')?c.roleScrum:t.includes('program')||t.includes('programme')||t.includes('pmo')?c.roleProgram:t.includes('service')?c.roleService:t.includes('delivery')||t.includes('technical')?c.roleDelivery:c.rolePm;
    const mode=j.mode==='Remote'?c.workRemote:j.mode==='Hybrid'?c.workHybrid:true;
    const fresh=j.age<=c.freshness;
    const repost=c.keepReposts||!j.repost;
    const excluded=c.exclusions.some(x=>{const q=x.toLowerCase();return(q.includes('star storage')&&j.company.toLowerCase().includes('star storage'))||(q.includes('erp')&&t.includes('erp'))||(q.includes('non-it')&&!t.match(/project|program|programme|pmo|scrum|service|delivery|technical|it/))});
    return role&&mode&&fresh&&repost&&!excluded;
  });
  $('#metricJobs').textContent=rows.length;$('#metricHigh').textContent=rows.filter(j=>j.fit>=c.fitThreshold).length;$('#metricReposts').textContent=rows.filter(j=>j.repost).length;$('#metricRemote').textContent=rows.filter(j=>j.mode==='Remote').length;$('#metricHigh').closest('article').querySelector('em').textContent=`>= ${c.fitThreshold}%`;
}

function render(){setCounts();if(view==='criteria')previewCriteria();else if(view==='sources')renderSources();else renderJobs()}

function openJob(j){
  $('#drawerTitle').textContent=j.title;
  $('#drawerCompany').textContent=`${j.company} · ${j.location} · ${j.source}`;
  $('#drawerScore').textContent=j.fit===null?'—':`${j.fit}%`;
  $('#pros').innerHTML=(j.pros.length?j.pros:['Nu exista argumente generate.']).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  $('#risks').innerHTML=(j.risks.length?j.risks:['Nu exista riscuri generate.']).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  $('#drawerDescription').textContent=j.description||'Descrierea pozitiei nu este disponibila din sursa.';
  const a=$('#applyLink');a.textContent=j.url?'Deschide jobul ↗':'Link de aplicare indisponibil';
  if(j.url){a.href=j.url;a.classList.remove('disabled')}else{a.removeAttribute('href');a.classList.add('disabled')}
  $('#drawer').classList.add('open');$('#drawer').setAttribute('aria-hidden','false');$('#scrim').classList.add('open');
}

function close(){$('#drawer').classList.remove('open');$('#drawer').setAttribute('aria-hidden','true');$('#scrim').classList.remove('open')}
function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000)}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function escapeAttribute(value){return escapeHtml(value)}
function markCriteriaDirty(){$('#criteriaState').textContent='Modificari nesalvate';$('#criteriaState').classList.add('dirty');previewCriteria()}
function renderExclusions(){$('#selectedExclusions').innerHTML=draftExclusions.length?draftExclusions.map((x,i)=>`<button type="button" class="exclusion-chip" data-index="${i}">${escapeHtml(x)}<span aria-hidden="true">×</span></button>`).join(''):'<span class="empty-selection">Nicio excludere selectata.</span>';$$('.exclusion-chip').forEach(x=>x.onclick=()=>{draftExclusions.splice(+x.dataset.index,1);markCriteriaDirty();renderExclusions()})}

function loadCriteria(){
  const fallback=criteriaFromConfig(canonicalConfig||{}),c=savedCriteria||fallback;
  ['rolePm','roleDelivery','roleService','roleScrum','roleProgram','workRemote','workHybrid','keepReposts','immediateStart'].forEach(id=>$('#'+id).checked=c[id]??fallback[id]);
  $('#freshness').value=String(c.freshness||fallback.freshness||'24');
  if($('#freshnessFilter'))$('#freshnessFilter').value=String(c.freshness||fallback.freshness||'24');
  $('#fitThreshold').value=String(c.fitThreshold||fallback.fitThreshold||'80');
  $('#rateMin').value=String(c.rateMin||fallback.rateMin||'250');
  $('#rateMax').value=String(c.rateMax||fallback.rateMax||'650');
  renderExclusions();updateFreshnessLabel();updateWorkModeLabel();
}

function bindUi(){
  $$('.nav[data-view]').forEach(btn=>btn.onclick=()=>{$$('.nav[data-view]').forEach(x=>x.classList.remove('active'));btn.classList.add('active');view=btn.dataset.view;active='all';$('h1').textContent={jobs:'Joburi noi',review:'De evaluat',applications:'Aplicari',criteria:'Criterii de selectie',sources:'Surse'}[view];$('.summary').hidden=!['jobs','criteria'].includes(view);$('.toolbar:not(.source-toolbar)').hidden=!['jobs','review'].includes(view);$('#sourceToolbar').hidden=view!=='sources';$('#criteriaPanel').hidden=view!=='criteria';$('.workspace').hidden=view==='criteria';$('#runSearch').hidden=view==='criteria';render()});
  $$('.filter').forEach(btn=>btn.onclick=()=>{const current=$('.filter.active');if(current)current.classList.remove('active');btn.classList.add('active');active=btn.dataset.filter;render()});
  $('#search').oninput=render;$('#sort').onchange=render;$('#freshnessFilter').onchange=render;
  $$('.work-mode-filter').forEach(box=>box.onchange=()=>{updateWorkModeLabel();render()});
  $('#sourceSearch').oninput=renderSources;$('#sourceSort').onchange=renderSources;
  $('#closeDrawer').onclick=close;$('#scrim').onclick=close;document.onkeydown=e=>e.key==='Escape'&&close();
  document.addEventListener('click',e=>{const details=$('#workModeFilter');if(details?.open&&!details.contains(e.target))details.open=false});
  $('#runSearch').onclick=()=>toast('Rularea din interfata necesita trigger-ul securizat ARCH #19. Cautarea automata ramane activa de doua ori pe zi.');
  $('#criteriaPanel').addEventListener('change',markCriteriaDirty);$('#criteriaPanel').addEventListener('input',markCriteriaDirty);
  $('#exclusionSuggestions').onchange=e=>{if(e.target.value&&!draftExclusions.includes(e.target.value)){draftExclusions.push(e.target.value);markCriteriaDirty();renderExclusions()}e.target.value=''};
  $('#saveCriteria').onclick=()=>{const c=currentCriteria();c.rateMin=$('#rateMin').value;c.rateMax=$('#rateMax').value;savedCriteria=c;localStorage.setItem('selectionCriteria',JSON.stringify(c));$('#criteriaState').textContent='Preferinte salvate local';$('#criteriaState').classList.remove('dirty');if($('#freshnessFilter'))$('#freshnessFilter').value=String(c.freshness);render();toast('Preferintele sunt salvate local. Configuratia canonica este data/search-config.json; scrierea securizata este urmarita in ARCH #19.');};
}

function init(){
  setHeaderDate();bindUi();clearProtectedClientData();
}

init();

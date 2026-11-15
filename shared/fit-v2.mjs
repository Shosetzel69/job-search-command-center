// #88 FIT v2: deterministic, per-profile, explicit source evidence only.
export const FIT_CRITERIA=Object.freeze(['compensation','work_mode','contract_type','industry','career','company']);
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(v,k)=>Object.hasOwn(v,k);
const norm=v=>typeof v==='string'?v.normalize('NFKC').trim().toLowerCase():'';
const fail=()=>{throw Object.assign(new Error('Invalid FIT v2 configuration'),{status:400});};
export function normalizeFitConfig(input){
 if(input===null)return null;
 if(!obj(input)||Object.keys(input).length!==6||!FIT_CRITERIA.every(k=>own(input,k)))fail();
 const out={};let total=0;
 for(const key of FIT_CRITERIA){
  const c=input[key];if(!obj(c)||!Number.isInteger(c.weight)||c.weight<0||c.weight>100)fail();
  total+=c.weight;
  if(!c.weight){out[key]={weight:0};continue;}
  if(key==='compensation'){
   out[key]={weight:c.weight};
  }else{
   if(!obj(c.ratings)||!Object.keys(c.ratings).length||Object.keys(c.ratings).length>50)fail();
   const entries=Object.entries(c.ratings).map(([label,value])=>[norm(label),value]);
   if(entries.some(([k,v])=>!k||k.length>160||!Number.isInteger(v)||v<0||v>5)||new Set(entries.map(x=>x[0])).size!==entries.length)fail();
   out[key]={weight:c.weight,ratings:Object.fromEntries(entries)};
  }
 }
 if(total!==100)fail();
 return out;
}
export function evaluateFitV2(input,evidence={}){
 let config;try{config=normalizeFitConfig(input??null);}catch{return {score:null,matrix:[],state:'UNCONFIGURED'};}
 if(!config)return {score:null,matrix:[],state:'UNCONFIGURED'};
 const matrix=FIT_CRITERIA.map(key=>{
  const c=config[key],raw=evidence[key];let grade=0,reason='MISSING_DATA',observed=null;
  if(!c.weight)reason='DISABLED';
  else if(key==='compensation'){
   // Presence of a confirmed numerical compensation, regardless of currency or period.
   const amounts=typeof raw==='number'?[raw]:obj(raw)?[raw.amount,raw.minimum,raw.maximum]:[];
   const amount=amounts.find(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0);
   if(amount!==undefined){observed=raw;grade=5;reason='MATCH';}
  }else{
   const vals=[...new Set((Array.isArray(raw)?raw:[raw]).map(norm).filter(v=>v&&!['unknown','n/a','unspecified','nespecificat'].includes(v)))];
   if(vals.length){observed=vals;grade=Math.max(0,...vals.map(v=>own(c.ratings,v)?c.ratings[v]:0));reason=grade?'MATCH':'NO_MATCH';}
  }
  return {criterion:key,weight:c.weight,grade,points:c.weight*grade/5,reason,observed};
 });
 return {score:Math.round(matrix.reduce((s,v)=>s+v.points,0)*10)/10,matrix,state:'CONFIGURED'};
}

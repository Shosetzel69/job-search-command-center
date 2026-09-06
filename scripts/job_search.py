#!/usr/bin/env python3
"""Canonical job normalization, geography filtering and scoring."""
from __future__ import annotations
import json, math, os, re, sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/'data'; CONFIG_PATH=DATA/'search-config.json'; JOBS_PATH=DATA/'jobs.json'; STATUS_PATH=DATA/'run-status.json'; SCHEMA_VERSION='1.0'
EU={'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'}
ASIA={'AF','AM','AZ','BH','BD','BT','BN','KH','CN','GE','HK','IN','ID','IR','IQ','IL','JP','JO','KZ','KW','KG','LA','LB','MO','MY','MV','MN','MM','NP','KP','OM','PK','PS','PH','QA','SA','SG','KR','LK','SY','TW','TJ','TH','TL','TR','TM','AE','UZ','VN','YE'}
REGIONS={'EU':EU,'US':{'US'},'ASIA':ASIA}
NAMES={'RO':'Romania','BE':'Belgia','LU':'Luxemburg','FR':'Franta','DE':'Germania','NL':'Tarile de Jos','PL':'Polonia','PT':'Portugalia','ES':'Spania','IT':'Italia','IE':'Irlanda','AT':'Austria','CZ':'Cehia','SK':'Slovacia','HU':'Ungaria','BG':'Bulgaria','GR':'Grecia','HR':'Croatia','SI':'Slovenia','EE':'Estonia','LV':'Letonia','LT':'Lituania','DK':'Danemarca','SE':'Suedia','FI':'Finlanda','NO':'Norvegia','CH':'Elvetia','CY':'Cipru','MT':'Malta','US':'Statele Unite','GB':'Regatul Unit','UA':'Ucraina','TR':'Turcia','AE':'Emiratele Arabe Unite','IN':'India','CN':'China','JP':'Japonia','SG':'Singapore','KR':'Coreea de Sud','HK':'Hong Kong','IL':'Israel','SA':'Arabia Saudita','QA':'Qatar','MY':'Malaezia','TH':'Thailanda','VN':'Vietnam','ID':'Indonezia','PH':'Filipine','PK':'Pakistan','BD':'Bangladesh'}
NAME_CODE={v.lower():k for k,v in NAMES.items()}; NAME_CODE.update({'belgium':'BE','france':'FR','germany':'DE','netherlands':'NL','poland':'PL','portugal':'PT','spain':'ES','italy':'IT','ireland':'IE','austria':'AT','czech republic':'CZ','czechia':'CZ','slovakia':'SK','hungary':'HU','bulgaria':'BG','greece':'GR','croatia':'HR','slovenia':'SI','estonia':'EE','latvia':'LV','lithuania':'LT','denmark':'DK','sweden':'SE','finland':'FI','norway':'NO','switzerland':'CH','united states':'US','usa':'US','united kingdom':'GB','uk':'GB','india':'IN','china':'CN','japan':'JP','singapore':'SG','south korea':'KR','hong kong':'HK','turkey':'TR','türkiye':'TR','ukraine':'UA','united arab emirates':'AE','uae':'AE'})

@dataclass
class CollectionResult:
    connector:str; query:str; ok:bool; records:list[dict[str,Any]]; total_available:int; error:str|None=None

class JobsPipeConnector:
    endpoint='https://api.jobspipe.dev/v1/jobs/search'
    def __init__(self,api_key:str):
        if not api_key: raise RuntimeError('JOBSPIPE_API_KEY is not configured')
        self.api_key=api_key
    def _post(self,payload:dict[str,Any])->dict[str,Any]:
        req=Request(self.endpoint,data=json.dumps(payload).encode(),headers={'Authorization':f'Bearer {self.api_key}','Content-Type':'application/json','User-Agent':'job-search-command-center/1.0'},method='POST')
        try:
            with urlopen(req,timeout=45) as r: body=r.read().decode()
        except HTTPError as e: raise RuntimeError(f'HTTP {e.code}: {e.read().decode(errors="replace")[:500]}') from e
        except URLError as e: raise RuntimeError(f'network error: {e.reason}') from e
        out=json.loads(body)
        if not isinstance(out.get('data'),list): raise RuntimeError('provider response does not contain a data array')
        return out

def configured_titles(config):
    out=[]
    for g in (config.get('role_groups') or {}).values():
        if g.get('enabled'): out.extend(g.get('titles') or [])
    return list(dict.fromkeys(str(x).strip() for x in out if str(x).strip()))

def _region(v): return str(v or '').strip().upper()
def resolve_target_country_codes(config):
    codes={str(x).upper() for x in (config.get('target_country_codes') or config.get('search_country_codes') or [])}
    for r in config.get('target_regions') or []: codes.update(REGIONS.get(_region(r),set()))
    return sorted(codes)

def validate_geography_config(config):
    tr={_region(x) for x in config.get('target_regions') or []}; er={_region(x) for x in config.get('excluded_regions') or []}; tc={str(x).upper() for x in config.get('target_country_codes') or []}; ec={str(x).upper() for x in config.get('excluded_country_codes') or []}
    if (tr|er)-set(REGIONS): raise RuntimeError('Unsupported geographic region')
    if tr&er or tc&ec: raise RuntimeError('Geographic inclusion/exclusion conflict')
    if any(REGIONS[r]&ec for r in tr) or any(REGIONS[r]&tc for r in er): raise RuntimeError('Geographic inclusion/exclusion overlap')

def load_config():
    c=json.loads(CONFIG_PATH.read_text())
    if c.get('schema_version')!=SCHEMA_VERSION: raise RuntimeError('Unsupported search config schema')
    mode=str(c.get('jobspipe_mode') or ('direct' if c.get('jobspipe_enabled',True) else 'disabled')).lower()
    if mode not in {'disabled','apify','direct'}: raise RuntimeError('Invalid jobspipe_mode')
    validate_geography_config(c); return c

def parse_posted_datetime(v):
    if not v:return None
    try:d=datetime.fromisoformat(str(v).replace('Z','+00:00'))
    except Exception:return None
    return (d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d).astimezone(timezone.utc)

def _list(v):
    vals=v if isinstance(v,list) else ([] if not v else [v]); out=[]
    for x in vals:
        if isinstance(x,dict): x=x.get('name') or x.get('country') or x.get('code')
        s=str(x or '').strip()
        if s and s not in out: out.append(s)
    return out

def normalize_job_geography(job,remote):
    codes=[]
    for v in [job.get('country_code'),job.get('job_country_code'),*_list(job.get('country_codes'))]:
        c=str(v or '').upper().strip()
        if len(c)==2 and c not in codes: codes.append(c)
    countries=_list(job.get('countries'))
    for name in countries:
        c=NAME_CODE.get(name.lower())
        if c and c not in codes: codes.append(c)
    for c in codes:
        n=NAMES.get(c,c)
        if n not in countries:countries.append(n)
    text=' '.join([str(job.get('location') or ''),' '.join(countries),' '.join(_list(job.get('remote_locations'))),str(job.get('description') or '')[:5000]])
    scope='Country' if codes else 'Unknown'
    if remote:
        if re.search(r'\b(worldwide|work from anywhere|anywhere in the world|global remote)\b',text,re.I):scope='Worldwide'
        elif re.search(r'\bEMEA\b',text,re.I):scope='EMEA'
        elif re.search(r'\b(EU|European Union|Europe only|within Europe|across Europe|Europe)\b',text,re.I):scope='EU'
        elif not codes:scope='Worldwide'
    eligible=True if not remote else scope in {'Worldwide','EU','EMEA'} or ('RO' in codes or bool(re.search(r'\bRomania\b',text,re.I)))
    return countries,codes,scope,eligible

def _geo_match(codes,scope,config,remote):
    target=set(resolve_target_country_codes(config)); tr={_region(x) for x in config.get('target_regions') or []}; ec={str(x).upper() for x in config.get('excluded_country_codes') or []}; er={_region(x) for x in config.get('excluded_regions') or []}
    if remote and scope=='Worldwide': return True
    if remote and scope in {'EU','EMEA'}:
        if 'EU' in er or 'RO' in ec:return False
        return not(target or tr) or 'EU' in tr or bool(target&EU)
    if codes&ec or any(codes&REGIONS.get(r,set()) for r in er): return False
    return not target or not codes or bool(codes&target)

def canonical_source_name(connector): return 'JobsPipe' if str(connector or '').lower().startswith('jobspipe') else (connector or 'Necunoscuta')

def process_records(config,collection,now):
    freshness=int(config.get('collection_freshness_hours',config.get('freshness_hours',24))); display=int(config.get('freshness_hours',24)); threshold=int(config.get('fit_threshold',80)); keep=bool(config.get('keep_reposts',True)); modes=config.get('work_modes') or {}; target_codes=set(resolve_target_country_codes(config))
    cp=config.get('excluded_company_patterns') or []; rk=config.get('excluded_role_keywords') or []; erp=config.get('deep_erp_terms') or []
    company_re=re.compile('|'.join(f'(?:{x})' for x in cp),re.I) if cp else None; role_re=re.compile(r'\b(?:'+'|'.join(map(re.escape,rk))+r')\b',re.I) if rk else None; erp_re=re.compile(r'\b(?:'+'|'.join(map(re.escape,erp))+r')\b',re.I) if erp else None; target_re=re.compile(r'\b(project|program|programme|delivery|service|scrum|pmo)\b',re.I)
    raw=[]; totals={}
    for r in collection:
        if r.ok: raw.extend(r.records); totals[f'{r.connector}:{r.query}']=r.total_available
    seen=set(); jobs=[]; excluded=[]
    for j in raw:
        title=str(j.get('job_title') or j.get('title') or '').strip(); company=str(j.get('company') or j.get('company_name') or '').strip(); desc=str(j.get('description') or ''); text=f'{title} {desc}'; loc=j.get('location') or j.get('short_location') or 'Nespecificat'; remote=bool(j.get('remote')) or str(j.get('work_arrangement') or '').lower()=='remote'; hybrid=bool(j.get('hybrid')) or str(j.get('work_arrangement') or '').lower()=='hybrid'; countries,country_codes,scope,ro_ok=normalize_job_geography(j,remote); codes=set(country_codes); posted=j.get('date_posted') or j.get('posted_at'); pdt=parse_posted_datetime(posted); key=j.get('id') or (title.lower(),company.lower(),str(loc).lower()); reason=None
        if key in seen:reason='duplicate'
        elif not target_re.search(title):reason='title outside target'
        elif company_re and company_re.search(company):reason='excluded company'
        elif role_re and role_re.search(title):reason='non-IT role'
        elif erp_re and erp_re.search(text) and re.search(r'implement|consultant|specialist|functional',text,re.I):reason='deep ERP/SAP implementation'
        elif remote and not modes.get('remote',True):reason='remote disabled by configuration'
        elif hybrid and not modes.get('hybrid',True):reason='hybrid disabled by configuration'
        elif remote and not ro_ok:reason='remote not eligible from Romania'
        elif not _geo_match(codes,scope,config,remote):reason='outside target or excluded geography'
        elif not keep and j.get('reposted'):reason='repost disabled'
        elif pdt and (now-pdt).total_seconds()>freshness*3600:reason=f'older than {freshness} hours'
        if reason: excluded.append({'title':title,'company':company,'reason':reason}); continue
        seen.add(key); score=68; tl=title.lower()
        if 'it project' in tl or 'technical project' in tl:score+=13
        elif 'project manager' in tl:score+=9
        if 'delivery' in tl:score+=9
        if 'service' in tl:score+=6
        if 'program' in tl or 'pmo' in tl:score+=6
        if 'scrum' in tl:score+=3
        score+=8 if remote else (4 if hybrid else 0)
        if re.search(r'contract|freelance|b2b',text,re.I):score+=6
        if re.search(r'European Commission|European Parliament|EU institution|public sector',text,re.I):score+=7
        if re.search(r'bank|financial|compliance|regulated|governance',text,re.I):score+=5
        if re.search(r'Dutch|German|native French|fluent French',text,re.I):score-=7
        score=max(40,min(96,score)); age=max(0,int((now-pdt).total_seconds()//3600)) if pdt else 0; arr='Remote' if remote else ('Hybrid' if hybrid else ('Onsite' if str(j.get('work_arrangement') or '').lower() in {'onsite','on-site','office','in-office'} else 'N/A')); statuses=_list(j.get('employment_statuses')); employment=', '.join(statuses) or 'Nespecificat'; url=j.get('final_url') or j.get('source_url') or j.get('url'); pros=['Remote'] if remote else []; pros+=['Geografie eligibila'] if (codes&target_codes or (remote and scope in {'Worldwide','EU','EMEA'})) else []; risks=[] if re.search(r'contract|freelance|b2b',text,re.I) else ['Forma B2B nu este confirmata']
        jobs.append({'id':j.get('id'),'title':title,'company':company,'initial':''.join(x[0] for x in company.split()[:2]).upper() or '?','fit':score,'location':loc,'countries':countries,'country_codes':country_codes,'remote_scope':scope,'romania_eligible':ro_ok if remote else None,'mode':arr,'type':employment.replace('_',' ').title(),'age':age,'remote':remote,'b2b':any(x.lower() in {'contract','contractor','freelance'} for x in statuses),'repost':bool(j.get('reposted')),'status':'new' if score>=threshold else 'review','pros':(pros or ['Titlu relevant'])[:2],'risks':(risks or ['Conditiile contractuale trebuie confirmate'])[:2],'url':url,'description':desc.strip(),'date_posted':posted,'source':(j.get('sources') or [{}])[0].get('provider') or canonical_source_name(collection[0].connector if collection else ''),'verified_at':j.get('verified_at')})
    jobs.sort(key=lambda x:(-x['fit'],x['age'],x['company'].lower()))
    return {'schema_version':SCHEMA_VERSION,'generated_at':now.isoformat(),'freshness_hours':freshness,'collection_freshness_hours':freshness,'criteria':{'roles':configured_titles(config),'geography':{'regions':config.get('target_regions') or [],'country_codes':config.get('target_country_codes') or config.get('search_country_codes') or [],'excluded_regions':config.get('excluded_regions') or [],'excluded_country_codes':config.get('excluded_country_codes') or []},'work_mode_priority':config.get('work_mode_priority') or [],'source_strategy':config.get('source_strategy') or 'all active sources equally','display_freshness_hours':display,'fit_threshold':threshold,'keep_reposts':keep,'exclusions':config.get('exclusions') or []},'raw_matches_available':totals,'records_inspected':len(raw),'results':len(jobs),'excluded_count':len(excluded),'jobs':jobs,'excluded_sample':excluded[:20]}

def write_status(now,collection,jobs_published,excluded):
    ok=[r for r in collection if r.ok]; bad=[r for r in collection if not r.ok]; state='failed' if not ok else ('completed_with_errors' if bad else 'completed'); sources=sorted({canonical_source_name(r.connector) for r in collection}); sr=[{'source':canonical_source_name(r.connector),'connector':r.connector,'query':r.query,'status':'completed' if r.ok else 'failed','records':len(r.records),'total_available':r.total_available,'error':r.error} for r in collection]; status={'schema_version':SCHEMA_VERSION,'run_id':'github-'+now.strftime('%Y%m%dT%H%M%SZ'),'status':state,'started_at':now.isoformat(),'completed_at':datetime.now(timezone.utc).isoformat(),'sources':sources,'sources_processed':len(sources),'failed_sources':sorted({canonical_source_name(r.connector) for r in bad}),'source_results':sr,'records_inspected':sum(len(r.records) for r in ok),'jobs_published':jobs_published,'excluded':excluded,'limitations':[]}; STATUS_PATH.write_text(json.dumps(status,ensure_ascii=False,indent=2)+'\n'); return state

def validate_output():
    c=json.loads(CONFIG_PATH.read_text()); j=json.loads(JOBS_PATH.read_text()); s=json.loads(STATUS_PATH.read_text()); assert c.get('schema_version')==SCHEMA_VERSION and j.get('schema_version')==SCHEMA_VERSION and s.get('schema_version')==SCHEMA_VERSION; assert isinstance(j.get('jobs'),list); assert 'sources_processed' in s

def main():
    if '--validate-only' in sys.argv: validate_output(); print('Configuration and JSON contracts valid'); return 0
    return 0
if __name__=='__main__': raise SystemExit(main())

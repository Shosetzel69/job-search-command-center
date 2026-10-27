"""Parse only explicitly published Zoho Recruit modern careers metadata."""
import json
from html.parser import HTMLParser

class _PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts=[]
        self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in ("script","style"): self.skip+=1
        if tag in ("p","br","li","div"): self.parts.append(" ")
    def handle_endtag(self,tag):
        if tag in ("script","style") and self.skip: self.skip-=1
    def handle_data(self,data):
        if not self.skip: self.parts.append(data)

def visible_description_length(raw):
    if not isinstance(raw,str) or not raw.strip(): return 0
    parser=_PlainText()
    parser.feed(raw)
    return len(" ".join("".join(parser.parts).split()))
from html.parser import HTMLParser

class JobsInput(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.values=[]
    def handle_starttag(self,tag,attrs):
        if tag=="input":
            attr=dict(attrs)
            if attr.get("id")=="jobs" or attr.get("name")=="jobs":
                self.values.append(attr.get("value",""))

def embedded_jobs(html,max_postings=500):
    if not isinstance(html,str) or len(html.encode("utf-8"))>3*1024*1024:
        raise ValueError("invalid or oversized modern careers board")
    parser=JobsInput()
    parser.feed(html)
    if len(parser.values)!=1:
        raise ValueError("missing or ambiguous public Zoho jobs payload")
    data=json.loads(parser.values[0])
    if not isinstance(data,list) or len(data)>max_postings:
        raise ValueError("invalid public Zoho jobs collection")
    ids=set()
    result=[]
    for item in data:
        if not isinstance(item,dict): raise ValueError("invalid job entry")
        if str(item.get("Publish","")).strip().casefold() in {"false","no","0"}:
            continue
        jobid=str(item.get("id","")).strip()
        if not jobid.isdecimal() or len(jobid)>30 or len(jobid)<5:
            raise ValueError("invalid public Zoho job id")
        if jobid in ids: continue
        ids.add(jobid)
        title=item.get("Posting_Title") or item.get("Job_Opening_Name")
        if not isinstance(title,str) or not title.strip():
            raise ValueError("missing Zoho posting title")
        result.append({
          "jobid":jobid,
          "job_title":" ".join(title.split()),
          "country":item.get("Country") if isinstance(item.get("Country"),str) else None,
          "city":item.get("City") if isinstance(item.get("City"),str) else None,
          "employment_type":item.get("Job_Type") if isinstance(item.get("Job_Type"),str) else None,
          "industry":item.get("Industry") if isinstance(item.get("Industry"),str) else None,
          "date_opened":item.get("Date_Opened") if isinstance(item.get("Date_Opened"),str) else None,
          "state":item.get("State") if isinstance(item.get("State"),str) else None,
          "description":item.get("Job_Description") if isinstance(item.get("Job_Description"),str) and item.get("Job_Description").strip() else None,
          "description_available":bool(isinstance(item.get("Job_Description"),str) and item.get("Job_Description").strip()),
          "description_chars":visible_description_length(item.get("Job_Description")),
          "remote_raw":item.get("Remote_Job"),
        })
    return result

#!/usr/bin/env python3
"""One-time deterministic Package 1 frontend transformation."""

from pathlib import Path
import re

PATH = Path("frontend/src/main.jsx")
text = PATH.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


def regex_once(pattern: str, replacement: str, label: str) -> None:
    global text
    text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {count}")


if "function hasTargetGeography(criteria)" not in text:
    replace_once(
        "\nfunction loadGoogleIdentityScript()",
        "\nfunction hasTargetGeography(criteria){return Boolean(criteria?.targetRegions?.length||criteria?.targetCountries?.length);}\n\nfunction loadGoogleIdentityScript()",
        "insert hasTargetGeography",
    )

replace_once(
    "{view!=='criteria'&&<button onClick={onRun}",
    "<button onClick={onRun}",
    "show run button on criteria page",
)
replace_once(
    "</button>}<ProfileMenu email={email} onLogout={onLogout}/>",
    "</button><ProfileMenu email={email} onLogout={onLogout}/>",
    "close always-visible run button",
)

replace_once(
    "const conflict=geographyConflicts(draft);return",
    "const conflict=geographyConflicts(draft);const missingTarget=!hasTargetGeography(draft);return",
    "criteria missing target state",
)
replace_once(
    "{conflict&&<div className=\"rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700\">",
    "{missingTarget&&<div className=\"rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700\">Selecteaza cel putin o tara sau regiune tinta.</div>}{conflict&&<div className=\"rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700\">",
    "criteria missing target warning",
)
replace_once(
    "disabled={!dirty||saving||conflict}",
    "disabled={!dirty||saving||conflict||missingTarget}",
    "disable invalid geography save",
)

regex_once(
    r"const runSearch=useCallback\(async\(\)=>\{.*?\},\[auth\.token,running,runStatus,notify,pollRun\]\);",
    "const runSearch=useCallback(async()=>{if(!auth.token||running)return;if(geographyConflicts(draftCriteria)){notify('Rezolva conflictul dintre includerile si excluderile teritoriale.','error');return;}if(!hasTargetGeography(draftCriteria)){notify('Selecteaza cel putin o tara sau regiune tinta.','error');return;}setRunning(true);const previousRunId=runStatus?.run_id||null,previousCompletedAt=runStatus?.completed_at||null;try{await commandApi('/commands/run',auth.token,{method:'POST',body:JSON.stringify(draftCriteria)});setSavedCriteria(draftCriteria);notify('Verificarea manuala a fost pornita cu criteriile curente.','info');await pollRun(previousRunId,previousCompletedAt);}catch(error){if(error.status===409){notify('Exista deja o verificare in curs.','info');await pollRun(previousRunId,previousCompletedAt);}else notify(`Nu am putut porni verificarea: ${error.message}`,'error');}finally{setRunning(false);}},[auth.token,running,runStatus,notify,pollRun,draftCriteria]);",
    "runSearch current criteria",
)

regex_once(
    r"const saveCriteria=useCallback\(async\(\)=>\{.*?\},\[auth\.token,saving,draftCriteria,notify\]\);",
    "const saveCriteria=useCallback(async()=>{if(!auth.token||saving)return;if(geographyConflicts(draftCriteria)){notify('Rezolva conflictul dintre includerile si excluderile teritoriale.','error');return;}if(!hasTargetGeography(draftCriteria)){notify('Selecteaza cel putin o tara sau regiune tinta.','error');return;}setSaving(true);try{await commandApi('/config',auth.token,{method:'PUT',body:JSON.stringify(draftCriteria)});setSavedCriteria(draftCriteria);setCanonicalConfig(current=>current?{...current,freshness_hours:draftCriteria.freshness,fit_threshold:draftCriteria.fitThreshold,target_regions:draftCriteria.targetRegions,target_country_codes:draftCriteria.targetCountries,search_country_codes:draftCriteria.targetCountries,excluded_regions:draftCriteria.excludedRegions,excluded_country_codes:draftCriteria.excludedCountries,jobspipe_mode:draftCriteria.jobspipeMode,jobspipe_apify_max_items_per_run:draftCriteria.jobspipeApifyMaxItems,jobspipe_credit_budget_per_run:draftCriteria.jobspipeDirectRunBudget,jobspipe_monthly_credit_guard:draftCriteria.jobspipeDirectMonthlyGuard}:current);setFilters(current=>({...current,freshness:draftCriteria.freshness}));notify('Preferintele au fost salvate. Cautarea nu a fost pornita.','success');}catch(error){notify(`Preferintele nu au putut fi salvate: ${error.message}`,'error');}finally{setSaving(false);}},[auth.token,saving,draftCriteria,notify]);",
    "saveCriteria no automatic run",
)

PATH.write_text(text, encoding="utf-8")
print("Package 1 frontend patch applied")

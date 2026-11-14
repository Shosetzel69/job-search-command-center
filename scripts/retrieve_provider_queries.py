"""Conservative role-token planning for provider search endpoints."""

SCOPE_TERMS = {
    "project_management": ("project",), "program_management": ("program", "programme"),
    "pmo": ("pmo", "project"), "delivery_management": ("delivery",),
    "service_management": ("service",), "it_operations": ("operation",),
    "support_management": ("support",), "product_management": ("product",),
    "product_owner": ("product",), "agile_scrum": ("scrum", "agile"),
    "business_analysis": ("business",), "transformation": ("transformation",),
    "change_management": ("change",), "customer_success": ("customer",),
    "technical_account_management": ("account",), "technical_customer_management": ("customer",),
    "implementation": ("implementation",), "professional_services": ("professional",),
    "engineering_management": ("engineering",), "technical_leadership": ("technical", "tech"),
    "solution_architecture": ("architect",), "enterprise_architecture": ("architect",),
}


def scope_search_terms(config):
    if not (config or {}).get("_jscc_targeted_collection"):
        return ()
    subfamilies = config.get("target_role_subfamilies") or []
    if not subfamilies or any(code not in SCOPE_TERMS for code in subfamilies):
        return ()
    terms = tuple(sorted({term for code in subfamilies for term in SCOPE_TERMS[code]}))
    return terms if len(terms) <= 8 else ()

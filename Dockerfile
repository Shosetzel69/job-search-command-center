# GCP-01 / #424: build-only Cloud Run Job image foundation.
# Cloud Run Service HTTP adaptation is deliberately deferred to M2; this image
# packages the existing search runtime without changing application behavior.
FROM mcr.microsoft.com/playwright/python:v1.55.0-noble

ARG GIT_SHA
LABEL org.opencontainers.image.source="https://github.com/Shosetzel69/job-search-command-center" \
      org.opencontainers.image.revision="${GIT_SHA}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    JSCC_RUNTIME_MODE=container

WORKDIR /app

COPY requirements-search.txt ./
RUN python3 -m pip install --no-cache-dir --disable-pip-version-check -r requirements-search.txt

COPY scripts/ ./scripts/
COPY shared/ ./shared/
COPY config/ ./config/
COPY data/sources.json data/source-categories.json data/nomenclatures.json ./data/

RUN python3 -m py_compile \
    scripts/job_search.py \
    scripts/job_search_optimized.py \
    scripts/job_search_apify.py \
    scripts/job_search_runner.py \
    scripts/source_orchestration.py \
    scripts/job_search_web.py \
    scripts/web_browser.py \
    scripts/web_transport.py

ENTRYPOINT ["python3", "scripts/job_search_runner.py"]

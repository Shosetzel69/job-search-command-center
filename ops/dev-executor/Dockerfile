FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 git gh ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY runner/executor.py runner/job-entrypoint.py runner/git-askpass.sh runner/github_gates.py /app/
RUN chmod 0755 /app/git-askpass.sh
RUN useradd --create-home --uid 10001 runner && mkdir -p /workspace && chown runner:runner /workspace
USER runner
ENTRYPOINT ["python3", "/app/job-entrypoint.py"]

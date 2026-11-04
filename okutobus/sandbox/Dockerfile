# OkuCode Docker sandbox (SRS FR-25). Build once: okucode sandbox-image
# The agent's commands run in a fresh container of this image that sees only the project folder.
# Add the tools your team needs (for example a JDK or the .NET SDK) and rebuild.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git less procps unzip zip \
      build-essential pkg-config \
      python3 python3-pip python3-venv \
      nodejs npm \
      ripgrep jq sqlite3 \
 && rm -rf /var/lib/apt/lists/*
# The container runs with HOME=/tmp, so caches (npm, pip) stay out of the project.
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 NPM_CONFIG_UPDATE_NOTIFIER=false PYTHONDONTWRITEBYTECODE=1
WORKDIR /tmp
CMD ["bash"]

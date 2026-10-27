# See here for image contents: https://github.com/devcontainers/images/blob/main/src/base-ubuntu/.devcontainer/Dockerfile

# [Choice] Ubuntu version (use ubuntu-22.04 or ubuntu-18.04 on local arm64/Apple Silicon): ubuntu-22.04, ubuntu-20.04, ubuntu-18.04
ARG VARIANT=ubuntu-24.04
FROM mcr.microsoft.com/vscode/devcontainers/base:${VARIANT}

# RUN apt-get update \
#     && apt-get -y install --no-install-recommends curl ca-certificates gnupg
# RUN curl https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
# RUN sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
# RUN apt-get update \
#     && apt-get -y install --no-install-recommends <packages>

# RUN groupadd --gid 1000 vscode \
#   && useradd --uid 1000 --gid vscode --shell /bin/bash --create-home vscode

ENV NODE_VERSION 24

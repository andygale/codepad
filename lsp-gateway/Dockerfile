# LSP Gateway container based on Node + Theia LSP server
FROM node:20-slim

# Install JDK 17, Gradle, Python, and Python LSP dependencies
RUN apt-get update && apt-get install -y openjdk-17-jre-headless curl unzip tar wget python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && echo "Installing Gradle..." \
  && wget -q https://services.gradle.org/distributions/gradle-8.4-bin.zip -O /tmp/gradle.zip \
  && unzip -q /tmp/gradle.zip -d /opt \
  && rm /tmp/gradle.zip \
  && ln -s /opt/gradle-8.4/bin/gradle /usr/local/bin/gradle \
  && gradle --version \
  && echo "Installing Python LSP Server..." \
  && python3 -m pip install --break-system-packages --no-cache-dir 'python-lsp-server[all]' pylsp-mypy python-lsp-black \
  && python3 -c "import pylsp; print('Python LSP Server installed successfully')" \
  && python3 --version

WORKDIR /usr/src/app

# Copy gateway sources
COPY package.json ./

RUN yarn install --frozen-lockfile --non-interactive --prefer-offline && yarn cache clean

COPY . ./

# -----------------------------
# Download and set up language servers
# -----------------------------
RUN mkdir -p /opt \
  && echo "Downloading Kotlin language server" \
  && curl -L -o /tmp/kotlin-ls.zip https://github.com/fwcd/kotlin-language-server/releases/latest/download/server.zip \
  && unzip /tmp/kotlin-ls.zip -d /opt/kotlin-ls \
  && rm /tmp/kotlin-ls.zip \
  && chmod +x /opt/kotlin-ls/server/bin/kotlin-language-server \
  && echo "Downloading JDT language server" \
  && curl -L -o /tmp/jdtls.tar.gz https://download.eclipse.org/jdtls/milestones/1.38.0/jdt-language-server-1.38.0-202408011337.tar.gz \
  && mkdir -p /opt/jdt-language-server \
  && tar -xzf /tmp/jdtls.tar.gz -C /opt/jdt-language-server \
  && rm /tmp/jdtls.tar.gz \
  && mkdir -p /tmp/jdt-workspace \
  && yarn build

EXPOSE 3000
ENV PORT=3000
CMD ["node", "dist/index.js"]

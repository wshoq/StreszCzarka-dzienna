FROM mcr.microsoft.com/playwright:v1.52.0-jammy

# Install build tools for better-sqlite3
RUN apt-get update && apt-get install -y \
  build-essential \
  python3 \
  python3-pip \
  python3-distutils \
  make \
  g++ \
  sqlite3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

# Use npm ci to install dependencies cleanly
RUN npm ci

COPY . .

# Ensure Playwright's dependencies and Chromium are installed
RUN npx playwright install chromium --with-deps

CMD ["node", "index.js"]

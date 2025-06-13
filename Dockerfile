# Używamy wcześniejszej wersji Playwright z Node 20 (kompatybilny z better-sqlite3)
FROM mcr.microsoft.com/playwright:v1.42.1-jammy

# Instalujemy narzędzia do kompilacji native modules
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

RUN npm install -g npm@latest

RUN npm ci

COPY . .

RUN npx playwright install chromium --with-deps

CMD ["node", "index.js"]

FROM mcr.microsoft.com/playwright:v1.52.0-jammy

# Instalujemy wymagane pakiety do kompilacji better-sqlite3
RUN apt-get update && apt-get install -y \
  build-essential \
  python3 \
  sqlite3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npx playwright install chromium --with-deps

CMD ["node", "index.js"]
# A tag da imagem deve ser a MESMA versão do @playwright/test no package.json.
FROM mcr.microsoft.com/playwright:v1.65.1-noble

WORKDIR /app
COPY package*.json ./
# Com package-lock.json usa npm ci (build reproduzível); sem ele, npm install.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .

USER pwuser
# Padrão: uma execução (ideal para CronJob). No compose roda em loop.
CMD ["npx", "playwright", "test"]

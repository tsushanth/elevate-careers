FROM mcr.microsoft.com/playwright:v1.45.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Only install chromium — skip firefox/webkit to keep image lean
RUN npx playwright install chromium

COPY src/ ./src/

EXPOSE 8080

CMD ["node", "src/worker.js"]

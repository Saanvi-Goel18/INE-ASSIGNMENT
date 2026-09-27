# Official Playwright image: Chromium + all its system libraries preinstalled.
# Tag must match the installed playwright package version.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts

EXPOSE 3000
CMD ["node", "src/server.js"]

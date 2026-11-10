FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends qpdf poppler-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
CMD ["node", "src/server.js"]

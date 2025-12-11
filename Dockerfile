# Simple production Dockerfile for the Sudoku app
FROM node:18-alpine AS base
WORKDIR /usr/src/app

# Install dependencies (production only)
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production || npm install --only=production

# Copy application source
COPY . .

# App listens on PORT (default 3000)
EXPOSE 3000

CMD ["node", "server.js"]

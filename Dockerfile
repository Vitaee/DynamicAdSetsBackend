# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY turbo.json ./
COPY apps/backend/package*.json ./apps/backend/
COPY packages/shared/package*.json ./packages/shared/

# Install dependencies
RUN npm install

# Copy source code
COPY apps/backend ./apps/backend
COPY packages/shared ./packages/shared

# Build the application
RUN npm run build --workspace=@weathertrigger/shared
RUN npm run build --workspace=@weathertrigger/backend

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/
COPY packages/shared/package*.json ./packages/shared/

# Install production dependencies only
RUN npm install --production

# Copy built application
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Copy environment file if exists
COPY apps/backend/.env* ./apps/backend/

EXPOSE 3001

CMD ["node", "apps/backend/dist/index.js"]
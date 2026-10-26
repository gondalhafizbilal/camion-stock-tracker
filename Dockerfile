# Build Stage
# ===========
FROM node:24-alpine AS builder

WORKDIR /app

# Install dependencies (cached independently of the source tree)
COPY package.json .
COPY package-lock.json .
RUN npm ci

# Copy source code
COPY src ./src
COPY tsconfig.json .
COPY tsconfig.build.json .
RUN npm run build

# Start Execution
# ===============
FROM node:24-alpine

WORKDIR /app

# Install dependencies (production only)
COPY package.json .
COPY package-lock.json .
RUN npm ci --omit=dev

# Copy the Amazon RDS CA bundle. app.module.ts reads ca/global-bundle.pem at
# runtime whenever NODE_ENV != "local", for the TLS connection to Aurora.
# Without it the container exits 1 during Nest bootstrap with ENOENT, before it
# ever binds a port.
COPY ca ./ca

# Copy build artifacts from the builder stage
COPY --from=builder /app/dist ./dist

# stock-logger.service.ts creates and appends to ./logs at runtime. Create it
# up front so it is owned by `node` rather than root.
RUN mkdir -p /app/logs && chown -R node:node /app/logs

# Expose Port
# 3001 matches stock_tracker_service.port in marn-infra.
EXPOSE 3001

# NOTE: PORT is deliberately NOT set here.
#
# Every runtime variable for this service comes from the S3 environment file
# referenced by the task definition (environmentFiles), which is rendered from
# the Secrets Manager secret /marn/dev/stock-tracker/env. A Docker-level ENV
# would be shadowed by that file, but a task-definition-level `environment`
# entry would silently *override* it — so neither is used. One source only.

# Run as the non-root user that the node image already provides.
USER node

# Run the app
CMD ["node", "dist/main.js"]

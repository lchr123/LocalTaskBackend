FROM node:20-alpine AS production

# Add non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Build and download node_modules
COPY package.json package-lock.json ./
RUN npm install

# Copy production dependencies and built output
COPY ./dist ./dist
COPY ./migrations ./migrations
RUN npm run migrate:up

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Use non-root user
USER appuser

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]

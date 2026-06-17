# Use official Playwright runtime image which is preinstalled with Node.js and all system browser dependencies (GTK, GLib, etc.)
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

# Set container working directory
WORKDIR /app

# Copy package descriptors first to maximize caching during Docker rebuilds
COPY package.json ./

# Install packages with production optimization
RUN npm install --production

# Pre-verify and double-ensure that ONLY the Chromium browser package is fully synchronized with Playwright setup
RUN npx playwright install chromium

# Copy application code inside workspace
COPY . .

# Set running mode and configuration
ENV NODE_ENV=production
ENV PORT=3000

# Tell Docker to listen dynamically on server host
EXPOSE 3000

# Start server
CMD ["npm", "start"]

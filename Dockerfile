FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# Install build tools for native node modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /usr/src/app

# Create the cache directory
RUN mkdir -p ./cache
VOLUME ./cache

# Copy the current directory contents into the container at /usr/src/app
COPY . .

# Install any needed packages specified in package.json
RUN npm ci && npm run build:prod

# Define environment variables
ENV NODE_ENV=production

# Run the app when the container launches
CMD ["node", "./dist/index.js"]

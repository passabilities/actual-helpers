FROM mcr.microsoft.com/playwright:v1.54.0-jammy

# Set the working directory in the container
WORKDIR /usr/src/app

# Create the cache directory
RUN mkdir -p ./cache
VOLUME ./cache

# Copy the current directory contents into the container at /usr/src/app
COPY . .

# Install any needed packages specified in package.json
RUN npm install && npm update && npm run build:prod

# Define environment variables
ENV NODE_ENV=production

# Run the app when the container launches
CMD ["node", "./dist/index.js"]

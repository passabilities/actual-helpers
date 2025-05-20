# Use an official Node.js runtime as a parent image
FROM node:22

RUN apt-get update -qq -y && \
    apt-get install -y \
        libasound2 \
        libatk-bridge2.0-0 \
        libgtk-4-1 \
        libnss3 \
        xdg-utils \
        wget && \
    wget -q -O chrome-linux64.zip https://storage.googleapis.com/chrome-for-testing-public/131.0.6778.204/linux64/chrome-linux64.zip && \
    unzip chrome-linux64.zip && \
    rm chrome-linux64.zip && \
    mv chrome-linux64 /opt/chrome/ && \
    ln -s /opt/chrome/chrome /usr/local/bin/ && \
    wget -q -O chromedriver-linux64.zip https://storage.googleapis.com/chrome-for-testing-public/131.0.6778.204/linux64/chromedriver-linux64.zip && \
    unzip -j chromedriver-linux64.zip chromedriver-linux64/chromedriver && \
    rm chromedriver-linux64.zip && \
    mv chromedriver /usr/local/bin/

# Don't run as root
USER node

# Set the working directory in the container
WORKDIR /usr/src/app

# Create the cache directory
RUN mkdir -p ./cache && chown node:node ./cache

# Define environment variables
ENV NODE_ENV=production

ENV ACTUAL_SERVER_URL="http://actual_server:5006"
ENV ACTUAL_SERVER_PASSWORD="LigkXLw_CwT-yPsz8xtQ"
ENV ACTUAL_SYNC_ID="f87a106e-0041-4691-b148-04b1e4e872ef"
# allow self-signed SSL certs
#ENV NODE_TLS_REJECT_UNAUTHORIZED=0

# needed for Selenium+chromedriver
ENV CHROMEDRIVER_SKIP_DOWNLOAD=true

# optional, for encrypted files
ENV ACTUAL_FILE_PASSWORD="c6PA@hoN9yEh.H76AzeU"

# optional, if you want to use a different cache directory
ENV ACTUAL_CACHE_DIR="./cache"

# optional, name of the payee for added interest transactions
ENV INTEREST_PAYEE_NAME="Interest"

# optional, name of the payee for added interest transactions
ENV INVESTMENT_PAYEE_NAME="Balance Adjustment"
# optional, name of the category group for added investment tracking transactions
ENV INVESTMENT_CATEGORY_GROUP_NAME="Income"
# optional, name of the category for added investment tracking transactions
ENV INVESTMENT_CATEGORY_NAME="Investment"

# optional, name of the payee for Zestimate entries
ENV ZESTIMATE_PAYEE_NAME="Zestimate"

# optional, name of the payee for KBB entries
ENV KBB_PAYEE_NAME="KBB"

# optional, the URL for tracking Bitcoin prices
ENV BITCOIN_PRICE_URL="https://api.kraken.com/0/public/Ticker?pair=xbtusd"
# optional, the JSON path in the response to get the Bitcoin price
ENV BITCOIN_PRICE_JSON_PATH="result.XXBTZUSD.c[0]"
# optional, name of the payee for Bitcoin entries
ENV BITCOIN_PAYEE_NAME="Bitcoin Price Change"

#optional, RentCast API key for fetching property data
ENV RENTCAST_API_KEY="<Rentcast API key>"
ENV RENTCAST_PAYEE_NAME="RentCast"

# optional, for logging into SimpleFIN
ENV SIMPLEFIN_CREDENTIALS=""

VOLUME ./cache

# Copy the current directory contents into the container at /usr/src/app
COPY --chown=node:node . .

# Install any needed packages specified in package.json
RUN npm install && npm update

# Run the app when the container launches
CMD ["node", "index.js"]

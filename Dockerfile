# Use a slim Node.js base image
FROM node:slim

# Set the working directory
WORKDIR /app

# Install ffmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json for better caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Copy the .env file (if needed)
COPY .env .env

# Expose the port your app uses
EXPOSE 7701

# Install PM2 globally
RUN npm install pm2 -g

# Start both the main app and the worker using PM2
CMD ["pm2-runtime", "start", "ecosystem.config.js"]

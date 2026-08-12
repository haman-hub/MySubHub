# Use Node 18 Alpine for a small footprint
FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy all source code
COPY . .

# Expose the port Fly.io will use (8080 by default)
EXPOSE 8080

# Start the server
CMD ["node", "server.js"]
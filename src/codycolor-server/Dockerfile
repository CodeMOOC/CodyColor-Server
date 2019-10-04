FROM node:12.10.0-alpine

WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm install

# Install app
COPY / ./

# Run Node
CMD [ "npm", "start" ]

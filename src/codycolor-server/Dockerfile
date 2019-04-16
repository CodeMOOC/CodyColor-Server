FROM node:8.15-alpine

WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm install

# Install app
COPY *.js .

# Run Node
CMD [ "npm", "start" ]

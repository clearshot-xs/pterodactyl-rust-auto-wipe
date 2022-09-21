FROM node:16-alpine
ENV NODE_ENV production

WORKDIR /app
COPY package*.json ./
COPY index.js .

RUN npm install
CMD [ "node", "index.js" ]
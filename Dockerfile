FROM node:24-alpine
WORKDIR /app
COPY package.json game.js server.js ./
COPY public ./public
ENV PORT=4317
EXPOSE 4317
USER node
CMD ["node", "server.js"]

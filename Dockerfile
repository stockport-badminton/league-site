FROM node:22-alpine

RUN apk add --no-cache fontconfig ttf-liberation ffmpeg imagemagick

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "app.js"]

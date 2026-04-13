FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY src ./src
RUN mkdir -p uploads
EXPOSE 3001
CMD ["node", "src/server.js"]
RUN apk add --no-cache python3 py3-pip && \
    pip3 install reportlab --break-system-packages

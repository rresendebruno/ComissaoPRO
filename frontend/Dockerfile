FROM node:18-alpine AS build
WORKDIR /app
COPY package.json .
RUN npm install --legacy-peer-deps && \
    npm install ajv@^8 --legacy-peer-deps
COPY . .
ENV DISABLE_ESLINT_PLUGIN=true
ENV NODE_OPTIONS=--openssl-legacy-provider
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

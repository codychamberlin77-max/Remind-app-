# One image for both Railway services. Set LIFEOS_ROLE=worker on the worker service;
# anything else (or unset) runs the web app.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "serve"]

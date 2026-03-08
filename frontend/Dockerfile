FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Accept build-time arg so Next.js bakes NEXT_PUBLIC_API_URL into the bundle
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

EXPOSE 3000
RUN npm run build
CMD ["npm", "run", "start"]
# Imagen de producción: solo dependencias de ejecución.
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY agent ./agent
COPY src ./src
COPY web ./web
COPY fixtures ./fixtures
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "src/server.ts"]

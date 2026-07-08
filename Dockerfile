# 第一阶段：构建前端
FROM node:20-slim AS frontend-builder

WORKDIR /build

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web ./
RUN npm run build

# 第二阶段：运行后端
FROM python:3.11-slim

WORKDIR /app

# 安装后端依赖
COPY server/requirements.txt ./server/
RUN pip install --no-cache-dir -r server/requirements.txt

# 复制后端代码
COPY server ./server

# 复制构建好的前端静态文件
COPY --from=frontend-builder /build/dist ./web/dist

# 默认使用 Mock Agent 模式，无需外部 API Key 即可演示
ENV MOCK_AGENT=true
ENV SERVE_STATIC=true
ENV HOST=0.0.0.0

EXPOSE 8090

CMD ["python", "server/main.py"]

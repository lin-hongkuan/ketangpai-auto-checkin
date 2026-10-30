FROM node:22-alpine

LABEL org.opencontainers.image.title="ketangpai-auto-checkin" \
      org.opencontainers.image.description="课堂派自动签到：全课程巡检 / 签入签出 / 状态看板 / 零依赖" \
      org.opencontainers.image.source="https://github.com/lin-hongkuan/ketangpai-auto-checkin" \
      org.opencontainers.image.licenses="MIT"

# 时区数据（日志与每日汇总用 Asia/Shanghai）
RUN apk add --no-cache tzdata

WORKDIR /app
COPY src/ /app/src/
COPY package.json /app/package.json

ENV TZ=Asia/Shanghai \
    DATA_DIR=/data \
    PORT=8080 \
    POLL_INTERVAL=10

# /data 挂载卷：config.json / state.json / logs
RUN mkdir -p /data/logs
VOLUME ["/data"]

EXPOSE 8080

# /healthz 在 token 未配置、失效或轮询停滞时返回 503 → 容器变 unhealthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "/app/src/index.mjs"]

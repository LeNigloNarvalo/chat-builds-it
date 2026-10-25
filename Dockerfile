# Cornichon : aucune dépendance npm, Node 22 suffit (SQLite intégré via node:sqlite).
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 CORNICHON_DB=/data/cornichon.db BACKUP_DIR=/data/backups
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
# sonde de santé : /api/health répond 503 si la base est inaccessible
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]

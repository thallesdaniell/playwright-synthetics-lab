#!/bin/sh
# Usado só no docker-compose, fazendo o papel do CronJob.
INTERVAL="${INTERVAL_SECONDS:-60}"

while true; do
  npx playwright test || echo "jornada falhou (métricas enviadas mesmo assim)"
  sleep "$INTERVAL"
done

docker compose -f local-docker-compose.yml up -d

docker cp .\migrations db-localtaskbackend:/tmp/migrations
docker exec -it db-localtaskbackend psql -U user -d localtask

\set ON_ERROR_STOP on
\i /tmp/migrations/001_init.sql
\i /tmp/migrations/002_xxx.sql
\q
# local DB migration

docker compose -f local-docker-compose.yml up -d

docker cp .\migrations db-localtaskbackend:/tmp/migrations
docker exec -it db-localtaskbackend psql -U user -d localtask

\set ON_ERROR_STOP on
\i /tmp/migrations/001_init.sql
\i /tmp/migrations/002_xxx.sql
\q

# deploy
npm install
npm run build
scp -i ./LightsailDefaultKey-ap-northeast-1.pem -r ./dist ubuntu@54.238.163.28:/home/ubuntu/localtaskbackend
scp -i ./LightsailDefaultKey-ap-northeast-1.pem -r ./docker-compose.yml ubuntu@54.238.163.28:/home/ubuntu/localtaskbackend
scp -i ./LightsailDefaultKey-ap-northeast-1.pem -r ./dockerfile-prod ubuntu@54.238.163.28:/home/ubuntu/localtaskbackend
scp -i ./LightsailDefaultKey-ap-northeast-1.pem -r ./.env ubuntu@54.238.163.28:/home/ubuntu/localtaskbackend
scp -i ./LightsailDefaultKey-ap-northeast-1.pem -r ./migrations ubuntu@54.238.163.28:/home/ubuntu/localtaskbackend
scp -i ./LightsailDefaultKey-ap-northeast-1.pem -r ./package.json ubuntu@54.238.163.28:/home/ubuntu/localtaskbackend
scp -i ./LightsailDefaultKey-ap-northeast-1.pem -r ./package-lock.json ubuntu@54.238.163.28:/home/ubuntu/localtaskbackend

docker compose up -d
docker compose down --rmi all --remove-orphans

# prod DB migration
sudo docker exec -it local-task-backend npm run migrate:up
sudo docker exec -it local-task-backend npm run migrate:down

# Admin Panel Build & Deploy
cd admin && npm install && npm run build && cd ..
scp -i ./LightsailDefaultKey-ap-northeast-1.pem -r ./admin/dist ubuntu@54.238.163.28:/home/ubuntu/localtaskbackend/admin-dist

# Then on the frontend repo side, copy admin-dist into the nginx build context:
# cp -r admin-dist/ into LocalTaskApp/ before rebuilding nginx container
# Or on server: docker cp admin-dist nginx:/var/www/admin/

# lambda-xhs-scraper (container-image Lambda, one-time setup + redeploy)
# See lambda-xhs-scraper/README.md for full instructions.
# Requires env vars on the main backend: XHS_SCRAPER_LAMBDA_NAME, OPENAI_API_KEY,
# OPENAI_MODEL (optional), MARKETPLACE_OFFICIAL_USER_ID (a real app user id to
# publish AI-generated marketplace drafts under).

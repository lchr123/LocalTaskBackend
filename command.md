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
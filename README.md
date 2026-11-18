# Galactica.io

## Lancer avec Docker

```bash
cp .env.example .env   # puis remplir JWT_SECRET (openssl rand -hex 32)
docker compose up      # http://localhost:5173 (API sous /api, proxifiée par Vite)
docker compose exec server node dist/seed.js   # items de base, une fois
docker compose exec server npm test
```

## Production

https://galactica.natolive.fr, sur le serveur `nathan`. Chaque push sur `main` passe la CI
(`.github/workflows/ci.yml`) : tests, images publiées sur GHCR, puis `/srv/galactica/deploy.sh <sha>`
qui lance `compose.prod.yml`. Le Caddy partagé (`/srv/caddy`) envoie `/api/*` et `/socket.io/*`
au serveur, le reste au client statique.

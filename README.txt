EMF MULTIPLAYER SERVER — estilo SA-MP

1) Entra a Cloudflare Dashboard.
2) Workers & Pages -> Create -> Worker.
3) O usa Wrangler desde un PC:
   npm install -g wrangler
   wrangler login
   cd EMF_SERVER_SAMP
   wrangler deploy
4) Cloudflare te dará una URL *.workers.dev.
5) En el HTML, coloca:
   const EMF_CLOUD_WS = 'wss://TU-WORKER.workers.dev/ws';

Arquitectura:
P1 -> WebSocket -> Durable Object (sala) -> WebSocket -> P2

El servidor mantiene la sala y retransmite inputs/frames. No ejecuta el NES.
Los dos clientes siguen ejecutando jsnes localmente. Para una futura versión
server-authoritative habría que ejecutar la emulación en el servidor.

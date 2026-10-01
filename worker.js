export class Room {
  constructor(state) {
    this.state = state;
    this.players = new Map();
    this.lastActivity = Date.now();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('EMF Multiplayer Server OK', {status: 200});
    }

    const room = (url.searchParams.get('room') || '').toUpperCase();
    const role = url.searchParams.get('role') === '2' ? 2 : 1;
    if (!/^EMF[A-Z0-9]{8}$/.test(room)) return new Response('Invalid room', {status:400});

    if (this.players.size >= 2) return new Response('Room full', {status:409});
    if (this.players.has(role)) return new Response('Role occupied', {status:409});

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const player = {ws: server, role, joinedAt: Date.now()};
    this.players.set(role, player);
    this.lastActivity = Date.now();

    server.addEventListener('message', e => {
      this.lastActivity = Date.now();
      let data;
      try { data = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)); }
      catch { return; }
      if (!data || typeof data !== 'object') return;
      data._from = role;
      data._serverAt = Date.now();

      // The server is a relay, not the NES emulator. It gives every packet
      // an authoritative receive timestamp and forwards it to the other player.
      for (const [r, p] of this.players) {
        if (r === role) continue;
        try { p.ws.send(JSON.stringify(data)); } catch {}
      }
    });

    const cleanup = () => {
      if (this.players.get(role)?.ws === server) this.players.delete(role);
      this.lastActivity = Date.now();
      for (const [r,p] of this.players) {
        try { p.ws.send(JSON.stringify({t:'player-left', player:role, _serverAt:Date.now()})); } catch {}
      }
    };
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);

    // Tell the new client its assigned role and notify the existing player.
    try { server.send(JSON.stringify({t:'welcome', player:role, players:[...this.players.keys()], _serverAt:Date.now()})); } catch {}
    for (const [r,p] of this.players) {
      if (r !== role) {
        try { p.ws.send(JSON.stringify({t:'player-joined', player:role, _serverAt:Date.now()})); } catch {}
      }
    }

    return new Response(null, {status:101, webSocket:client});
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ok:true, service:'EMF Multiplayer Server', time:Date.now()});
    }
    if (url.pathname === '/ws') {
      const room = (url.searchParams.get('room') || '').toUpperCase();
      if (!/^EMF[A-Z0-9]{8}$/.test(room)) return new Response('Invalid room', {status:400});
      const id = env.EMF_ROOMS.idFromName(room);
      return env.EMF_ROOMS.get(id).fetch(request);
    }
    return new Response('EMF Multiplayer Server online. Use /health or /ws?room=...&role=1|2', {status:200});
  }
};

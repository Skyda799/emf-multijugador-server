export class Room {
  constructor(state) {
    this.state = state;
    this.players = new Map();
    this.lastActivity = Date.now();
  }

  broadcast(message, exceptRole = null) {
    const payload = JSON.stringify({
      ...message,
      _serverAt: Date.now()
    });

    for (const [r, p] of this.players) {
      if (exceptRole !== null && r === exceptRole) continue;

      try {
        if (p.ws.readyState === 1) {
          p.ws.send(payload);
        }
      } catch {}
    }
  }

  roomState() {
    return {
      t: 'room-state',
      players: [...this.players.keys()].sort((a, b) => a - b),
      count: this.players.size,
      max: 2
    };
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(
        'EMF Multiplayer Server OK',
        { status: 200 }
      );
    }

    const room = (
      url.searchParams.get('room') || ''
    ).toUpperCase();

    const role =
      url.searchParams.get('role') === '2'
        ? 2
        : 1;

    if (!/^EMF[A-Z0-9]{8}$/.test(room)) {
      return new Response(
        'Invalid room',
        { status: 400 }
      );
    }

    // Una sala tiene exactamente un P1 y un P2.
    if (this.players.size >= 2) {
      return new Response(
        'Room full',
        { status: 409 }
      );
    }

    if (this.players.has(role)) {
      return new Response(
        'Role occupied',
        { status: 409 }
      );
    }

    const pair = new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    server.accept();

    const player = {
      ws: server,
      role,
      joinedAt: Date.now(),
      hello: false,
      name: ''
    };

    this.players.set(role, player);
    this.lastActivity = Date.now();

    // El jugador recién conectado recibe
    // el estado real de la sala.
    try {
      server.send(
        JSON.stringify({
          t: 'welcome',
          player: role,
          players: [...this.players.keys()].sort(
            (a, b) => a - b
          ),
          _serverAt: Date.now()
        })
      );
    } catch {}

    // El jugador que ya estaba conectado
    // recibe aviso del nuevo jugador.
    this.broadcast(
      {
        t: 'player-joined',
        player: role
      },
      role
    );

    // Ambos reciben el estado canónico.
    this.broadcast(
      this.roomState()
    );

    server.addEventListener(
      'message',
      e => {
        this.lastActivity = Date.now();

        let data;

        try {
          data = JSON.parse(
            typeof e.data === 'string'
              ? e.data
              : new TextDecoder().decode(e.data)
          );
        } catch {
          return;
        }

        if (
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data)
        ) {
          return;
        }

        // Nunca confiamos en estos campos
        // enviados por el cliente.
        delete data._from;
        delete data._serverAt;

        // Hello confirma que el socket
        // terminó correctamente el handshake.
        if (data.t === 'hello') {
          player.hello = true;

          player.name = String(
            data.name || ''
          ).slice(0, 120);

          try {
            server.send(
              JSON.stringify({
                t: 'room-state',
                players: [
                  ...this.players.keys()
                ].sort((a, b) => a - b),
                count: this.players.size,
                max: 2,
                _serverAt: Date.now()
              })
            );
          } catch {}

          this.broadcast(
            {
              t: 'peer-hello',
              player: role,
              name: player.name
            },
            role
          );

          return;
        }

        // Ping directo al servidor.
        if (data.t === 'ping') {
          try {
            server.send(
              JSON.stringify({
                t: 'pong',
                at: data.at,
                _serverAt: Date.now()
              })
            );
          } catch {}

          return;
        }

        // El resto es tráfico del juego.
        // La identidad viene del socket real.
        data._from = role;
        data._serverAt = Date.now();

        for (const [r, p] of this.players) {
          if (r === role) continue;

          try {
            if (p.ws.readyState === 1) {
              p.ws.send(
                JSON.stringify(data)
              );
            }
          } catch {}
        }
      }
    );

    const cleanup = () => {
      if (
        this.players.get(role)?.ws !== server
      ) {
        return;
      }

      this.players.delete(role);
      this.lastActivity = Date.now();

      // Avisar al jugador restante.
      this.broadcast({
        t: 'player-left',
        player: role
      });

      // Enviar estado actualizado.
      this.broadcast(
        this.roomState()
      );
    };

    server.addEventListener(
      'close',
      cleanup
    );

    server.addEventListener(
      'error',
      cleanup
    );

    return new Response(
      null,
      {
        status: 101,
        webSocket: client
      }
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check.
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'EMF Multiplayer Server',
        time: Date.now()
      });
    }

    // WebSocket.
    if (url.pathname === '/ws') {
      const room = (
        url.searchParams.get('room') || ''
      ).toUpperCase();

      if (!/^EMF[A-Z0-9]{8}$/.test(room)) {
        return new Response(
          'Invalid room',
          { status: 400 }
        );
      }

      const id =
        env.EMF_ROOMS.idFromName(room);

      return env.EMF_ROOMS
        .get(id)
        .fetch(request);
    }

    return new Response(
      'EMF Multiplayer Server online. Use /health or /ws?room=...&role=1|2',
      { status: 200 }
    );
  }
};

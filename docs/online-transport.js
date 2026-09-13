(function (root) {
  'use strict';
  const AR = root.AR;
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
  ];
  let loading;
  function loadPeer() {
    if (root.Peer) return Promise.resolve(root.Peer);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const finish = error => { clearTimeout(timer); script.onload = script.onerror = null; if (error) { script.remove(); loading = null; reject(error); } else resolve(root.Peer); };
      const timer = setTimeout(() => finish(new Error('PeerJS download timed out. Check your internet connection.')), 15000);
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js'; script.async = true;
      script.onload = () => finish(root.Peer ? null : new Error('PeerJS could not load.'));
      script.onerror = () => finish(new Error('PeerJS could not download. Check your internet connection or content blocker.'));
      document.head.appendChild(script);
    });
    return loading;
  }
  function roomCode() { const bytes = crypto.getRandomValues(new Uint8Array(4)); return [...bytes].map(n => ALPHABET[n % ALPHABET.length]).join(''); }
  function token() { return [...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16)).join('-'); }
  class PeerTransport {
    constructor(role, code) { this.role = role; this.code = code; this.handlers = {}; this.channels = {}; this.connected = false; this.closed = false; this.token = token(); this.collisions = 0; }
    on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
    emit(type, value) { (this.handlers[type] || []).forEach(fn => fn(value)); }
    async start() {
      try { const Peer = await loadPeer(); if (!this.closed) this.createPeer(Peer); }
      catch (error) { if (!this.closed) this.emit('error', { type: 'load', message: error.message }); }
    }
    createPeer(Peer) {
      // Default public broker: deliberately no host, port, path or API-key override.
      const peer = this.peer = new Peer(this.role === 'host' ? 'abyss-' + this.code : undefined, { config: { iceServers: ICE }, debug: 0 });
      peer.on('open', () => { if (this.closed || peer !== this.peer) return; this.emit('room', this.code); if (this.role === 'guest') this.connect(); });
      peer.on('connection', c => {
        if (this.role !== 'host' || !['events', 'state'].includes(c.label) || c.metadata?.protocol !== 1 || (this.remote && (this.remote !== c.peer || this.remoteToken !== c.metadata.token))) { c.close(); return; }
        this.remote = c.peer; this.remoteToken = c.metadata.token; this.emit('connecting'); this.attach(c);
      });
      peer.on('disconnected', () => { if (!this.closed) { this.emit('signalling'); this.reconnect(); } });
      peer.on('error', error => {
        if (this.closed || peer !== this.peer) return;
        if (error.type === 'unavailable-id' && this.role === 'host' && ++this.collisions < 5) { peer.destroy(); this.code = roomCode(); this.createPeer(Peer); return; }
        this.emit('error', { type: error.type, message: error.message });
      });
    }
    connect() {
      if (this.closed || this.connected || !this.peer || this.peer.disconnected || this.peer.destroyed) return;
      if (this.dialing && performance.now() - this.dialing < 4000) return;
      this.resetChannels(); this.dialing = performance.now();
      for (const label of ['events', 'state']) this.attach(this.peer.connect('abyss-' + this.code, { label, serialization: 'binary', reliable: label === 'events', metadata: { protocol: 1, token: this.token } }));
    }
    attach(c) {
      const old = this.channels[c.label]; if (old && old !== c) { this.channels[c.label] = null; old.close(); }
      this.channels[c.label] = c;
      c.on('open', () => {
        if (this.closed || this.channels[c.label] !== c) return;
        if (this.channels.events?.open && this.channels.state?.open && !this.connected) { this.connected = true; this.dialing = 0; this.emit('open'); }
      });
      c.on('data', data => { if (this.channels[c.label] === c && !this.closed) this.emit('data', { data, channel: c.label }); });
      const lost = () => { if (this.closed || this.channels[c.label] !== c) return; const was = this.connected; this.connected = false; this.resetChannels(); if (was) this.emit('close'); };
      c.on('close', lost); c.on('error', lost);
      const pc = c.peerConnection;
      if (pc) pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') lost(); });
    }
    resetChannels() { const channels = this.channels; this.channels = {}; Object.values(channels).forEach(c => c?.close()); }
    send(data, channel = 'events') {
      const c = this.channels[channel]; if (!c?.open || this.closed) return false;
      // Skip obsolete state under backpressure; event messages are never discarded.
      if (channel === 'state' && (c.dataChannel?.bufferedAmount > 16384 || c.bufferSize > 8)) return false;
      try { c.send(data); return true; } catch (_) { return false; }
    }
    reconnect() {
      if (this.closed || !this.peer || this.peer.destroyed) return;
      if (this.peer.disconnected) { try { this.peer.reconnect(); } catch (_) { /* next heartbeat retries */ } }
      else if (this.role === 'guest') this.connect();
    }
    close() { this.closed = true; this.connected = false; this.resetChannels(); this.peer?.destroy(); }
    inspect() { return { kind: 'PeerJS', channels: Object.fromEntries(Object.entries(this.channels).map(([key, c]) => [key, { ordered: c?.dataChannel?.ordered, maxRetransmits: c?.dataChannel?.maxRetransmits, bufferedAmount: c?.dataChannel?.bufferedAmount || 0 }])) }; }
  }
  AR.PeerTransport = PeerTransport; AR.onlineRoomCode = roomCode; AR.ONLINE_ALPHABET = ALPHABET;
})(globalThis);

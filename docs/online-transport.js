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
    constructor(role, code) {
      this.role = role; this.code = code; this.handlers = {}; this.links = new Map();
      this.now = () => performance.now();
      this.connected = false; this.closed = false; this.locked = false; this.token = token(); this.collisions = 0;
    }
    // Keep the original first-guest channel interface for diagnostics.
    get channels() { return this.links.get(1)?.channels || {}; }
    on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
    emit(type, value) { (this.handlers[type] || []).forEach(fn => fn(value)); }
    async start() {
      try { const Peer = await loadPeer(); if (!this.closed) this.createPeer(Peer); }
      catch (error) { if (!this.closed) this.emit('error', { type: 'load', message: error.message }); }
    }
    createPeer(Peer) {
      // Reuse the existing broker and ICE configuration for both guest seats.
      const peer = this.peer = new Peer(this.role === 'host' ? 'abyss-' + this.code : undefined, { config: { iceServers: ICE }, debug: 0 });
      peer.on('open', () => { if (this.closed || peer !== this.peer) return; this.emit('room', this.code); if (this.role === 'guest') this.connect(); });
      peer.on('connection', c => {
        if (this.closed || peer !== this.peer || this.role !== 'host' || !['events', 'state'].includes(c.label) || c.metadata?.protocol !== 1 || typeof c.metadata.token !== 'string') { c.close(); return; }
        let index = [...this.links].find(([, link]) => link.peer === c.peer && link.token === c.metadata.token)?.[0];
        if (!index) {
          if (this.locked || this.links.size >= 2 || [...this.links.values()].some(link => link.peer === c.peer || link.token === c.metadata.token)) {
            const reject = () => { if (c.open) c.send({ type: 'roomFull', started: this.locked }); setTimeout(() => c.close(), 250); };
            if (c.open) reject(); else c.on('open', reject);
            return;
          }
          index = this.links.has(1) ? 2 : 1;
          this.links.set(index, { peer: c.peer, token: c.metadata.token, channels: {}, connected: false, admitted: false, since: this.now() });
        }
        this.emit('connecting', index); this.attach(c, index);
      });
      peer.on('disconnected', () => {
        if (this.closed || peer !== this.peer) return;
        // Losing signalling does not sever a healthy direct data connection.
        this.emit('signalling'); this.reconnect();
      });
      peer.on('error', error => {
        if (this.closed || peer !== this.peer) return;
        if (error.type === 'unavailable-id' && this.role === 'host' && ++this.collisions < 5) { peer.destroy(); this.code = roomCode(); this.createPeer(Peer); return; }
        this.emit('error', { type: error.type, message: error.message });
      });
    }
    connect() {
      if (this.closed || this.connected || !this.peer || this.peer.disconnected || this.peer.destroyed) return;
      if (this.dialing && this.now() - this.dialing < 4000) return;
      this.resetChannels(); this.dialing = this.now();
      for (const label of ['events', 'state']) this.attach(this.peer.connect('abyss-' + this.code, { label, serialization: 'binary', reliable: label === 'events', metadata: { protocol: 1, token: this.token } }), 1);
    }
    attach(c, index = 1) {
      if (!this.links.has(index)) this.links.set(index, { channels: {}, connected: false });
      const link = this.links.get(index), old = link.channels[c.label];
      if (old && old !== c) { delete link.channels[c.label]; old.close(); }
      link.channels[c.label] = c;
      c.on('open', () => {
        if (this.closed || link.channels[c.label] !== c) return;
        if (link.channels.events?.open && link.channels.state?.open && !link.connected) {
          link.connected = link.admitted = true; this.updateConnected(); this.dialing = 0; this.emit('open', index);
        }
      });
      c.on('data', data => { if (link.channels[c.label] === c && !this.closed) this.emit('data', { data, channel: c.label, index }); });
      const lost = () => {
        if (this.closed || link.channels[c.label] !== c) return;
        const was = link.connected; this.resetChannels(index); if (was) this.emit('close', index);
      };
      c.on('close', lost); c.on('error', lost);
      const pc = c.peerConnection;
      if (pc) pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') lost(); });
    }
    prunePending() {
      if (this.role !== 'host') return;
      for (const [index, link] of this.links) if (!link.admitted && this.now() - link.since >= 15000) {
        this.resetChannels(index); this.links.delete(index);
      }
      this.updateConnected();
    }
    updateConnected() { this.connected = this.links.size > 0 && [...this.links.values()].every(link => link.connected); }
    isConnected(index = 1) { return !!this.links.get(index)?.connected; }
    resetChannels(index) {
      for (const [i, link] of this.links) {
        if (index !== undefined && i !== index) continue;
        const channels = link.channels; link.channels = {}; link.connected = false;
        Object.values(channels).forEach(c => c?.close());
      }
      this.updateConnected();
    }
    send(data, channel = 'events', index) {
      let sent = false;
      for (const [i, link] of this.links) {
        if (this.role === 'host' && index !== undefined && i !== index) continue;
        const c = link.channels[channel]; if (!c?.open || this.closed) continue;
        if (channel === 'state' && (c.dataChannel?.bufferedAmount > 16384 || c.bufferSize > 8)) continue;
        try { c.send(data); sent = true; } catch (_) { /* A closed channel is recovered by the connection watch. */ }
      }
      return sent;
    }
    reconnect() {
      if (this.closed || !this.peer || this.peer.destroyed) return;
      if (this.peer.disconnected) { try { this.peer.reconnect(); } catch (_) { /* next heartbeat retries */ } }
      else if (this.role === 'guest') this.connect();
    }
    close() { this.closed = true; this.connected = false; this.resetChannels(); this.peer?.destroy(); }
    inspect() {
      const channels = link => Object.fromEntries(Object.entries(link?.channels || {}).map(([key, c]) => [key, { ordered: c?.dataChannel?.ordered, maxRetransmits: c?.dataChannel?.maxRetransmits, bufferedAmount: c?.dataChannel?.bufferedAmount || 0 }]));
      return { kind: 'PeerJS', channels: channels(this.links.get(1)), seats: [...this.links].map(([index, link]) => ({ index, connected: link.connected, channels: channels(link) })) };
    }
  }
  AR.PeerTransport = PeerTransport; AR.onlineRoomCode = roomCode; AR.ONLINE_ALPHABET = ALPHABET;
})(globalThis);

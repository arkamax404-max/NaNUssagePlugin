const EventEmitter = require("node:events");
const crypto = require("node:crypto");
const net = require("node:net");

class HostClient extends EventEmitter {
  connect(uuid, port = 3906, address = "127.0.0.1") {
    const [hostAddress, hostPort] = process.argv.slice(2);
    this.uuid = uuid;
    this.socket = net.connect(Number(hostPort || port), hostAddress || address);
    this.socket.once("connect", () => {
      const key = crypto.randomBytes(16).toString("base64");
      this.socket.write(`GET / HTTP/1.1\r\nHost: ${hostAddress || address}:${hostPort || port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    this.socket.on("error", (error) => this.emit("error", error));
    this.socket.on("close", () => this.emit("close"));
    let handshake = true;
    let buffer = Buffer.alloc(0);
    this.socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (handshake) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        handshake = false;
        buffer = buffer.subarray(end + 4);
        this.send("connected", { code: 0 });
        this.emit("connected", {});
      }
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15;
        const size = buffer[1] & 127;
        const header = size < 126 ? 2 : size === 126 ? 4 : 10;
        const length = size < 126 ? size : size === 126 ? buffer.readUInt16BE(2) : Number(buffer.readBigUInt64BE(2));
        if (buffer.length < header + length) return;
        const payload = buffer.subarray(header, header + length);
        buffer = buffer.subarray(header + length);
        if (opcode === 1) this.#receive(payload);
      }
    });
  }

  #receive(raw) {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (!data || (data.code !== undefined && data.cmdType !== "REQUEST")) return;
    this.send(data.cmd, { code: 0, ...data });
    if (data.cmd === "clear" && Array.isArray(data.param))
      data.param.forEach((item) => { item.context = this.encodeContext(item); });
    else data.context = this.encodeContext(data);
    this.emit(data.cmd, data);
  }

  encodeContext(message) { return `${message.uuid}___${message.key}___${message.actionid}`; }
  decodeContext(context) {
    const [uuid, key, actionid] = context.split("___");
    return { uuid, key, actionid };
  }
  onAdd(handler) { return this.on("add", handler); }
  onRun(handler) { return this.on("run", handler); }
  onClear(handler) { return this.on("clear", handler); }
  onSetActive(handler) { return this.on("setactive", handler); }
  onParamFromApp(handler) { return this.on("paramfromapp", handler); }
  onParamFromPlugin(handler) { return this.on("paramfromplugin", handler); }

  send(cmd, parameters = {}) {
    if (!this.socket?.writable) return;
    const payload = Buffer.from(JSON.stringify({ cmd, uuid: this.uuid, ...parameters }));
    const mask = crypto.randomBytes(4);
    const header = payload.length < 126
      ? Buffer.from([129, 128 | payload.length])
      : Buffer.from([129, 254, payload.length >> 8, payload.length & 255]);
    const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  setStateIcon(context, state) {
    this.send("state", { param: { statelist: [{ ...this.decodeContext(context), type: 0, state, textData: "", showtext: false }] } });
  }
  setBaseDataIcon(context, data) {
    this.send("state", { param: { statelist: [{ ...this.decodeContext(context), type: 1, data, textData: "", showtext: false }] } });
  }
}

module.exports = { HostClient };

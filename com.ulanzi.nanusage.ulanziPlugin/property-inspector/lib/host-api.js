(() => {
  const handlers = new Map();
  let socket;
  let identity = {};
  function emit(name, payload) { for (const handler of handlers.get(name) || []) handler(payload); }
  window.$UD = {
    connect(uuid) {
      const query = new URLSearchParams(location.search);
      identity = { uuid: query.get("uuid") || uuid, key: query.get("key") || "", actionid: query.get("actionid") || "" };
      socket = new WebSocket(`ws://${query.get("address") || "127.0.0.1"}:${query.get("port") || "3906"}`);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ code: 0, cmd: "connected", ...identity }));
        emit("connected", {});
      });
      socket.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message && (message.code === undefined || message.cmdType === "REQUEST")) emit(message.cmd, message);
      });
    },
    on(name, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
    },
    sendParamFromPlugin(param) {
      socket.send(JSON.stringify({ cmd: "paramfromplugin", ...identity, param }));
    },
  };
})();

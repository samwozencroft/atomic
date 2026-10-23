(() => {
  let hostToken = null;
  let pluginId = null;
  const callbacks = new Map();
  const pendingRequests = new Map();
  let requestCounter = 0;

  function postToParent(payload) {
    window.parent.postMessage({
      channel: 'atomic-plugin',
      token: hostToken,
      pluginId,
      ...payload
    }, '*');
  }

  window.addEventListener('message', async (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== 'atomic-plugin-host') return;

    if (msg.type === 'init') {
      hostToken = msg.token;
      pluginId = msg.manifest?.id;
      try {
        const root = document.getElementById('plugin-root');
        const api = {
          workspace: msg.initialState?.workspace,
          settings: msg.initialState?.settings,
          storage: msg.initialState?.legacyStorage,
          request: (method, params) => {
            const requestId = `req_${++requestCounter}`;
            return new Promise((resolve, reject) => {
              pendingRequests.set(requestId, { resolve, reject });
              postToParent({ type: 'request', requestId, method, params });
            });
          },
          registerCommand: (id, callback) => {
            const callbackId = `cmd_${id}`;
            callbacks.set(callbackId, callback);
            postToParent({ type: 'register', kind: 'command', id, callbackId });
          },
          registerView: (id, callback) => {
            const callbackId = `view_${id}`;
            callbacks.set(callbackId, callback);
            postToParent({ type: 'register', kind: 'view', id, callbackId });
          }
        };

        if (msg.code) {
          const fn = new Function('atomic', 'root', msg.code);
          fn(api, root);
        }
        postToParent({ type: 'activated' });
      } catch (err) {
        postToParent({
          type: 'activation-error',
          error: { message: err?.message || String(err) }
        });
      }
    } else if (msg.type === 'response') {
      const pending = pendingRequests.get(msg.requestId);
      if (pending) {
        pendingRequests.delete(msg.requestId);
        if (msg.error) pending.reject(new Error(msg.error.message));
        else pending.resolve(msg.result);
      }
    } else if (msg.type === 'invoke') {
      const cb = callbacks.get(msg.callbackId);
      if (cb) {
        try {
          const res = await cb(...(msg.args || []));
          postToParent({ type: 'callback-result', invocationId: msg.invocationId, result: res });
        } catch (err) {
          postToParent({
            type: 'callback-result',
            invocationId: msg.invocationId,
            error: { message: err?.message || String(err) }
          });
        }
      }
    }
  });
})();

// Linux: the webview has no postMessage IPC (wry's handler is unregistered, microphone/linux.rs),
// and Tauri's script takes postMessage for every later call of a document once one fetch of its
// IPC failed (while the server restarts, say, or as a page leaves). The page could then call nothing
// of the shell until a reload. So a failed fetch of the IPC answers as the shell's error for that
// call alone (the headers Tauri's script reads), not sent again: the shell may have run it.
(() => {
  const fetched = window.fetch;
  window.fetch = function (input) {
    const sent = fetched.apply(this, arguments);
    if (!String(input?.url ?? input).startsWith('ipc:')) return sent;
    return sent.catch(() => new Response(JSON.stringify('the shell could not be reached'), {
      headers: { 'Tauri-Response': 'error', 'Content-Type': 'application/json' },
    }));
  };
})();

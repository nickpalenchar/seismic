




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

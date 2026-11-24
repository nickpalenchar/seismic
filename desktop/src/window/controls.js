(() => {
  if (window.top !== window) return;

  // Keep the title-bar markup used by older workspace servers and the offline page.
  const os = window.seismicApp.platform;
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const region = 'data-tauri-drag-region';
  function inTitleBar(event) {
    const path = event.composedPath();
    for (const node of path) {
      if (!(node instanceof HTMLElement)) continue;
      const value = node.getAttribute(region);
      if (value === 'deep') return true;
      if (value === 'false') return false;
      if (value === '' || value === 'true') return node === path[0];
      if (node.isContentEditable || node.matches('a,button,input,select,textarea,label,summary,[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],[role="option"]')) return false;
    }
    return false;
  }
  let doubleClick;
  window.addEventListener('mousedown', (event) => {
    doubleClick = undefined;
    if (event.button !== 0 || ![1, 2].includes(event.detail) || !inTitleBar(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.detail === 2 && os === 'macos') {
      doubleClick = [event.clientX, event.clientY];
      return;
    }
    void invoke(event.detail === 2 ? 'workspace_toggle_maximize' : 'workspace_start_dragging').catch(() => {});
  }, true);
  if (os === 'macos') window.addEventListener('mouseup', (event) => {
    if (event.button !== 0 || event.detail !== 2 || !inTitleBar(event)) return;
    event.stopImmediatePropagation();
    if (doubleClick?.[0] === event.clientX && doubleClick?.[1] === event.clientY) {
      void invoke('workspace_toggle_maximize').catch(() => {});
    }
    doubleClick = undefined;
  }, true);
})();

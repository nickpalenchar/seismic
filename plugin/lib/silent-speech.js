





(() => {
  const synth = window.speechSynthesis;
  if (!synth || synth.__silent) return;
  const queue = [];
  let current = null;
  let timer = 0;
  let paused = false;
  let started = 0;
  let left = 0;
  const fire = (utterance, type, extra = {}) =>
    utterance.dispatchEvent(
      type === 'error'
        ? new SpeechSynthesisErrorEvent(type, { utterance, ...extra })
        : new SpeechSynthesisEvent(type, { utterance, charIndex: 0, elapsedTime: 0, ...extra }),
    );
  const finish = () => {
    const utterance = current;
    current = null;
    fire(utterance, 'end', { charIndex: utterance.text.length });
    next();
  };
  const run = () => {
    started = performance.now();
    timer = setTimeout(finish, left);
  };
  function next() {
    if (current || paused || queue.length === 0) return;
    current = queue.shift();
    
    left = (current.text.length * 70) / (current.rate || 1);
    
    run();
    fire(current, 'start');
  }
  Object.defineProperties(synth, {
    __silent: { value: true },
    speaking: { get: () => current !== null },
    pending: { get: () => queue.length > 0 },
    paused: { get: () => paused },
    speak: {
      value(utterance) {
        
        if (Object.prototype.toString.call(utterance) !== '[object SpeechSynthesisUtterance]') throw new TypeError('speak needs a SpeechSynthesisUtterance');
        
        if (!navigator.userActivation.hasBeenActive) return void setTimeout(() => fire(utterance, 'error', { error: 'not-allowed' }));
        queue.push(utterance);
        setTimeout(next);
      },
    },
    cancel: {
      value() {
        const dropped = queue.splice(0);
        if (current) {
          clearTimeout(timer);
          const utterance = current;
          current = null;
          fire(utterance, 'error', { error: 'interrupted' });
        }
        for (const utterance of dropped) fire(utterance, 'error', { error: 'canceled' });
      },
    },
    pause: {
      value() {
        if (paused) return;
        paused = true;
        if (!current) return;
        clearTimeout(timer);
        left -= performance.now() - started;
        fire(current, 'pause');
      },
    },
    resume: {
      value() {
        if (!paused) return;
        paused = false;
        if (!current) return next();
        run();
        fire(current, 'resume');
      },
    },
  });
})();

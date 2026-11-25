




export interface Recording {
  
  stop(): Promise<Blob>;
}

export function record(stream: MediaStream, ctx: AudioContext): Recording {
  return window.seismicApp?.platform === 'linux' ? samples(stream, ctx) : recorder(stream);
}

function recorder(stream: MediaStream): Recording {
  const r = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  r.start();
  return {
    stop: () =>
      new Promise((done) => {
        r.onstop = () => done(new Blob(chunks, { type: r.mimeType }));
        r.stop();
      }),
  };
}

function samples(stream: MediaStream, ctx: AudioContext): Recording {
  const source = ctx.createMediaStreamSource(stream);
  
  const tap = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  tap.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(tap);
  
  tap.connect(ctx.destination);
  return {
    stop: async () => {
      source.disconnect();
      tap.disconnect();
      return wav(chunks, ctx.sampleRate);
    },
  };
}

/** Mono 16-bit PCM in a WAV file. */
export function wav(chunks: Float32Array[], rate: number): Blob {
  const n = chunks.reduce((s, c) => s + c.length, 0);
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => out.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  out.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, n * 2, true);
  let at = 44;
  for (const c of chunks)
    for (const x of c) {
      out.setInt16(at, Math.max(-1, Math.min(1, x)) * 0x7fff, true);
      at += 2;
    }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

// An image imported `with { type: 'file' }`: its path, which `bun build --compile` embeds.
declare module '*.png' {
  const path: string;
  export default path;
}

// A font imported `with { type: 'file' }`, the same way.
declare module '*.woff2' {
  const path: string;
  export default path;
}

declare module '*.txt' {
  const path: string;
  export default path;
}

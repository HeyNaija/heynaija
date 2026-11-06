// hls.js ships types for its full build only. The light build has the same API, less
// subtitles, separate sound tracks, DRM and the like, which post videos do not use.
declare module 'hls.js/light' {
  export * from 'hls.js'
  export { default } from 'hls.js'
}

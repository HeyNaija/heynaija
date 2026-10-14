/** What the member chose. "system" follows the device setting. */
export type ThemeChoice = 'system' | 'light' | 'dark'

export const THEME_KEY = 'hn-theme'

/**
 * Runs in <head> before anything is painted, so the page never flashes the wrong
 * theme, and keeps "system" following the device on every page afterwards. Kept
 * as a string because it must be inlined; it is the only script the app needs
 * before first paint. It leaves its apply function on window.__hnTheme.
 */
export const themeScript = `(function(){try{var m=matchMedia('(prefers-color-scheme: dark)');var a=function(){var c=localStorage.getItem('${THEME_KEY}')||'system';var d=c==='dark'||(c==='system'&&m.matches);var e=document.documentElement;e.dataset.theme=d?'dark':'light';e.dataset.themeChoice=c};a();m.addEventListener('change',a);window.__hnTheme=a}catch(e){}})()`

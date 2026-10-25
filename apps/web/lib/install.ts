/**
 * Chromium browsers (Chrome, Edge, Samsung Internet) offer to install HeyNaija
 * with a `beforeinstallprompt` event, fired once per page load and often before
 * React is running. This keeps it on window.__hnInstall for the Install buttons
 * (app/ui/install-app.tsx) and tells them with an `hn-installable` event. Holding
 * it back also stops Chrome on Android showing its own install bar at a moment
 * of its choosing: we offer it in the welcome flow and in Settings instead.
 * Safari and Firefox never fire it; iPhones install from the Share menu.
 */
export const installScript = `(function(){var t=function(){dispatchEvent(new Event('hn-installable'))};addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__hnInstall=e;t()});addEventListener('appinstalled',function(){window.__hnInstall=null;t()})})()`

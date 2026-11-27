import { giphyKeyFrom } from './giphy'

/**
 * The client key, fixed into the bundle when `next build` runs (NEXT_PUBLIC_*): the Docker build
 * takes it as a build argument. Null hides every Giphy control. Kept apart from lib/giphy.ts so
 * only the composer carries it, not every page that shows a post.
 */
export const GIPHY_API_KEY = giphyKeyFrom(process.env.NEXT_PUBLIC_GIPHY_API_KEY)

/**
 * Whether a GIF is moving: the reader's own choice (Pause or Play) if they made one, otherwise
 * it plays unless their device asks for less motion.
 */
export const gifPlaying = (chosen: boolean | null, reducedMotion: boolean) => chosen ?? !reducedMotion

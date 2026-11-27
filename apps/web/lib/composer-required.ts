export type ComposerContent = {
  /** Nothing to post yet: no words and nothing attached. The Post button is off. */
  empty: boolean
  /** The text box carries `required`, which the browser enforces before the form is sent. */
  textRequired: boolean
}

/**
 * The one rule for what makes a post, read by both the Post button and the text box's `required`:
 * when they disagree the button is on and the browser still refuses the form.
 */
export function composerContent({
  text,
  images,
  video,
  gif,
  pollOpen,
}: {
  text: string
  images: number
  video: boolean
  /** A GIF picked from Giphy; a GIF file is one of `images`. */
  gif: boolean
  pollOpen: boolean
}): ComposerContent {
  const attached = images > 0 || video || gif
  return {
    empty: text.trim().length === 0 && !attached,
    // A poll's question is the post's text.
    textRequired: pollOpen || !attached,
  }
}

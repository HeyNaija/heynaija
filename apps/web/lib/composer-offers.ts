export type ComposerOffers = {
  pictures: boolean
  video: boolean
  poll: boolean
  /** The Giphy search is offered: no other attachment is on the post yet. */
  giphy: boolean
  /** Picture files (photos, or a GIF file) can be added: a Giphy GIF takes the post's one attachment. */
  pictureFiles: boolean
}

export function composerOffers({
  media,
  polls,
  videoAvailable,
  replyTo,
  pollOpen,
  videoDrafted,
  giphyAvailable = false,
  giphyDrafted = false,
  imagesDrafted = false,
}: {
  media: boolean
  polls: boolean
  videoAvailable: boolean
  replyTo: string | undefined
  pollOpen: boolean
  videoDrafted: boolean
  /** The giphyGifs flag is on and a Giphy key is built in. */
  giphyAvailable?: boolean
  giphyDrafted?: boolean
  imagesDrafted?: boolean
}): ComposerOffers {
  return {
    pictures: media,
    video: media && videoAvailable && !replyTo && !pollOpen && !giphyDrafted,
    poll: polls && !replyTo && !videoDrafted && !giphyDrafted,
    giphy: media && giphyAvailable && !giphyDrafted && !imagesDrafted && !videoDrafted && !pollOpen,
    pictureFiles: media && !giphyDrafted,
  }
}

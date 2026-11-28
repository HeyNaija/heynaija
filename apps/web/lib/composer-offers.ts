export type ComposerOffers = {
  pictures: boolean
  video: boolean
  poll: boolean
  /** The GIF search is offered: no other attachment is on the post yet. */
  gifSearch: boolean
  /** Picture files (photos, or a GIF file) can be added: a picked GIF takes the post's one attachment. */
  pictureFiles: boolean
}

export function composerOffers({
  media,
  polls,
  videoAvailable,
  replyTo,
  pollOpen,
  videoDrafted,
  gifAvailable = false,
  gifDrafted = false,
  imagesDrafted = false,
}: {
  media: boolean
  polls: boolean
  videoAvailable: boolean
  replyTo: string | undefined
  pollOpen: boolean
  videoDrafted: boolean
  /** The giphyGifs flag is on and the configured GIF provider has a key built in. */
  gifAvailable?: boolean
  gifDrafted?: boolean
  imagesDrafted?: boolean
}): ComposerOffers {
  return {
    pictures: media,
    video: media && videoAvailable && !replyTo && !pollOpen && !gifDrafted,
    poll: polls && !replyTo && !videoDrafted && !gifDrafted,
    gifSearch: media && gifAvailable && !gifDrafted && !imagesDrafted && !videoDrafted && !pollOpen,
    pictureFiles: media && !gifDrafted,
  }
}

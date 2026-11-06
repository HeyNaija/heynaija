export type ComposerOffers = { pictures: boolean; video: boolean; poll: boolean }

export function composerOffers({
  media,
  polls,
  videoAvailable,
  replyTo,
  pollOpen,
  videoDrafted,
}: {
  media: boolean
  polls: boolean
  videoAvailable: boolean
  replyTo: string | undefined
  pollOpen: boolean
  videoDrafted: boolean
}): ComposerOffers {
  return {
    pictures: media,
    video: media && videoAvailable && !replyTo && !pollOpen,
    poll: polls && !replyTo && !videoDrafted,
  }
}

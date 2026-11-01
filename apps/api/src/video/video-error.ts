export class VideoError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_eligible' | 'too_large' | 'bad_type' | 'too_long' | 'bad_parts' | 'too_many_videos',
    message: string,
  ) {
    super(message)
  }
}

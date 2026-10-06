import { describe, expect, it } from 'vitest';
import { idYoutubeDeUrl } from './medio-youtube';

describe('YouTube en el reproductor', () => {
  it('saca el id de las URL de YouTube', () => {
    expect(idYoutubeDeUrl('https://www.youtube.com/watch?v=rWd0lrxJit4')).toBe('rWd0lrxJit4');
    expect(idYoutubeDeUrl('https://youtu.be/rWd0lrxJit4')).toBe('rWd0lrxJit4');
    expect(idYoutubeDeUrl('https://www.youtube.com/embed/rWd0lrxJit4')).toBe('rWd0lrxJit4');
    expect(idYoutubeDeUrl(undefined)).toBeNull();
    expect(idYoutubeDeUrl('https://example.com/video.mp4')).toBeNull();
  });
});

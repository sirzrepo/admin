/**
 * Capture a cover frame from a locally selected video file.
 *
 * Uses a local object URL (not a remote R2 URL) so the canvas never gets
 * tainted by cross-origin media. Returns a JPEG Blob suitable for upload
 * through the same showcase upload pipeline as a regular image.
 */
export async function captureVideoCover(
  file: File,
  opts?: { maxWidth?: number },
): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Video could not be read"));
    });

    // Seek to a frame a little into the clip, past any black lead-in.
    const target = Math.min(Math.max(video.duration * 0.1, 0.1), 1.5);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = target;
    });

    if (!video.videoWidth || !video.videoHeight) return null;

    const maxWidth = opts?.maxWidth ?? 900;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
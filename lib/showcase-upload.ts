/**
 * Upload a creative (image or video) for the showcase wall.
 *
 * The browser first asks the backend for a Convex storage upload URL, then
 * POSTs the raw file bytes straight to Convex storage (CORS-enabled for
 * browser uploads). The backend action `showcase:commitUpload` then moves the
 * file into the shared R2 showcase bucket server-to-server and returns the
 * public URL.
 *
 * The POST is streamed through XMLHttpRequest so `onProgress` reports the
 * percentage (0-100) of the byte upload.
 */
export async function uploadShowcaseMedia(
  file: File | Blob,
  uploadUrl: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const contentType =
    file instanceof File && file.type
      ? file.type
      : "image/jpeg";

  const response = await new Promise<{ storageId: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress?.(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { storageId: string });
        } catch {
          reject(new Error("Upload response could not be parsed"));
        }
      } else {
        reject(
          new Error(
            xhr.status === 413 ? "File is too large to upload" : "Upload failed",
          ),
        );
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.send(file);
  });

  return response.storageId;
}
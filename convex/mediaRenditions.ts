"use node";

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

const R2_PUBLIC_BASE_DEFAULT = "https://pub-1f5cd68cca10472e9224eff87e49d3fb.r2.dev";
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;

type Destination = "tiktok-photo";

interface ImageDestinationProfile {
  key: Destination;
  version: string;
  storageFolder: string;
  outputFormat: "jpeg";
  outputContentType: "image/jpeg";
  outputExtension: "jpg";
  acceptedInputFormats: ReadonlySet<string>;
  maxWidth: number;
  maxHeight: number;
  maxOutputBytes: number;
  quality: number;
}

const IMAGE_DESTINATION_PROFILES: Record<Destination, ImageDestinationProfile> = {
  "tiktok-photo": {
    key: "tiktok-photo",
    version: "tiktok-photo-v2",
    storageFolder: "tiktok",
    outputFormat: "jpeg",
    outputContentType: "image/jpeg",
    outputExtension: "jpg",
    acceptedInputFormats: new Set(["jpeg", "webp"]),
    maxWidth: 1080,
    maxHeight: 1920,
    maxOutputBytes: 20 * 1024 * 1024,
    quality: 88,
  },
};

sharp.cache(false);
sharp.concurrency(1);

export const prepareImageForDestination = internalAction({
  args: {
    brandId: v.id("brands"),
    sourceUrl: v.string(),
    destination: v.literal("tiktok-photo"),
  },
  handler: async (_ctx, args) => {
    const profile = IMAGE_DESTINATION_PROFILES[args.destination];
    const config = getR2Config();
    const sourceUrl = new URL(args.sourceUrl);
    if (sourceUrl.protocol !== "https:") {
      throw new Error("TikTok requires an image with a secure HTTPS URL.");
    }

    const fingerprint = createHash("sha256")
      .update(`${profile.version}:${args.sourceUrl}`)
      .digest("hex")
      .slice(0, 32);
    const key = `brands/${args.brandId}/renditions/${profile.storageFolder}/${fingerprint}.${profile.outputExtension}`;
    const publicUrl = `${config.publicBase}/${key}`;
    const s3 = createR2Client(config);

    try {
      await s3.send(new HeadObjectCommand({ Bucket: config.bucketName, Key: key }));
      console.log("[MediaRendition] Reusing cached TikTok image", { key });
      return { url: publicUrl, cached: true, contentType: profile.outputContentType };
    } catch (error: any) {
      const status = error?.$metadata?.httpStatusCode;
      if (status !== 404 && error?.name !== "NotFound" && error?.name !== "NoSuchKey") {
        throw error;
      }
    }

    const response = await fetch(args.sourceUrl, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("This image URL redirects elsewhere. Upload the image again before posting.");
    }
    if (!response.ok || !response.body) {
      throw new Error("This image is no longer publicly available. Choose another image and try again.");
    }

    const declaredBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SOURCE_BYTES) {
      throw new Error("This source image is too large to prepare safely for TikTok.");
    }

    const tempDirectory = await mkdtemp(join(tmpdir(), "sirz-media-"));
    const sourcePath = join(tempDirectory, "source-image");
    try {
      await pipeline(
        Readable.fromWeb(response.body as any),
        createByteLimitStream(MAX_SOURCE_BYTES),
        createWriteStream(sourcePath, { flags: "wx" }),
      );

      const sourceStats = await stat(sourcePath);
      const metadata = await sharp(sourcePath, {
        limitInputPixels: MAX_INPUT_PIXELS,
        sequentialRead: true,
        failOn: "error",
      }).metadata();
      const dimensions = autoOrientedDimensions(metadata);
      const canPassThrough = args.sourceUrl.startsWith(`${config.publicBase}/`)
        && !!metadata.format
        && profile.acceptedInputFormats.has(metadata.format)
        && dimensions.width > 0
        && dimensions.height > 0
        && dimensions.width <= profile.maxWidth
        && dimensions.height <= profile.maxHeight
        && sourceStats.size <= profile.maxOutputBytes;

      if (canPassThrough) {
        console.log("[MediaRendition] Source already matches destination profile", {
          destination: profile.key,
          sourceHost: sourceUrl.host,
          format: metadata.format,
          width: dimensions.width,
          height: dimensions.height,
          bytes: sourceStats.size,
        });
        return {
          url: args.sourceUrl,
          cached: true,
          passthrough: true,
          contentType: metadata.format === "webp" ? "image/webp" : "image/jpeg",
          width: dimensions.width,
          height: dimensions.height,
          bytes: sourceStats.size,
        };
      }

      const output = await sharp(sourcePath, {
        limitInputPixels: MAX_INPUT_PIXELS,
        sequentialRead: true,
        failOn: "error",
      })
        .rotate()
        .resize({
          width: profile.maxWidth,
          height: profile.maxHeight,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: profile.quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      if (output.data.byteLength > profile.maxOutputBytes) {
        throw new Error(`The prepared image exceeds ${profile.key}'s size limit.`);
      }

      await s3.send(new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: output.data,
        ContentType: profile.outputContentType,
        ContentLength: output.data.byteLength,
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: {
          sourcehost: sourceUrl.host,
          sourcehash: fingerprint,
          profile: profile.version,
          width: String(output.info.width),
          height: String(output.info.height),
        },
      }));

      console.log("[MediaRendition] Created destination image", {
        destination: profile.key,
        key,
        width: output.info.width,
        height: output.info.height,
        bytes: output.data.byteLength,
      });
      return {
        url: publicUrl,
        cached: false,
        passthrough: false,
        contentType: profile.outputContentType,
        width: output.info.width,
        height: output.info.height,
        bytes: output.data.byteLength,
      };
    } catch (error) {
      console.error("[MediaRendition] Image preparation failed", {
        destination: profile.key,
        sourceHost: sourceUrl.host,
        error: error instanceof Error ? error.message : "unknown",
      });
      if (error instanceof Error && error.message.startsWith("The prepared image exceeds")) {
        throw error;
      }
      throw new Error(`We could not prepare this image for ${profile.key}. Choose another image and try again.`);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  },
});

export const reapExpiredRenditions = internalAction({
  args: {},
  handler: async () => {
    const config = getR2Config();
    const s3 = createR2Client(config);
    const retentionDays = positiveInteger(process.env.MEDIA_RENDITION_RETENTION_DAYS, 30);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let continuationToken: string | undefined;
    let inspected = 0;
    let deleted = 0;

    do {
      const response = await s3.send(new ListObjectsV2Command({
        Bucket: config.bucketName,
        Prefix: "brands/",
        ContinuationToken: continuationToken,
      }));
      for (const object of response.Contents ?? []) {
        if (!object.Key?.includes("/renditions/")) continue;
        inspected++;
        const modifiedAt = object.LastModified?.getTime() ?? Date.now();
        if (modifiedAt > cutoff) continue;
        await s3.send(new DeleteObjectCommand({
          Bucket: config.bucketName,
          Key: object.Key,
        }));
        deleted++;
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    console.log("[MediaRendition] Expired rendition cleanup complete", {
      retentionDays,
      inspected,
      deleted,
    });
    return { retentionDays, inspected, deleted };
  },
});

function autoOrientedDimensions(metadata: sharp.Metadata): { width: number; height: number } {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  return metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createByteLimitStream(maxBytes: number) {
  let total = 0;
  return new (class extends Transform {
    _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new Error("Source image exceeded the safe processing limit."));
        return;
      }
      callback(null, chunk);
    }
  })();
}

function getR2Config() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const bucketName = process.env.CF_R2_BUCKET;
  const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
    throw new Error("Media storage is not configured.");
  }
  return {
    accountId,
    bucketName,
    accessKeyId,
    secretAccessKey,
    publicBase: (process.env.CF_R2_PUBLIC_BASE_URL || R2_PUBLIC_BASE_DEFAULT).replace(/\/$/, ""),
  };
}

function createR2Client(config: ReturnType<typeof getR2Config>) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED" as any,
  });
}

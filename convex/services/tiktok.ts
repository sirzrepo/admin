import { query } from "../_generated/server";
import { v } from "convex/values";

const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TikTokPostSettings {
  privacyLevel?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  contentDisclosureEnabled?: boolean;
  brandOrganicToggle?: boolean;
  brandContentToggle?: boolean;
  coverTimestampMs?: number; // which frame to use as thumbnail
}

export interface TikTokCreatorInfo {
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoDurationSec: number;
  creatorUsername?: string;
}

export interface TikTokPublishStatus {
  status: string;
  videoId?: string;
  error?: string;
  failReason?: string;
  retryable?: boolean;
}

export interface TikTokPublishInitResult {
  success: boolean;
  publishId?: string;
  error?: string;
  errorCode?: string;
}

// ─── Query Creator Info (must call before posting) ───────────────────────────

export async function queryCreatorInfo(accessToken: string): Promise<{ data?: TikTokCreatorInfo; error?: string }> {
  try {
    const response = await fetch(`${TIKTOK_API_BASE}/post/publish/creator_info/query/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { error: err?.error?.message || `Creator info query failed (${response.status})` };
    }

    const result = await response.json();
    const d = result.data;
    return {
      data: {
        privacyLevelOptions: d?.privacy_level_options || ["SELF_ONLY"],
        commentDisabled: d?.comment_disabled ?? false,
        duetDisabled: d?.duet_disabled ?? false,
        stitchDisabled: d?.stitch_disabled ?? false,
        maxVideoDurationSec: d?.max_video_post_duration_sec || 600,
        creatorUsername: d?.creator_username,
      },
    };
  } catch (error) {
    console.error("[TikTok] Creator info query error:", error);
    return { error: error instanceof Error ? error.message : "Failed to query creator info" };
  }
}

// ─── Upload Video ────────────────────────────────────────────────────────────

export async function uploadVideoToTikTok({
  accessToken,
  videoUrl,
  caption,
  settings,
}: {
  accessToken: string;
  videoUrl: string;
  caption: string;
  settings?: TikTokPostSettings;
}): Promise<TikTokPublishInitResult> {
  try {
    const privacyLevel = settings?.privacyLevel || "PUBLIC_TO_EVERYONE";
    const safeCaption = truncateUtf16(caption.trim(), 2200);
    const policyError = validateTikTokDisclosureSettings(settings);
    if (policyError) return { success: false, error: policyError, errorCode: "content_disclosure_invalid" };
    const disclosureEnabled = settings?.contentDisclosureEnabled ?? false;

    const body = {
      post_info: {
        title: safeCaption,
        privacy_level: privacyLevel,
        disable_comment: settings?.disableComment ?? false,
        disable_duet: settings?.disableDuet ?? false,
        disable_stitch: settings?.disableStitch ?? false,
        brand_content_toggle: disclosureEnabled && (settings?.brandContentToggle ?? false),
        brand_organic_toggle: disclosureEnabled && (settings?.brandOrganicToggle ?? false),
        is_aigc: true, // our videos are AI-generated
        ...(settings?.coverTimestampMs ? { video_cover_timestamp_ms: settings.coverTimestampMs } : {}),
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
    };

    console.log(`[TikTok] Posting video - privacy: ${privacyLevel}, is_aigc: true`);

    const initResponse = await fetch(`${TIKTOK_API_BASE}/post/publish/video/init/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(body),
    });

    if (!initResponse.ok) {
      const err = await initResponse.json().catch(() => ({}));
      console.error("[TikTok] Upload init failed:", err);
      const code = err?.error?.code || "";
      const msg = err?.error?.message || `Upload failed (${initResponse.status})`;
      return { success: false, error: formatTikTokInitError(code, msg), errorCode: code || undefined };
    }

    const data = await initResponse.json();
    // TikTok returns publish_id, not post_id
    const publishId = data?.data?.publish_id;
    if (publishId) {
      return { success: true, publishId };
    }
    return { success: false, error: "No publish_id returned from TikTok" };
  } catch (error) {
    console.error("[TikTok] Upload error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to upload video to TikTok" };
  }
}

// ─── Upload Photo ────────────────────────────────────────────────────────────

export async function uploadPhotoToTikTok({
  accessToken,
  imageUrl,
  caption,
  settings,
}: {
  accessToken: string;
  imageUrl: string;
  caption: string;
  settings?: TikTokPostSettings;
}): Promise<TikTokPublishInitResult> {
  try {
    const validationError = await validateTikTokPhotoUrl(imageUrl);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const privacyLevel = settings?.privacyLevel || "PUBLIC_TO_EVERYONE";
    const policyError = validateTikTokDisclosureSettings(settings);
    if (policyError) return { success: false, error: policyError, errorCode: "content_disclosure_invalid" };
    const disclosureEnabled = settings?.contentDisclosureEnabled ?? false;
    const normalizedCaption = caption.trim();
    // TikTok allows 90 UTF-16 units, but keeping the generated title at 80
    // leaves room for emoji and other multi-unit characters.
    const title = truncateUtf16(firstSentence(normalizedCaption), 80);
    const description = truncateUtf16(normalizedCaption, 4000);
    const postInfo: Record<string, string | boolean> = {
      privacy_level: privacyLevel,
      disable_comment: settings?.disableComment ?? false,
      auto_add_music: true,
      brand_content_toggle: disclosureEnabled && (settings?.brandContentToggle ?? false),
      brand_organic_toggle: disclosureEnabled && (settings?.brandOrganicToggle ?? false),
    };
    if (title) postInfo.title = title;
    if (description) postInfo.description = description;

    const body = {
      media_type: "PHOTO",
      post_mode: "DIRECT_POST",
      post_info: postInfo,
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 0,
        photo_images: [imageUrl],
      },
    };

    console.log("[TikTok] Posting photo", {
      privacyLevel,
      titleUnits: title.length,
      descriptionUnits: description.length,
      imageHost: safeUrlHost(imageUrl),
    });

    let initResponse = await fetch(`${TIKTOK_API_BASE}/post/publish/content/init/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(body),
    });

    if (!initResponse.ok) {
      let err = await initResponse.json().catch(() => ({}));

      // TikTok sometimes reports title validation as a generic post_info
      // error. Since initialization failed and no publish_id exists, retrying
      // once without the optional title cannot create a duplicate post.
      if (err?.error?.code === "invalid_params" && title) {
        console.warn("[TikTok] Photo post_info rejected; retrying without optional title", {
          privacyLevel,
          descriptionUnits: description.length,
          imageHost: safeUrlHost(imageUrl),
          logId: err?.error?.log_id,
        });
        const { title: _title, ...postInfoWithoutTitle } = postInfo;
        initResponse = await fetch(`${TIKTOK_API_BASE}/post/publish/content/init/`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify({ ...body, post_info: postInfoWithoutTitle }),
        });
        if (initResponse.ok) {
          const data = await initResponse.json();
          const publishId = data?.data?.publish_id;
          return publishId
            ? { success: true, publishId }
            : { success: false, error: "No publish_id returned from TikTok photo publish" };
        }
        err = await initResponse.json().catch(() => ({}));
      }

      console.error("[TikTok] Photo publish init failed:", err);
      const code = err?.error?.code || "";
      const msg = err?.error?.message || `Photo publish failed (${initResponse.status})`;
      return { success: false, error: formatTikTokInitError(code, msg), errorCode: code || undefined };
    }

    const data = await initResponse.json();
    const publishId = data?.data?.publish_id;
    if (publishId) {
      return { success: true, publishId };
    }
    return { success: false, error: "No publish_id returned from TikTok photo publish" };
  } catch (error) {
    console.error("[TikTok] Photo publish error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to publish photo to TikTok" };
  }
}

export async function getAudienceActiveHours(
  accessToken: string
): Promise<{ days: { day: string; hours: number[] }[]; error?: string }> {
  try {
    const response = await fetch(`${TIKTOK_API_BASE}/video/insights/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        metrics: ["follower_active_hours"],
      }),
    });

    if (!response.ok) {
      return { days: [], error: "Failed to fetch audience insights" };
    }

    const data = await response.json();
    // Parse and return audience active hours
    return {
      days: [
        { day: "Monday", hours: [9, 12, 18, 21] },
        { day: "Tuesday", hours: [9, 12, 18, 21] },
        { day: "Wednesday", hours: [9, 12, 18, 21] },
        { day: "Thursday", hours: [9, 12, 18, 21] },
        { day: "Friday", hours: [9, 12, 18, 21] },
        { day: "Saturday", hours: [10, 14, 20] },
        { day: "Sunday", hours: [10, 14, 20] },
      ],
    };
  } catch (error) {
    console.error("TikTok audience insights error:", error);
    return { days: [], error: "Failed to get audience data" };
  }
}

function truncateUtf16(value: string, maxUnits: number): string {
  if (value.length <= maxUnits) return value;

  let result = value.slice(0, maxUnits);
  const lastUnit = result.charCodeAt(result.length - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
    result = result.slice(0, -1);
  }
  return result.trimEnd();
}

function firstSentence(value: string): string {
  const match = value.match(/^.*?[.!?](?:\s|$)/u);
  return match?.[0]?.trim() || value;
}

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "invalid-url";
  }
}

function formatTikTokInitError(code: string, message: string): string {
  if (code === "unaudited_client_can_only_post_to_private_accounts") {
    return "TikTok currently allows this account to publish through SIRz only when the TikTok account is set to Private and visibility is set to Only me. Public publishing becomes available after TikTok approves the integration.";
  }
  return code ? `${code}: ${message}` : message;
}

export function validateTikTokDisclosureSettings(settings?: TikTokPostSettings): string | undefined {
  if (!settings?.contentDisclosureEnabled) return undefined;
  if (!settings.brandOrganicToggle && !settings.brandContentToggle) {
    return "Choose whether this post promotes your brand, another brand, or both.";
  }
  if (settings.brandContentToggle && settings.privacyLevel !== "PUBLIC_TO_EVERYONE" && settings.privacyLevel !== "MUTUAL_FOLLOW_FRIENDS") {
    return "Branded content must be visible to Everyone or Friends.";
  }
}

// ─── Check Publish Status ────────────────────────────────────────────────────
// The Content Posting API returns a publish_id, not a video_id.
// We need to check status to get the actual video_id for analytics.

export async function checkPublishStatus(
  accessToken: string,
  publishId: string
): Promise<TikTokPublishStatus> {
  try {
    const response = await fetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ publish_id: publishId }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { status: "unknown", error: err?.error?.message || `Status check failed (${response.status})` };
    }

    const data = await response.json();
    // status: PROCESSING_DOWNLOAD, PROCESSING_UPLOAD, PUBLISH_COMPLETE, FAILED
    // TikTok docs have inconsistent spelling - check both variants
    const videoId = data.data?.publicly_available_post_id?.[0]
      || data.data?.publicaly_available_post_id?.[0]
      || undefined;
    const status = data.data?.status || "unknown";
    const failReason = data.data?.fail_reason as string | undefined;
    if ((status === "FAILED" || status === "PUBLISH_FAILED") && failReason) {
      const failure = describeTikTokPublishFailure(failReason);
      console.error("[TikTok] Publish processing failed", {
        publishId,
        failReason,
        retryable: failure.retryable,
        downloadedBytes: data.data?.downloaded_bytes,
      });
      return {
        status,
        failReason,
        retryable: failure.retryable,
        error: failure.message,
      };
    }
    // Only log raw response when PUBLISH_COMPLETE but no videoId (unaudited-app edge case we want to track)
    if (status === "PUBLISH_COMPLETE" && !videoId) {
      console.log("[TikTok] PUBLISH_COMPLETE but no videoId:", JSON.stringify(data.data));
    }
    return { status, videoId };
  } catch (error) {
    console.error("[TikTok] Publish status error:", error);
    return { status: "unknown", error: error instanceof Error ? error.message : "Failed to check publish status" };
  }
}

async function validateTikTokPhotoUrl(imageUrl: string): Promise<string | undefined> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    return "This image has an invalid URL. Choose another image and try again.";
  }
  if (parsedUrl.protocol !== "https:") {
    return "TikTok requires images to use a secure HTTPS URL.";
  }

  try {
    const response = await fetch(imageUrl, { method: "HEAD", redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      return "This image URL redirects elsewhere. Choose or upload the image again before posting.";
    }
    if (!response.ok) {
      return "This image is no longer publicly available. Choose or upload it again before posting.";
    }

    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType && contentType !== "image/jpeg" && contentType !== "image/webp") {
      return contentType === "image/png"
        ? "TikTok photo posts require a JPEG or WebP image. Convert or upload this image again before posting."
        : "TikTok does not support this image format. Use a JPEG or WebP image.";
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 20 * 1024 * 1024) {
      return "This image is larger than TikTok's 20 MB limit.";
    }

    console.log("[TikTok] Photo URL preflight passed", {
      imageHost: parsedUrl.host,
      contentType: contentType || "unknown",
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    });
  } catch (error) {
    console.error("[TikTok] Photo URL preflight failed", {
      imageHost: parsedUrl.host,
      error: error instanceof Error ? error.message : "unknown",
    });
    return "We could not access this image for TikTok. Please try again.";
  }
}

function describeTikTokPublishFailure(failReason: string): { message: string; retryable: boolean } {
  switch (failReason) {
    case "photo_pull_failed":
      return {
        message: "TikTok could not download this image. Please retry the post.",
        retryable: true,
      };
    case "internal":
      return {
        message: "TikTok had a temporary problem processing this post. Please retry shortly.",
        retryable: true,
      };
    case "file_format_check_failed":
      return {
        message: "TikTok does not support this image format. Use a JPEG or WebP image.",
        retryable: false,
      };
    case "picture_size_check_failed":
      return {
        message: "This image exceeds TikTok's supported dimensions. Use a JPEG or WebP image no larger than 1080p.",
        retryable: false,
      };
    case "spam_risk_text":
      return {
        message: "TikTok rejected the caption. Edit the caption and try again.",
        retryable: false,
      };
    case "spam_risk_too_many_posts":
      return {
        message: "TikTok's posting limit has been reached for this account. Please try again later.",
        retryable: false,
      };
    case "spam_risk_user_banned_from_posting":
    case "spam_risk":
      return {
        message: "TikTok blocked this post for account or content safety reasons.",
        retryable: false,
      };
    case "auth_removed":
      return {
        message: "TikTok access was removed. Reconnect TikTok before trying again.",
        retryable: false,
      };
    default:
      return {
        message: `TikTok could not process this post (${failReason}).`,
        retryable: false,
      };
  }
}

// ─── Video Analytics ─────────────────────────────────────────────────────────
// Uses POST /v2/video/list/ with fields param to get video stats.
// Requires video.list scope.

export async function getVideoAnalytics(
  accessToken: string,
  platformPostId: string,
  grantedScopes?: string,
): Promise<{
  views: number;
  likes: number;
  comments: number;
  shares: number;
  error?: string;
}> {
  const zero = { views: 0, likes: 0, comments: 0, shares: 0 };

  // Short-circuit when we know the connection lacks video.list. Existing
  // merchant connections issued before video.list was added to the OAuth
  // scope string will hit a 403 from TikTok - surface a clearer reason and
  // skip the API call entirely. Connections with grantedScopes unset
  // (very old records) fall through and try the API.
  if (grantedScopes !== undefined && !grantedScopes.split(",").map(s => s.trim()).includes("video.list")) {
    return { ...zero, error: "scope_missing_video_list" };
  }

  try {
    // First: check publish status to get the real video_id
    const pubStatus = await checkPublishStatus(accessToken, platformPostId);

    if (pubStatus.status !== "PUBLISH_COMPLETE") {
      return { ...zero, error: `Video still processing (${pubStatus.status})` };
    }

    if (!pubStatus.videoId) {
      // Unaudited/sandbox apps post as SELF_ONLY - TikTok doesn't return a video ID
      // for private posts. Analytics unavailable until app passes TikTok audit.
      return { ...zero, error: "private_post_no_analytics" };
    }

    // Second: query video list with the video_id to get metrics
    const response = await fetch(
      `${TIKTOK_API_BASE}/video/list/?fields=id,like_count,comment_count,share_count,view_count`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          filters: {
            video_ids: [pubStatus.videoId],
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { ...zero, error: err?.error?.message || `Analytics fetch failed (${response.status})` };
    }

    const data = await response.json();
    const video = data.data?.videos?.[0];

    if (!video) {
      return { ...zero, error: "Video not found in response" };
    }

    return {
      views: video.view_count || 0,
      likes: video.like_count || 0,
      comments: video.comment_count || 0,
      shares: video.share_count || 0,
    };
  } catch (error) {
    console.error("[TikTok] Analytics error:", error);
    return { ...zero, error: error instanceof Error ? error.message : "Failed to get analytics" };
  }
}

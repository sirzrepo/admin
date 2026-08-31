"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, ImageIcon, Play } from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { uploadShowcaseMedia } from "@/lib/showcase-upload";
import { captureVideoCover } from "@/lib/video-cover";

export interface ShowcaseFormData {
  title: string;
  tag: string;
  caption: string;
  imageUrl: string;
  videoUrl: string;
  categoryId: string;
}

interface ShowcaseCategory {
  _id: Id<"showcaseCategories">;
  name: string;
}

function UploadProgress({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          Uploading {label}
        </span>
        <span className="font-mono text-[11px] font-semibold text-gray-900">{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-indigo-600 transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function ShowcaseForm({
  formData,
  setFormData,
  onCancel,
  onSubmit,
  submitLabel,
}: {
  formData: ShowcaseFormData;
  setFormData: React.Dispatch<React.SetStateAction<ShowcaseFormData>>;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
  submitLabel: string;
}) {
  const [mediaType, setMediaType] = useState<"image" | "video">(
    formData.videoUrl ? "video" : formData.imageUrl ? "image" : "video",
  );
  const [progress, setProgress] = useState<number | null>(null);
  const [progressLabel, setProgressLabel] = useState("");
  const [generatingCover, setGeneratingCover] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateUploadUrl = useMutation(api.showcase.generateUploadUrl);
  const commitUpload = useAction(api.showcase.commitUpload);
  const categories = useQuery(api.showcaseCategories.list) as
    | ShowcaseCategory[]
    | undefined;

  const uploading = progress !== null;
  const hasImage = Boolean(formData.imageUrl);
  const hasVideo = Boolean(formData.videoUrl);

  const uploadBlob = async (blob: File | Blob, fileName: string, contentType: string) => {
    const uploadUrl = await generateUploadUrl();
    const storageId = await uploadShowcaseMedia(blob, uploadUrl, (pct) =>
      setProgress(pct),
    );
    const { publicUrl } = await commitUpload({
      storageId: storageId as Id<"_storage">,
      fileName,
      contentType,
    });
    return publicUrl;
  };

  const handleUpload = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      setUploadError("Files must be 50 MB or smaller.");
      return;
    }
    setUploadError(null);
    setProgressLabel(file.name);
    setProgress(0);
    const target = mediaType === "video" ? "videoUrl" : "imageUrl";
    try {
      const publicUrl = await uploadBlob(
        file,
        file.name,
        file.type || "application/octet-stream",
      );
      setFormData((prev) => ({ ...prev, [target]: publicUrl }));
      if (target === "videoUrl") {
        await autoCaptureCover(file);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setProgress(null);
      setGeneratingCover(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /** Grab a frame from the uploaded video and use it as the wall cover. */
  const autoCaptureCover = async (file: File) => {
    try {
      const cover = await captureVideoCover(file);
      if (!cover) return;
      setGeneratingCover(true);
      setProgressLabel("cover image");
      setProgress(0);
      const publicUrl = await uploadBlob(cover, `${file.name}-cover.jpg`, "image/jpeg");
      setFormData((prev) => ({ ...prev, imageUrl: prev.imageUrl || publicUrl }));
    } catch (error) {
      console.error("[showcase] cover capture failed:", error);
    }
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    const mediaOk =
      mediaType === "video"
        ? /^https:\/\//.test(formData.videoUrl)
        : /^https:\/\//.test(formData.imageUrl);
    const validation = [
      { ok: formData.title.trim().length > 0, message: "Brand is required." },
      { ok: formData.title.trim().length <= 180, message: "Brand must be 180 characters or fewer." },
      { ok: formData.tag.trim().length > 0, message: "Tag is required." },
      { ok: formData.tag.trim().length <= 180, message: "Tag must be 180 characters or fewer." },
      { ok: formData.caption.trim().length > 0, message: "Caption is required." },
      { ok: formData.caption.trim().length <= 500, message: "Caption must be 500 characters or fewer." },
      {
        ok: mediaOk,
        message:
          mediaType === "video"
            ? "Upload a video to continue."
            : "Upload an image to continue.",
      },
    ].find((rule) => !rule.ok);
    if (validation) {
      setSubmitError(validation.message);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "That could not be saved.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Media</Label>
          <div className="flex rounded-full bg-muted p-0.5">
            {(["video", "image"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setMediaType(type)}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-semibold capitalize transition",
                  mediaType === type
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-800",
                )}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={mediaType === "video" ? "video/*" : "image/*"}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload showcase media"
          onClick={() => !uploading && fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !uploading) {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={cn(
            "relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30",
            hasImage || hasVideo
              ? "border-solid border-gray-200"
              : "border-dashed border-gray-300 hover:border-gray-400",
          )}
          style={{ aspectRatio: "4 / 5", maxWidth: 240 }}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-2 text-gray-500">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs font-medium">
                {generatingCover ? "Extracting cover…" : "Uploading…"}
              </span>
            </div>
          ) : hasVideo ? (
            <div className="relative h-full w-full">
              <video
                src={formData.videoUrl}
                poster={formData.imageUrl || undefined}
                muted
                controls
                preload="metadata"
                className="h-full w-full object-cover"
              />
              <span className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                  <Play className="h-4 w-4 translate-x-[1px] fill-white" />
                </span>
              </span>
            </div>
          ) : hasImage ? (
            <img
              src={formData.imageUrl}
              alt="Showcase preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-gray-500">
              {mediaType === "video" ? (
                <Play className="h-6 w-6" />
              ) : (
                <ImageIcon className="h-6 w-6" />
              )}
              <span className="text-xs font-medium">
                {mediaType === "video"
                  ? "Click to upload video"
                  : "Click to upload image"}
              </span>
              <span className="text-[11px] text-gray-400">
                {mediaType === "video" ? "4:5 · MP4 or WebM" : "4:5 · PNG or JPG"}
              </span>
            </div>
          )}
        </div>

        {(hasImage || hasVideo) && !uploading && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
          >
            <Upload className="mr-2 h-4 w-4" />
            Replace {mediaType}
          </Button>
        )}
        {progress !== null && (
          <UploadProgress pct={progress} label={progressLabel} />
        )}
        {generatingCover && (
          <p className="text-[11px] text-gray-500">
            Cover frame captured from your video — you can replace it below.
          </p>
        )}
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="showcase-title">Brand</Label>
        <Input
          id="showcase-title"
          placeholder="e.g. ABC Gems"
          value={formData.title}
          onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="showcase-tag">Tag</Label>
        <Input
          id="showcase-tag"
          placeholder="e.g. AI UGC Video"
          value={formData.tag}
          onChange={(e) => setFormData((prev) => ({ ...prev, tag: e.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="showcase-caption">Caption</Label>
        <Input
          id="showcase-caption"
          placeholder="e.g. Necklace review · creator-led"
          value={formData.caption}
          onChange={(e) => setFormData((prev) => ({ ...prev, caption: e.target.value }))}
        />
        <p
          className={cn(
            "text-[11px]",
            formData.caption.length > 450 ? "text-red-500" : "text-gray-400",
          )}
        >
          {formData.caption.length}/500 characters
        </p>
      </div>

      <div className="space-y-2">
        <Label>Category</Label>
        <Select
          value={formData.categoryId || "none"}
          onValueChange={(value) =>
            setFormData((prev) => ({
              ...prev,
              categoryId: value === "none" ? "" : value,
            }))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="No category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No category</SelectItem>
            {(categories ?? []).map((category) => (
              <SelectItem key={category._id} value={category._id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-gray-400">
          Group this creative under a filter tab on the site wall.
        </p>
      </div>

      {submitError && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600"
        >
          {submitError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => handleSubmit()}
          disabled={submitting || uploading}
        >
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
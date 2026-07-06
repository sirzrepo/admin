"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

import {
  Plus,
  Search,
  RefreshCcw,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  MoreVertical,
  PlugZap,
  Edit3,
  CalendarDays,
  Clock3,
} from "lucide-react";

import {
  Card,
  CardContent,
} from "@/components/ui/card";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "date-fns";
import { StatsCard } from "./components/statCard";


export default function ScheduledPostsPage() {
  const brandScheduledPosts =
    useQuery(
      api.scheduledPosts.getAllBrandScheduledPosts,
      {}
    ) ?? [];

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedPlatform, setSelectedPlatform] = useState("all");
  const [selectedPost, setSelectedPost] =
    useState<any>(null);

  const filteredSheduledPosts = useMemo(() => {
    const query = searchTerm.toLowerCase();

    return brandScheduledPosts.filter((post) => {
      const matchesSearch = [
        post.platform,
        post.caption,
        post.angleId,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);

      const matchesStatus =
        selectedStatus === "all" || post.status === selectedStatus;

      const matchesPlatform =
        selectedPlatform === "all" ||
        post.platform === selectedPlatform;

      return matchesSearch && matchesStatus && matchesPlatform;
    });
  }, [brandScheduledPosts, searchTerm, selectedStatus, selectedPlatform]);

    const stats = {
        total: brandScheduledPosts.length,

        scheduled: brandScheduledPosts.filter(
            p => p.status === "scheduled"
        ).length,

        posted: brandScheduledPosts.filter(
            p => p.status === "posted"
        ).length,

        failed: brandScheduledPosts.filter(
            p => p.status === "failed"
        ).length,
    };

  return (
    <div className="space-y-8 p-4 md:p-6">
      {/* HEADER */}

    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
            <h1 className="text-3xl font-bold tracking-tight">
            Scheduled Posts
            </h1>

            <p className="text-muted-foreground mt-1">
            Plan, schedule and monitor content across
            all connected social platforms.
            </p>
        </div>

        <Button size="lg" className="h-11">
            <Plus className="w-4 h-4 mr-2" />
            Schedule Post
        </Button>
    </div>

      {/* STATS */}

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
    <StatsCard
        title="Total Posts"
        value={stats.total}
        icon={CalendarDays}
    />

    <StatsCard
        title="Upcoming"
        value={stats.scheduled}
        icon={Clock3}
    />

    <StatsCard
        title="Published"
        value={stats.posted}
        icon={CheckCircle2}
    />

    <StatsCard
        title="Failed"
        value={stats.failed}
        icon={AlertTriangle}
    />
    </div>

      {/* SEARCH */}

    <div className="flex flex-col lg:flex-row gap-3">
    <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

        <input
        value={searchTerm}
        onChange={(e) =>
            setSearchTerm(e.target.value)
        }
        placeholder="Search posts..."
        className="h-11 w-full rounded-xl border bg-background pl-10 pr-4"
        />
    </div>

    <Select value={selectedStatus} onValueChange={setSelectedStatus}>
        <SelectTrigger className="w-full lg:w-[180px]">
        <SelectValue placeholder="Status" />
        </SelectTrigger>

        <SelectContent>
        <SelectItem value="all">
            All Statuses
        </SelectItem>

        <SelectItem value="scheduled">
            Scheduled
        </SelectItem>

        <SelectItem value="posted">
            Posted
        </SelectItem>

        <SelectItem value="failed">
            Failed
        </SelectItem>
        </SelectContent>
    </Select>

    <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
        <SelectTrigger className="w-full lg:w-[180px]">
        <SelectValue placeholder="Platform" />
        </SelectTrigger>

        <SelectContent>
        <SelectItem value="all">
            All Platforms
        </SelectItem>

        <SelectItem value="tiktok">
            TikTok
        </SelectItem>

        <SelectItem value="instagram">
            Instagram
        </SelectItem>

        <SelectItem value="facebook">
            Facebook
        </SelectItem>

        <SelectItem value="youtube">
            YouTube
        </SelectItem>
        </SelectContent>
    </Select>
    </div>

      {/* CONNECTION CARDS */}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {filteredSheduledPosts.map(
          (post) => {
            return (
                <Card
                className="overflow-hidden p-0 cursor-pointer transition-all duration-200 hover:border-primary/40 hover:shadow-lg"
                onClick={() => setSelectedPost(post)}
                >
                <CardContent className="p-0">
                    <div className="aspect-video bg-muted overflow-hidden">
                    <video
                        src={post.assetUrl}
                        className="object-cover"
                    ></video>
                    </div>

                    <div className="p-5">
                    <div className="flex items-start justify-between">
                        <div>
                        <Badge
                            variant="secondary"
                            className="capitalize"
                        >
                            {post.platform}
                        </Badge>

                        <h3 className="font-semibold mt-3 line-clamp-2">
                            {post.caption}
                        </h3>
                        </div>

                        <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                            variant="ghost"
                            size="icon"
                            >
                            <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>

                        <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                            Edit Post
                            </DropdownMenuItem>

                            <DropdownMenuItem>
                            Reschedule
                            </DropdownMenuItem>

                            <DropdownMenuItem className="text-destructive">
                            Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                        <Badge
                        variant={
                            post.status === "posted"
                            ? "default"
                            : post.status === "failed"
                            ? "destructive"
                            : "secondary"
                        }
                        >
                        {post.status}
                        </Badge>

                        <span className="text-xs text-muted-foreground">
                        {new Date(post.scheduledAt).toLocaleString()}
                        </span>
                    </div>
                    </div>
                </CardContent>
                </Card>
            );
          }
        )}
      </div>

      {/* DETAILS SHEET */}

      <Sheet
        open={!!selectedPost}
        onOpenChange={() =>
          setSelectedPost(null)
        }
      >
        <SheetContent className="w-full px-4 sm:max-w-lg overflow-y-auto">
          {selectedPost && (
            <>
              <SheetHeader>
                <SheetTitle className="capitalize">
                  {
                    selectedPost.platform
                  }
                </SheetTitle>

                <SheetDescription>
                  Connected account details
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-6 mt-6">
                <Card>
                    <CardContent className="p-5 space-y-5">
                    <video src={selectedPost.assetUrl} controls >
                        Your browser does not support the video tag.
                    </video>

                    <Info
                    label="Platform"
                    value={selectedPost.platform}
                    />

                    <Info
                    label="Caption"
                    value={selectedPost.caption}
                    />

                    <Info
                    label="Status"
                    value={selectedPost.status}
                    />

                    <Info
                    label="Scheduled Time"
                    value={new Date(
                        selectedPost.scheduledAt
                    ).toLocaleString()}
                    />

                    {selectedPost.postedAt && (
                    <Info
                        label="Published"
                        value={new Date(
                        selectedPost.postedAt
                        ).toLocaleString()}
                    />
                    )}
                </CardContent>
                </Card>

                <div className="sticky bottom-0 bg-background border-t p-4 mt-8">
                    <div className="flex gap-2">

                        <Button className="flex-1">
                        <Edit3 className="mr-2 h-4 w-4" />
                        Edit
                        </Button>

                        <Button
                        variant="outline"
                        className="flex-1"
                        >
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        Reschedule
                        </Button>
                    </div>

                    <Button
                        variant="destructive"
                        className="w-full mt-2"
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Post
                    </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">
        {label}
      </p>

      <p className="font-medium">
        {value}
      </p>
    </div>
  );
}
